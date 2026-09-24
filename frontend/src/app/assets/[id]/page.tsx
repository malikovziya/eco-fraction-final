"use client";

import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, Cpu, HeartHandshake, MapPin, ShieldAlert, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { use, useState } from "react";
import { ForecastChart, LiveProductionChart } from "@/components/charts";
import { type Esg, EsgPanel } from "@/components/EsgPanel";
import { InvestBox } from "@/components/InvestBox";
import { Badge, Card, EsgBadge, KindIcon, KindLabel, Progress, SectionTitle, Skeleton, TxLink, formatPower } from "@/components/ui";
import { VerifyDialog } from "@/components/VerifyDialog";
import { useData, useLive, useLiveEvent } from "@/lib/live";
import { usePrefs } from "@/lib/prefs";
import type { Asset, BatchT, LiveReading } from "@/lib/types";

type Forecast = React.ComponentProps<typeof ForecastChart>["data"] & {
  model: { mae_capacity_ratio: number; persistence_mae: number; improvement_vs_persistence: number };
};

export default function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, tx, money, num } = usePrefs();
  const { latest } = useLive();
  const [verifyId, setVerifyId] = useState<number | null>(null);
  const { data: asset, reload } = useData<Asset>(`/assets/${id}`, { refreshOn: ["batch_settled", "alert", "investment"] });
  const { data: forecast } = useData<Forecast>(`/assets/${id}/forecast`, { refreshOn: ["batch_closed"] });
  const { data: esg } = useData<Esg>(`/assets/${id}/esg`, { refreshOn: ["batch_settled"] });
  const { data: batches } = useData<BatchT[]>(`/batches?asset_id=${id}&limit=12`, { refreshOn: ["batch_settled", "batch_closed"] });

  if (!asset) return <Skeleton className="h-96" />;
  const live = latest[id] ?? asset.live;
  const flaggedBatch = batches?.find((b) => b.status === "escrowed");

  return (
    <div className="space-y-6">
      <Link href="/assets" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-text">
        <ArrowLeft className="size-4" />{t("nav.assets")}
      </Link>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className={clsx("grid size-14 place-items-center rounded-2xl", asset.kind === "solar" ? "bg-solar/10" : "bg-wind/10")}>
            <KindIcon kind={asset.kind} className="size-7" />
          </div>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{asset.name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-3 text-sm text-muted">
              <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{asset.region}, Azerbaijan</span>
              <KindLabel kind={asset.kind} />
              <span>{num(asset.capacity_kw / 1000)} MW{asset.turbines ? ` · ${asset.turbines} turbines` : ""}</span>
              <span className="font-mono text-xs text-faint">ERC-1155 #{asset.tokenId}</span>
            </div>
          </div>
        </div>
        <EsgBadge rating={asset.esg.rating} score={asset.esg.score} size="lg" />
      </div>

      {/* Escrow banner */}
      <AnimatePresence>
        {flaggedBatch && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            <Card className="glow-alert flex flex-wrap items-center gap-4 border-alert/40">
              <ShieldAlert className="size-6 text-alert" />
              <div className="flex-1">
                <div className="font-semibold text-alert">{t("toast.fraud")}</div>
                <div className="text-sm text-muted">
                  #{flaggedBatch.id} · {flaggedBatch.period_start.slice(11, 16)}–{flaggedBatch.period_end.slice(11, 16)} ·{" "}
                  {money(flaggedBatch.revenue_usdc)} · {t(`verdict.${flaggedBatch.verdict}`)} ({flaggedBatch.suspicious_readings}/{flaggedBatch.readings})
                </div>
              </div>
              <Explanation batch={flaggedBatch} />
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          {/* Live production */}
          <Card>
            <SectionTitle title={t("asset.liveChart")} hint={t("asset.liveChartHint")}
              right={live && <LiveBadge live={live} capacity={asset.capacity_kw} kind={asset.kind} />} />
            <LiveProductionChart assetId={id} kind={asset.kind} capacityKw={asset.capacity_kw} />
            {live && <SensorStrip live={live} />}
          </Card>

          {/* Forecast */}
          <Card>
            <SectionTitle title={t("asset.forecast")} hint={t("asset.forecastHint")}
              right={forecast && <Badge tone="ai">MAE {num(forecast.model.mae_capacity_ratio * 100, 1)}% · {num(forecast.model.improvement_vs_persistence * 100)}% {t("ai.better")}</Badge>} />
            {forecast ? <ForecastChart data={forecast} kind={asset.kind} capacityKw={asset.capacity_kw} /> : <Skeleton className="h-60" />}
          </Card>

          {/* On-chain batches */}
          <Card>
            <SectionTitle title={t("asset.batches")} hint={t("asset.batchesHint")} />
            <BatchTable batches={batches ?? []} onVerify={setVerifyId} />
          </Card>

          {esg && <EsgPanel esg={esg} />}
        </div>

        <div className="space-y-6">
          <InvestBox asset={asset} onDone={reload} />
          <Card>
            <SectionTitle title={t("asset.about")} />
            <dl className="space-y-2 text-sm">
              <Info label={t("asset.value")} value={money(asset.valueUsd, { compact: true })} />
              <Info label={t("asset.offered")} value={`20% · ${num(asset.offeredShares)} ${t("common.shares")}`} />
              <Info label={t("common.expectedYield")} value={<span className="text-money">{num(asset.expectedYield * 100, 1)}%</span>} />
              <Info label={t("stats.investors")} value={num(asset.investors)} />
            </dl>
            <div className="mt-4">
              <div className="mb-1.5 flex justify-between text-xs text-muted">
                <span>{num((asset.soldShares / asset.offeredShares) * 100, 1)}% {t("common.funded")}</span>
                <span>{num(asset.remainingShares)} {t("common.remaining")}</span>
              </div>
              <Progress value={asset.soldShares / asset.offeredShares} tone={asset.kind === "solar" ? "solar" : "wind"} />
            </div>
            <div className="mt-5 rounded-xl bg-surface-2 p-3 text-sm">
              <div className="mb-1 flex items-center gap-1.5 text-xs text-faint"><HeartHandshake className="size-3.5" />{t("asset.community")}</div>
              {tx(asset.social.community_tr ?? asset.social.community, asset.social.community)}
            </div>
          </Card>
          <AiFeed assetId={id} />
        </div>
      </div>

      <VerifyDialog batchId={verifyId} onClose={() => setVerifyId(null)} />
    </div>
  );
}

function LiveBadge({ live, capacity, kind }: { live: LiveReading; capacity: number; kind: "solar" | "wind" }) {
  const { num } = usePrefs();
  return (
    <div className="text-right">
      <div className={clsx("num text-2xl font-semibold", kind === "solar" ? "text-solar" : "text-wind")}>{formatPower(live.power_kw, num)}</div>
      <div className="num text-xs text-faint">{num((live.power_kw / capacity) * 100, 1)}% · {live.ts.slice(11, 16)}</div>
    </div>
  );
}

function SensorStrip({ live }: { live: LiveReading }) {
  const { t, num } = usePrefs();
  return (
    <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-line pt-3 text-xs text-muted">
      {live.irradiance_wm2 != null && <span>{t("asset.irradiance")}: <b className="num text-text">{num(live.irradiance_wm2)} W/m²</b></span>}
      {live.wind_speed_ms != null && <span>{t("asset.windSpeed")}: <b className="num text-text">{num(live.wind_speed_ms, 1)} m/s</b></span>}
      {live.temperature_c != null && <span>{t("asset.temperature")}: <b className="num text-text">{num(live.temperature_c, 1)} °C</b></span>}
      <span className="inline-flex items-center gap-1"><Cpu className="size-3" />{t("asset.device")}: <b className="font-mono text-text">{live.device_id}</b> · seq {live.seq}</span>
      <span className="inline-flex items-center gap-1 text-wind"><ShieldCheck className="size-3" />Ed25519 ✓</span>
    </div>
  );
}

function Explanation({ batch }: { batch: BatchT }) {
  const { t, num } = usePrefs();
  if (!batch.explanation.length) return null;
  const max = Math.max(...batch.explanation.map((e) => e.contribution));
  return (
    <div className="w-full md:w-96">
      <div className="mb-1.5 text-xs font-medium text-faint">{t("asset.why")}</div>
      {batch.explanation.map((e) => (
        <div key={e.feature} className="mb-1.5">
          <div className="flex justify-between text-xs"><span>{t(`feat.${e.feature}` as never)}</span><span className="num text-faint">{num(e.value, 2)}</span></div>
          <div className="mt-0.5 h-1.5 rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-alert" style={{ width: `${(e.contribution / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

const STATUS_TONE = {
  distributed: "money", escrowed: "alert", released: "wind", refunded: "warn", pending: "neutral", failed: "alert",
} as const;

function BatchTable({ batches, onVerify }: { batches: BatchT[]; onVerify: (id: number) => void }) {
  const { t, money, num } = usePrefs();
  return (
    <div className="scroll-thin overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-faint">
          <tr>
            <th className="pb-2 font-medium">{t("asset.period")}</th>
            <th className="pb-2 font-medium">{t("asset.energy")}</th>
            <th className="pb-2 font-medium">{t("asset.aiVerdict")}</th>
            <th className="pb-2 font-medium">{t("asset.revenue")}</th>
            <th className="pb-2 font-medium">{t("asset.status")}</th>
            <th className="pb-2 font-medium">{t("asset.proof")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line/60">
          {batches.map((b) => (
            <tr key={b.id} className={clsx(b.flagged && "bg-alert/5")}>
              <td className="num py-2 font-mono text-xs text-muted">{b.period_start.slice(5, 10)} {b.period_start.slice(11, 16)}</td>
              <td className="num py-2">{num(b.energy_kwh / 1000, 2)} MWh</td>
              <td className="py-2">
                <Badge tone={b.verdict === "normal" ? "neutral" : b.verdict === "degrade" ? "warn" : "alert"}>
                  {t(`verdict.${b.verdict}`)} · {num(b.anomaly_score * 100)}%
                </Badge>
              </td>
              <td className="num py-2">{b.revenue_usdc == null ? "–" : money(b.revenue_usdc)}</td>
              <td className="py-2"><Badge tone={STATUS_TONE[b.status]}>{t(`status.${b.status}`)}</Badge></td>
              <td className="py-2">
                <div className="flex items-center gap-2">
                  <TxLink hash={b.tx_record} />
                  {b.chain_batch_id != null && (
                    <button onClick={() => onVerify(b.id)} className="rounded-md px-1.5 py-0.5 text-xs text-wind ring-1 ring-wind/30 hover:bg-wind/10">
                      {t("common.verify")}
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AiFeed({ assetId }: { assetId: string }) {
  const { t, num } = usePrefs();
  const [rows, setRows] = useState<LiveReading[]>([]);
  useLiveEvent(["reading"], (e) => {
    const r = e.data as unknown as LiveReading;
    if (r.asset_id === assetId) setRows((prev) => [r, ...prev].slice(0, 8));
  });
  return (
    <Card>
      <SectionTitle title={t("asset.aiFeed")} hint={t("asset.aiFeedHint")} />
      <div className="space-y-1.5">
        {rows.length === 0 && <p className="py-4 text-center text-xs text-faint">{t("feed.empty")}</p>}
        {rows.map((r) => (
          <div key={`${r.seq}-${r.ts}`} className="flex items-center gap-2 text-xs">
            <span className="num w-10 font-mono text-faint">{r.ts.slice(11, 16)}</span>
            <div className="h-1.5 flex-1 rounded-full bg-surface-2">
              <div className={clsx("h-full rounded-full", r.fraud_prob > 0.5 ? "bg-alert" : r.degrade_prob > 0.5 ? "bg-warn" : "bg-wind")}
                style={{ width: `${Math.max(3, Math.max(r.fraud_prob, r.degrade_prob) * 100)}%` }} />
            </div>
            <span className={clsx("w-28 text-right", r.predicted === "normal" ? "text-muted" : r.predicted === "degrade" ? "text-warn" : "text-alert")}>
              {t(`verdict.${r.predicted}`)} {r.predicted !== "normal" && `${num(Math.max(r.fraud_prob, r.degrade_prob) * 100)}%`}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex justify-between gap-3"><dt className="text-muted">{label}</dt><dd className="num text-right">{value}</dd></div>;
}
