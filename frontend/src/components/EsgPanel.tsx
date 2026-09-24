"use client";

import { Check } from "lucide-react";
import { usePrefs } from "@/lib/prefs";
import { Card, EsgBadge, Progress, SectionTitle } from "./ui";

export type Esg = {
  score: number;
  rating: string;
  weights: { E: number; S: number; G: number };
  pillars: {
    E: { score: number; capacity_factor_24h: number; benchmark_capacity_factor: number; performance_vs_benchmark: number;
         co2_avoided_t: number; co2_avoided_annual_t: number; households_powered: number; grid_emission_factor_kg_kwh: number };
    S: { score: number; jobs: number; jobs_per_mw: number; local_hiring_pct: number; community_program: string; community_program_tr?: string; source: string };
    G: { score: number; data_integrity: number; verified_readings: number; rejected_messages: number; batches: number;
         flagged_batches: number; anomaly_rate: number; controls: Record<string, boolean> };
  };
};

const CONTROL_LABELS: Record<string, [string, string]> = {
  device_signatures: ["Cihaz imzaları (Ed25519)", "Device signatures (Ed25519)"],
  on_chain_anchoring: ["Zincir üstü kayıt", "On-chain anchoring"],
  multisig_treasury: ["2/3 çoklu imza", "2-of-3 multisig"],
  kyc_whitelist: ["KYC beyaz listesi", "KYC whitelist"],
};

export function EsgPanel({ esg }: { esg: Esg }) {
  const { t, num, lang } = usePrefs();
  const tr = lang === "tr";
  const { E, S, G } = esg.pillars;
  return (
    <Card>
      <SectionTitle title={t("asset.esg")}
        hint={tr ? "Ağırlıklar: Çevre %40 · Sosyal %20 · Yönetişim %40" : "Weights: Environmental 40% · Social 20% · Governance 40%"}
        right={<EsgBadge rating={esg.rating} score={esg.score} size="lg" />} />
      <div className="grid gap-5 md:grid-cols-3">
        <Pillar title={tr ? "Çevre (E)" : "Environmental (E)"} score={E.score} tone="wind" rows={[
          [tr ? "24s kapasite faktörü" : "24h capacity factor", `${num(E.capacity_factor_24h * 100, 1)}%`],
          [tr ? "Referans" : "Benchmark", `${num(E.benchmark_capacity_factor * 100)}%`],
          [tr ? "Önlenen CO₂ (canlı)" : "CO₂ avoided (live)", `${num(E.co2_avoided_t, 1)} t`],
          [tr ? "Yıllık önlenen CO₂" : "Annual CO₂ avoided", `${num(E.co2_avoided_annual_t)} t`],
          [t("asset.households"), num(E.households_powered)],
        ]} />
        <Pillar title={tr ? "Sosyal (S)" : "Social (S)"} score={S.score} tone="solar" rows={[
          [t("asset.jobs"), num(S.jobs)],
          [tr ? "MW başına istihdam" : "Jobs per MW", num(S.jobs_per_mw, 2)],
          [t("asset.localHiring"), `${S.local_hiring_pct}%`],
          [tr ? "Kaynak" : "Source", tr ? "Üretici beyanı" : "Producer declaration"],
        ]} />
        <Pillar title={tr ? "Yönetişim (G)" : "Governance (G)"} score={G.score} tone="chain" rows={[
          [tr ? "Veri bütünlüğü" : "Data integrity", `${num(G.data_integrity * 100, 2)}%`],
          [tr ? "Doğrulanan okuma" : "Verified readings", num(G.verified_readings)],
          [tr ? "Reddedilen mesaj" : "Rejected messages", num(G.rejected_messages)],
          [tr ? "İşaretlenen parti" : "Flagged batches", `${G.flagged_batches} / ${G.batches}`],
        ]}>
          <div className="mt-3 space-y-1">
            {Object.entries(G.controls).map(([k, v]) => (
              <div key={k} className="flex items-center gap-1.5 text-xs text-muted">
                <Check className={`size-3.5 ${v ? "text-wind" : "text-faint"}`} />{CONTROL_LABELS[k]?.[tr ? 0 : 1] ?? k}
              </div>
            ))}
          </div>
        </Pillar>
      </div>
    </Card>
  );
}

function Pillar({ title, score, tone, rows, children }: {
  title: string; score: number; tone: "wind" | "solar" | "chain"; rows: [string, string][]; children?: React.ReactNode;
}) {
  const { num } = usePrefs();
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{title}</span>
        <span className="num font-semibold">{num(score, 1)}</span>
      </div>
      <div className="mt-2"><Progress value={score / 100} tone={tone} /></div>
      <dl className="mt-3 space-y-1.5 text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2"><dt className="text-faint">{k}</dt><dd className="num text-muted">{v}</dd></div>
        ))}
      </dl>
      {children}
    </div>
  );
}
