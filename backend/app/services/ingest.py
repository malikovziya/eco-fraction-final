"""Kafka consumer: scores every verified reading with the AI and closes hourly batches.

Stream flow:  telemetry.verified -> features -> XGBoost -> DB + live dashboard
              every simulated hour -> Batch (hash + verdict) -> settlement worker
              telemetry.rejected -> security alerts
"""

import hashlib
import json
import threading
import time
from datetime import datetime, timedelta

from confluent_kafka import Consumer
from sqlalchemy import select

from iot import topics

from ..config import FLAG_MIN_SUSPICIOUS, FRAUD_THRESHOLD
from ..db import Alert, Batch, HourlyEnergy, Reading, Rejection, SessionLocal
from ..hub import hub
from ..seed import backfill_history
from ..state import platform


def batch_hash(raw_messages: list[str]) -> str:
    """sha256 over the exact signed device messages, in order. Anyone can recompute it."""
    canonical = json.dumps([json.loads(m) for m in raw_messages], sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


class OpenBatch:
    def __init__(self, hour: datetime):
        self.hour = hour
        self.readings: list[tuple[int, list[float], dict]] = []  # (reading id, features, prediction)
        self.raw: list[str] = []
        self.energy_kwh = 0.0


class Ingest:
    def __init__(self, on_batch):
        self.on_batch = on_batch  # called with a closed batch id
        self.open: dict[str, OpenBatch] = {}
        self.maintenance_streak: dict[str, int] = {}
        self.last_security_alert: dict[str, float] = {}

    def start(self) -> None:
        threading.Thread(target=self._run, name="ingest", daemon=True).start()

    def _run(self) -> None:
        consumer = Consumer({
            "bootstrap.servers": topics.KAFKA_BOOTSTRAP,
            "group.id": f"eco-backend-{int(time.time())}",
            "auto.offset.reset": "latest",
            "topic.metadata.refresh.interval.ms": 2000,  # pick up topics created after we subscribed
        })
        consumer.subscribe([topics.KAFKA_VERIFIED, topics.KAFKA_REJECTED])
        while True:
            msg = consumer.poll(0.5)
            if msg is None or msg.error():
                continue
            try:
                if msg.topic() == topics.KAFKA_VERIFIED:
                    self._on_reading(msg.value().decode())
                else:
                    self._on_rejection(json.loads(msg.value()))
            except Exception as e:  # never let one bad message stop the stream
                print(f"[ingest] error: {e!r}", flush=True)

    # ── Verified readings ───────────────────────────────────────────────────

    def _on_reading(self, raw: str) -> None:
        p = platform()
        m = json.loads(raw)
        asset = p.assets.get(m["asset_id"])
        if asset is None:
            return
        ts = datetime.fromisoformat(m["ts"])
        feats = p.features[asset.id].extract(asset, m, ts)
        pred = p.detector.predict(feats)

        # A reading stamped ts covers the interval before it
        hour = (ts - timedelta(seconds=m["interval_s"])).replace(minute=0, second=0, microsecond=0)
        current = self.open.get(asset.id)
        if current and hour > current.hour:
            self._close(asset.id, current)
            current = None
        if current is None:
            current = self.open[asset.id] = OpenBatch(hour)
            self._ensure_history(asset, hour)

        with SessionLocal() as s:
            row = Reading(asset_id=asset.id, ts=m["ts"], power_kw=m["power_kw"], energy_kwh=m["energy_kwh"],
                          fraud_prob=pred["fraud_prob"], degrade_prob=pred["degrade_prob"],
                          predicted_class=pred["predicted"], raw=raw)
            s.add(row)
            s.commit()
            reading_id = row.id
        current.readings.append((reading_id, feats, pred))
        current.raw.append(raw)
        current.energy_kwh += m["energy_kwh"]

        live = {
            "asset_id": asset.id, "ts": m["ts"], "power_kw": m["power_kw"], "energy_kwh": m["energy_kwh"],
            "capacity_kw": asset.capacity_kw, "fraud_prob": round(pred["fraud_prob"], 4),
            "degrade_prob": round(pred["degrade_prob"], 4), "predicted": pred["predicted"],
            "irradiance_wm2": m.get("irradiance_wm2"), "wind_speed_ms": m.get("wind_speed_ms"),
            "temperature_c": m.get("temperature_c"), "seq": m["seq"], "device_id": m["device_id"],
        }
        p.latest[asset.id] = live
        p.stats["verified"] += 1
        hub.publish("reading", live)

    def _ensure_history(self, asset, hour: datetime) -> None:
        with SessionLocal() as s:
            if not s.scalar(select(HourlyEnergy.id).where(HourlyEnergy.asset_id == asset.id).limit(1)):
                backfill_history(s, asset, hour)
        self._refresh_forecast(asset)

    def _refresh_forecast(self, asset) -> None:
        p = platform()
        with SessionLocal() as s:
            rows = s.scalars(select(HourlyEnergy).where(HourlyEnergy.asset_id == asset.id)
                             .order_by(HourlyEnergy.hour.desc()).limit(48)).all()
        history = [(datetime.fromisoformat(r.hour), r.ratio) for r in reversed(rows)]
        p.forecasts[asset.id] = p.forecaster.forecast(asset, history)

    # ── Hourly batch ────────────────────────────────────────────────────────

    def _close(self, asset_id: str, ob: OpenBatch) -> None:
        p = platform()
        asset = p.assets[asset_id]
        fraud = [pred["fraud_prob"] for _, _, pred in ob.readings]
        degrade = [pred["degrade_prob"] for _, _, pred in ob.readings]
        suspicious = [i for i, f in enumerate(fraud) if f > FRAUD_THRESHOLD]
        flagged = len(suspicious) >= FLAG_MIN_SUSPICIOUS
        anomaly_score = int(10000 * sum(sorted(fraud)[-3:]) / min(3, len(fraud)))

        if flagged:
            totals = {c: sum(pred["probs"][c] for _, _, pred in ob.readings) for c in ("inflate", "flatline")}
            verdict = max(totals, key=totals.get)
            rows = [ob.readings[i][1] for i in suspicious]
        elif sum(d > 0.5 for d in degrade) >= FLAG_MIN_SUSPICIOUS:
            verdict = "degrade"
            rows = [f for (_, f, pred) in ob.readings if pred["degrade_prob"] > 0.5]
        else:
            verdict, rows = "normal", []
        explanation = p.detector.explain(rows, verdict) if rows else []

        with SessionLocal() as s:
            batch = Batch(
                asset_id=asset_id, token_id=asset.token_id,
                period_start=ob.hour.isoformat(timespec="seconds"),
                period_end=(ob.hour + timedelta(hours=1)).isoformat(timespec="seconds"),
                readings_count=len(ob.readings), energy_wh=int(round(ob.energy_kwh * 1000)),
                data_hash=batch_hash(ob.raw), anomaly_score=anomaly_score,
                suspicious_readings=len(suspicious), flagged=flagged, verdict=verdict, explanation=explanation,
            )
            s.add(batch)
            s.flush()
            for reading_id, _, _ in ob.readings:
                s.get(Reading, reading_id).batch_id = batch.id
            s.add(HourlyEnergy(asset_id=asset_id, hour=batch.period_start, energy_kwh=round(ob.energy_kwh, 1),
                               ratio=ob.energy_kwh / asset.capacity_kw))
            self._alerts(s, asset, batch)
            s.commit()
            batch_id = batch.id

        p.stats["batches"] += 1
        p.stats["flagged"] += int(flagged)
        self._refresh_forecast(asset)
        hub.publish("batch_closed", {"id": batch_id, "asset_id": asset_id, "verdict": verdict,
                                     "flagged": flagged, "energy_kwh": round(ob.energy_kwh, 1),
                                     "anomaly_score": anomaly_score, "period_start": ob.hour.isoformat()})
        self.on_batch(batch_id)

    def _alerts(self, s, asset, batch: Batch) -> None:
        if batch.flagged:
            what = "inflated meter readings" if batch.verdict == "inflate" else "a frozen meter signal"
            what_tr = "şişirilmiş sayaç okuması" if batch.verdict == "inflate" else "donmuş sayaç sinyali"
            window = f"{batch.period_start[11:16]}–{batch.period_end[11:16]}"
            n = f"{batch.suspicious_readings}/{batch.readings_count}"
            s.add(Alert(asset_id=asset.id, kind="fraud", severity="high", batch_id=batch.id,
                        title=f"{asset.name}: revenue escrowed",
                        detail=f"AI detected {what} in {n} readings ({window}). Awaiting multisig review.",
                        title_tr=f"{asset.name}: gelir emanete alındı",
                        detail_tr=f"YZ, {n} okumada {what_tr} tespit etti ({window}). Çoklu imza incelemesi bekleniyor."))
            hub.publish("alert", {"asset_id": asset.id, "kind": "fraud", "batch_id": batch.id})

        active = s.scalar(select(Alert).where(Alert.asset_id == asset.id, Alert.kind == "maintenance", Alert.active))
        if batch.verdict == "degrade":
            self.maintenance_streak[asset.id] = 0
            if active is None:
                part = "panel soiling or inverter wear" if asset.kind == "solar" else "gearbox or blade wear"
                part_tr = "panel kirlenmesi veya inverter yıpranması" if asset.kind == "solar" else "dişli kutusu veya kanat yıpranması"
                s.add(Alert(asset_id=asset.id, kind="maintenance", severity="medium", batch_id=batch.id,
                            title=f"{asset.name}: output degradation",
                            detail=f"Output is consistently below what conditions allow; likely {part}. "
                                   f"Revenue is paid normally; maintenance recommended.",
                            title_tr=f"{asset.name}: performans düşüşü",
                            detail_tr=f"Üretim, koşulların izin verdiğinin sürekli altında; olası neden {part_tr}. "
                                      f"Gelir normal ödeniyor; bakım önerilir."))
                hub.publish("alert", {"asset_id": asset.id, "kind": "maintenance", "batch_id": batch.id})
        elif active is not None:
            self.maintenance_streak[asset.id] = self.maintenance_streak.get(asset.id, 0) + 1
            if self.maintenance_streak[asset.id] >= 3:  # three healthy hours in a row
                active.active = False

    # ── Rejected messages (forged / replayed) ───────────────────────────────

    def _on_rejection(self, event: dict) -> None:
        p = platform()
        m = event.get("message", {})
        asset_id = str(m.get("asset_id", "unknown"))
        with SessionLocal() as s:
            s.add(Rejection(asset_id=asset_id, reason=event["reason"], ts=m.get("ts"),
                            claimed_power_kw=m.get("power_kw")))
            now = time.time()
            if now - self.last_security_alert.get(asset_id, 0) > 30 and asset_id in p.assets:
                self.last_security_alert[asset_id] = now
                name = p.assets[asset_id].name
                claimed = f"{float(m.get('power_kw') or 0):,.0f}"
                s.add(Alert(asset_id=asset_id, kind="security", severity="high",
                            title=f"{name}: forged device blocked",
                            detail=f"Messages claiming {claimed} kW were rejected ({event['reason']}). "
                                   f"The signature does not match the registered device key.",
                            title_tr=f"{name}: sahte cihaz engellendi",
                            detail_tr=f"{claimed} kW iddia eden mesajlar reddedildi ({event['reason']}). "
                                      f"İmza, kayıtlı cihaz anahtarıyla eşleşmiyor."))
                hub.publish("alert", {"asset_id": asset_id, "kind": "security"})
            s.commit()
        p.stats["rejected"] += 1
        hub.publish("rejection", {"asset_id": asset_id, "reason": event["reason"], "ts": m.get("ts"),
                                  "claimed_power_kw": m.get("power_kw")})
