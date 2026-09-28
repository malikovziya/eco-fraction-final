"use client";

import { ArrowLeft, Printer, Zap } from "lucide-react";
import Link from "next/link";
import { use } from "react";
import { Skeleton } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useData, useLive } from "@/lib/live";
import { usePrefs } from "@/lib/prefs";
import type { Esg } from "@/components/EsgPanel";

type Report = {
  asset: {
    asset_id: string; name: string; kind: string; capacity_kw: number; raised_usdc: number; offered_usdc: number;
    investors: number; energy_24h_kwh: number; capacity_factor_24h: number; performance_ratio: number;
    revenue_24h_usdc: number; forecast_next_24h_kwh: number;
  };
  esg: Esg;
  batches: { id: number; period_start: string; energy_kwh: number; verdict: string; status: string; revenue_usdc: number | null; data_hash: string }[];
  alerts: { kind: string; severity: string; title: string; detail: string; title_tr: string | null; detail_tr: string | null; active: boolean; created_at: string }[];
  integrity: { anchored_batches: number; flagged_batches: number; rejected_messages: number };
  contracts: Record<string, string>;
  generated_for: string;
};

export default function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { tx, money, num, lang, t } = usePrefs();
  const { user } = useAuth();
  const { sim } = useLive();
  const { data: r, error } = useData<Report>(user ? `/producer/report/${id}` : null);

  if (!user) return <p className="text-muted">{tx("Rapor için üretici veya kurumsal yatırımcı olarak giriş yapın.", "Sign in as a producer or institutional investor to view reports.")}</p>;
  if (error) return <p className="text-alert">{error}</p>;
  if (!r) return <Skeleton className="h-[1000px]" />;
  const { E, S, G } = r.esg.pillars;
  const today = new Date().toLocaleDateString(lang === "tr" ? "tr-TR" : "en-GB", { day: "numeric", month: "long", year: "numeric" });
  // Identifies the data snapshot: asset + latest anchored batch
  const reportId = `EF-ESG-${r.asset.asset_id.slice(0, 3).toUpperCase()}-B${r.batches[0]?.id ?? 0}`;

  const risks: [string, string, string, string, string][] = [
    [tx("Düzenleyici / hukuki", "Regulatory / legal"), tx("Yüksek", "High"), tx("Tokenizasyon birçok ülkede tam regüle değil", "Tokenization not fully regulated in many jurisdictions"), tx("KYC beyaz listesi, sandbox pilotu, hukuk danışmanlığı", "KYC whitelist, sandbox pilot, legal counsel"), tx("Kontrol altında", "Mitigated")],
    [tx("Akıllı sözleşme", "Smart contract"), tx("Orta", "Medium"), tx("Sözleşme hataları finansal kayba yol açabilir", "Contract bugs could cause financial loss"), tx("22 birim test, 2/3 çoklu imza, rol devri", "22 unit tests, 2-of-3 multisig, role handover"), tx("Kontrol altında", "Mitigated")],
    [tx("IoT veri güvenliği", "IoT data security"), tx("Orta", "Medium"), tx("Sensör verisinin manipülasyonu", "Manipulation of sensor data"), tx(`Ed25519 imzaları · ${r.integrity.rejected_messages} sahte mesaj reddedildi · YZ anomali tespiti`, `Ed25519 signatures · ${r.integrity.rejected_messages} forged messages rejected · AI anomaly detection`), r.integrity.flagged_batches ? tx("İzleniyor", "Monitored") : tx("Kontrol altında", "Mitigated")],
    [tx("Operasyonel performans", "Operational performance"), r.asset.performance_ratio < 0.7 ? tx("Orta", "Medium") : tx("Düşük", "Low"), tx("Ekipman yıpranması üretimi düşürebilir", "Equipment wear may reduce output"), tx("YZ performans düşüşü tespiti + bakım uyarıları", "AI degradation detection + maintenance alerts"), `PR ${num(r.asset.performance_ratio * 100)}%`],
    [tx("Kripto volatilitesi", "Crypto volatility"), tx("Düşük", "Low"), tx("Fiyat dalgalanmaları güveni etkileyebilir", "Price swings could affect confidence"), tx("Tüm ödemeler USDC stablecoin ile", "All settlement in USDC stablecoin"), tx("Kontrol altında", "Mitigated")],
  ];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between print:hidden">
        {user.role === "producer" ? (
          <Link href="/producer" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-text"><ArrowLeft className="size-4" />{t("nav.producer")}</Link>
        ) : (
          <Link href={user.role === "signer" ? "/governance" : "/portfolio"} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-text">
            <ArrowLeft className="size-4" />{user.role === "signer" ? t("nav.governance") : t("nav.portfolio")}
          </Link>
        )}
        <button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-xl bg-wind px-4 py-2 text-sm font-medium text-bg hover:bg-emerald-400">
          <Printer className="size-4" />{tx("PDF olarak indir", "Download as PDF")}
        </button>
      </div>

      <article className="report mx-auto max-w-[210mm] bg-white p-10 text-[13px] leading-relaxed text-slate-800 shadow-2xl print:max-w-none print:p-0 print:shadow-none">
        <header className="flex items-start justify-between border-b-2 border-emerald-600 pb-5">
          <div>
            <div className="flex items-center gap-2 text-emerald-700"><Zap className="size-5" /><span className="font-semibold">Eco-Fraction</span></div>
            <h1 className="mt-3 text-2xl font-bold text-slate-900">{tx("ESG ve Risk Raporu", "ESG & Risk Report")}</h1>
            <p className="text-slate-600">{r.asset.name} · {num(r.asset.capacity_kw / 1000)} MW · {r.asset.kind === "solar" ? tx("Güneş", "Solar") : tx("Rüzgar", "Wind")} · Azerbaijan</p>
          </div>
          <div className="text-right text-xs text-slate-500">
            <div>{today}</div>
            <div>{tx("Veri anı (sim.)", "Data as of (sim.)")}: {sim?.sim_time?.replace("T", " ").slice(0, 16)}</div>
            <div className="font-mono">{reportId}</div>
            <div>{tx("Hazırlayan", "Prepared for")}: {r.generated_for}</div>
          </div>
        </header>

        <Section title={tx("1. Yönetici özeti", "1. Executive summary")}>
          <div className="grid grid-cols-4 gap-3">
            <Box label={tx("ESG skoru", "ESG score")} value={`${num(r.esg.score, 1)}`} sub={`${tx("Derece", "Rating")} ${r.esg.rating}`} strong />
            <Box label={tx("Çevre (E) · %40", "Environmental (E) · 40%")} value={num(E.score, 1)} />
            <Box label={tx("Sosyal (S) · %20", "Social (S) · 20%")} value={num(S.score, 1)} />
            <Box label={tx("Yönetişim (G) · %40", "Governance (G) · 40%")} value={num(G.score, 1)} />
          </div>
          <p className="mt-3 text-slate-600">
            {tx(`Varlık son 24 saatte ${num(r.asset.energy_24h_kwh / 1000, 1)} MWh doğrulanmış enerji üretti (kapasite faktörü %${num(r.asset.capacity_factor_24h * 100, 1)}, performans oranı %${num(r.asset.performance_ratio * 100)}). Yıllık bazda yaklaşık ${num(E.co2_avoided_annual_t)} ton CO₂ salımını önlemekte ve ${num(E.households_powered)} haneye eşdeğer enerji sağlamaktadır. Tüm üretim verisi cihaz imzalıdır ve saatlik olarak zincire kaydedilmiştir.`,
              `Over the last 24 hours the asset produced ${num(r.asset.energy_24h_kwh / 1000, 1)} MWh of verified energy (capacity factor ${num(r.asset.capacity_factor_24h * 100, 1)}%, performance ratio ${num(r.asset.performance_ratio * 100)}%). On an annual basis it avoids about ${num(E.co2_avoided_annual_t)} t of CO₂ and supplies the equivalent of ${num(E.households_powered)} households. All production data is device-signed and anchored on-chain hourly.`)}
          </p>
        </Section>

        <Section title={tx("2. Çevresel performans", "2. Environmental performance")}>
          <Table rows={[
            [tx("24s kapasite faktörü", "24h capacity factor"), `${num(E.capacity_factor_24h * 100, 1)}%`, tx(`Referans %${num(E.benchmark_capacity_factor * 100)}`, `Benchmark ${num(E.benchmark_capacity_factor * 100)}%`)],
            [tx("Önlenen CO₂ (doğrulanmış, canlı)", "CO₂ avoided (verified, live)"), `${num(E.co2_avoided_t, 1)} t`, tx(`Şebeke faktörü ${E.grid_emission_factor_kg_kwh} kg/kWh`, `Grid factor ${E.grid_emission_factor_kg_kwh} kg/kWh`)],
            [tx("Yıllık önlenen CO₂ (tahmini)", "Annual CO₂ avoided (est.)"), `${num(E.co2_avoided_annual_t)} t`, ""],
            [tx("Gelecek 24s üretim tahmini (LSTM)", "Next 24h production forecast (LSTM)"), `${num(r.asset.forecast_next_24h_kwh / 1000, 1)} MWh`, ""],
          ]} />
        </Section>

        <Section title={tx("3. Sosyal etki", "3. Social impact")}>
          <Table rows={[
            [tx("Yerel istihdam", "Local jobs"), num(S.jobs), `${num(S.jobs_per_mw, 2)} / MW`],
            [tx("Yerel işe alım oranı", "Local hiring"), `${S.local_hiring_pct}%`, tx("Üretici beyanı", "Producer declaration")],
            [tx("Topluluk programı", "Community program"), tx(S.community_program_tr ?? S.community_program, S.community_program), ""],
          ]} />
        </Section>

        <Section title={tx("4. Yönetişim ve veri bütünlüğü", "4. Governance & data integrity")}>
          <Table rows={[
            [tx("Veri bütünlüğü (doğrulanan / tüm mesajlar)", "Data integrity (verified / all messages)"), `${num(G.data_integrity * 100, 2)}%`, `${num(G.verified_readings)} ${tx("okuma", "readings")}`],
            [tx("Reddedilen sahte cihaz mesajı", "Rejected forged-device messages"), num(G.rejected_messages), tx("Ed25519 imza kontrolü", "Ed25519 signature check")],
            [tx("Zincire yazılan / işaretlenen parti", "Anchored / flagged batches"), `${r.integrity.anchored_batches} / ${r.integrity.flagged_batches}`, "EnergyOracle"],
            [tx("Finansman (net) / yatırımcı", "Financing (net) / investors"), money(r.asset.raised_usdc, { decimals: 0 }), `${num(r.asset.investors)} ${tx("yatırımcı", "investors")}`],
          ]} />
          <div className="mt-3 text-xs text-slate-500">{tx("Kontroller", "Controls")}: Ed25519 · {tx("zincir üstü kayıt", "on-chain anchoring")} · 2/3 multisig · KYC whitelist</div>
        </Section>

        <Section title={tx("5. Risk değerlendirmesi", "5. Risk assessment")}>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-emerald-700 text-left text-white">
                {[tx("Risk", "Risk"), tx("Seviye", "Level"), tx("Açıklama", "Description"), tx("Azaltma", "Mitigation"), tx("Durum", "Status")].map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {risks.map((row) => (
                <tr key={row[0]} className="border-b border-slate-200 align-top">
                  {row.map((c, i) => <td key={i} className={`px-2 py-1.5 ${i === 0 ? "font-medium" : ""}`}>{c}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title={tx("6. Zincir üstü üretim kayıtları (son 12)", "6. On-chain production records (last 12)")}>
          <table className="w-full border-collapse font-mono text-[10.5px]">
            <thead><tr className="border-b border-slate-300 text-left text-slate-500"><th className="py-1">#</th><th>{tx("Dönem", "Period")}</th><th>MWh</th><th>{tx("YZ", "AI")}</th><th>{tx("Durum", "Status")}</th><th>SHA-256</th></tr></thead>
            <tbody>
              {r.batches.map((b) => (
                <tr key={b.id} className="border-b border-slate-100">
                  <td className="py-0.5">{b.id}</td><td>{b.period_start.slice(5, 16).replace("T", " ")}</td>
                  <td>{num(b.energy_kwh / 1000, 2)}</td><td>{t(`verdict.${b.verdict}` as never)}</td>
                  <td>{t(`status.${b.status}` as never)}</td><td>{b.data_hash.slice(0, 18)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        {r.alerts.length > 0 && (
          <Section title={tx("7. Uyarı kaydı", "7. Alert log")}>
            <ul className="space-y-1 text-xs">
              {r.alerts.slice(0, 8).map((a, i) => <li key={i}><b>{lang === "tr" ? a.title_tr ?? a.title : a.title}</b>{a.active ? "" : ` (${tx("kapandı", "closed")})`}: {lang === "tr" ? a.detail_tr ?? a.detail : a.detail}</li>)}
            </ul>
          </Section>
        )}

        <footer className="mt-8 border-t border-slate-200 pt-4 text-[10.5px] text-slate-500">
          {tx("Metodoloji: E puanı canlı kapasite faktörünün teknoloji referansına oranından, G puanı veri bütünlüğü, anomali oranı ve kontrollerden hesaplanır; S puanı üretici beyanıdır. Sözleşmeler: ",
            "Methodology: E score from live capacity factor vs technology benchmark; G score from data integrity, anomaly rate and controls; S score is producer-declared. Contracts: ")}
          <span className="font-mono">EnergyOracle {r.contracts.oracle} · AssetToken {r.contracts.token}</span>.{" "}
          {tx("Demo ortamı: yerel EVM zinciri ve test USDC. Yatırım tavsiyesi değildir.", "Demo environment: local EVM chain and test USDC. Not investment advice.")}
        </footer>
      </article>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 break-inside-avoid">
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-emerald-800">{title}</h2>
      {children}
    </section>
  );
}

function Box({ label, value, sub, strong }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${strong ? "border-emerald-600 bg-emerald-50" : "border-slate-200"}`}>
      <div className="text-[10.5px] text-slate-500">{label}</div>
      <div className={`text-xl font-bold ${strong ? "text-emerald-700" : "text-slate-900"}`}>{value}</div>
      {sub && <div className="text-[11px] font-medium text-emerald-700">{sub}</div>}
    </div>
  );
}

function Table({ rows }: { rows: [string, string, string][] }) {
  return (
    <table className="w-full border-collapse">
      <tbody>
        {rows.map(([k, v, note]) => (
          <tr key={k} className="border-b border-slate-100">
            <td className="py-1.5 text-slate-600">{k}</td>
            <td className="py-1.5 text-right font-semibold text-slate-900">{v}</td>
            <td className="py-1.5 pl-4 text-right text-xs text-slate-500">{note}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
