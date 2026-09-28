"use client";

import clsx from "clsx";
import { ShieldCheck } from "lucide-react";
import { usePrefs } from "@/lib/prefs";
import { Badge, Card, SectionTitle } from "./ui";

export type Risk = {
  score: number;
  level: "low" | "medium" | "high";
  reasons: { en: string; tr: string }[];
  forecast: { hours: number; window_h: number; actual_mwh: number; forecast_mwh: number; gap: number | null; band: number;
              status: "ok" | "calibrating" | "low_output" };
  components: {
    fraud: { points: number; max: number };
    performance: { points: number; max: number };
    data: { points: number; max: number };
  };
};

const LEVEL_TONE = { low: "wind", medium: "warn", high: "alert" } as const;

export function RiskBadge({ risk }: { risk: Risk }) {
  const { tx } = usePrefs();
  const label = { low: tx("Düşük risk", "Low risk"), medium: tx("Orta risk", "Medium risk"), high: tx("Yüksek risk", "High risk") }[risk.level];
  return <Badge tone={LEVEL_TONE[risk.level]} className="px-2.5 py-1"><ShieldCheck className="size-3.5" />{label} · {risk.score}/100</Badge>;
}

/** Live AI risk assessment: XGBoost fraud signal + LSTM forecast deviation + device-signature trust. */
export function RiskPanel({ risk }: { risk: Risk }) {
  const { tx, num, lang } = usePrefs();
  const f = risk.forecast;
  const rows: [string, string, { points: number; max: number }][] = [
    [tx("Manipülasyon sinyali", "Fraud signal"), "XGBoost", risk.components.fraud],
    [tx("Tahmine göre performans", "Performance vs forecast"), "LSTM", risk.components.performance],
    [tx("Veri güvenilirliği", "Data trust"), "Ed25519", risk.components.data],
  ];
  return (
    <Card>
      <SectionTitle title={tx("YZ risk değerlendirmesi", "AI risk assessment")}
        hint={tx("Her saat canlı veriden yeniden hesaplanır.", "Recalculated every hour from live data.")}
        right={<RiskBadge risk={risk} />} />
      <div className="space-y-2.5">
        {rows.map(([label, model, c]) => (
          <div key={label}>
            <div className="flex justify-between text-xs">
              <span className="text-muted">{label} <span className="text-faint">· {model}</span></span>
              <span className="num">{c.points}/{c.max}</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-surface-2">
              <div className={clsx("h-full rounded-full", c.points === 0 ? "bg-wind" : c.points < c.max ? "bg-warn" : "bg-alert")}
                style={{ width: `${Math.max(4, (c.points / c.max) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-xl bg-surface-2 p-3 text-xs text-muted">
        {f.status === "calibrating" ? (
          tx(`YZ tahmin karşılaştırması hazırlanıyor: ${f.hours}/${f.window_h} saat.`, `Building the forecast comparison: ${f.hours}/${f.window_h} hours.`)
        ) : f.status === "low_output" ? (
          tx("Son 24 saatte üretim çok düşük: tahmin karşılaştırması yapılmadı.", "Too little output in the last 24 h for a fair forecast comparison.")
        ) : (
          <>
            {tx("Son 24 saat", "Last 24 h")}: <b className="num text-text">{num(f.actual_mwh, 1)} MWh</b> {tx("gerçekleşen", "reported")} ·{" "}
            <b className="num text-text">{num(f.forecast_mwh, 1)} MWh</b> {tx("YZ tahmini", "AI forecast")} ·{" "}
            <b className={clsx("num", Math.abs(f.gap ?? 0) > f.band ? "text-warn" : "text-wind")}>{(f.gap ?? 0) >= 0 ? "+" : ""}{num((f.gap ?? 0) * 100)}%</b>
            <span className="text-faint"> ({tx("normal aralık", "normal band")} ±{num(f.band * 100)}%)</span>
          </>
        )}
      </div>

      <ul className="mt-3 space-y-1 text-xs">
        {risk.reasons.length === 0 ? (
          <li className="text-muted">{tx("Risk sinyali yok: tüm kontroller normal.", "No risk signals: all checks normal.")}</li>
        ) : risk.reasons.map((r) => (
          <li key={r.en} className="flex gap-1.5 text-muted"><span className="text-warn">•</span>{lang === "tr" ? r.tr : r.en}</li>
        ))}
      </ul>
    </Card>
  );
}
