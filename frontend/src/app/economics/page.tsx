"use client";

import { ArrowRightLeft, Building2, FileKey2, Landmark, Leaf, Sparkles } from "lucide-react";
import { AnimatedNumber, Badge, Card, SectionTitle, Skeleton } from "@/components/ui";
import { useData } from "@/lib/live";
import { usePrefs } from "@/lib/prefs";

const PIPELINE_TR: Record<string, string> = {
  "Regional utility (pilot)": "Bölgesel dağıtım şirketi",
  "Green bond issuer": "Yeşil tahvil ihraççısı",
};
const STAGE_TR: Record<string, string> = { pilot: "pilot", negotiation: "görüşme" };

type Econ = {
  live: { treasury_usdc: number; fee_rate: number; primary_volume_usdc: number; primary_fees_usdc: number;
          secondary_volume_usdc: number; secondary_fees_usdc: number; trades: number };
  saas: { mrr_usd: number; arr_usd: number; subscribers: { producer: string; plan: string; price_month: number }[] };
  licensing: { pipeline: { client: string; stage: string; annual_usd: number }[]; pipeline_annual_usd: number };
  carbon: { verified_co2_t: number; annual_co2_t_portfolio: number; price_usd_t: number; platform_share: number;
            potential_annual_platform_usd: number };
};

export default function EconomicsPage() {
  const { tx, money, num } = usePrefs();
  const { data: e } = useData<Econ>("/platform/economics", { refreshOn: ["investment", "trade", "batch_settled"] });
  if (!e) return <Skeleton className="h-96" />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">{tx("İş modeli: Eco-Fraction nasıl kazanır?", "Business model: how Eco-Fraction earns")}</h1>
        <p className="mt-2 max-w-3xl text-muted">
          {tx("Ön değerlendirme raporundaki dört gelir kalemi. Komisyonlar zincir üstü hazineden canlı okunur; diğerleri açıkça etiketlenmiştir.",
            "The four revenue streams from our preliminary report. Commissions are read live from the on-chain treasury; the others are clearly labelled.")}
        </p>
      </div>

      {/* Live treasury */}
      <Card className="glow-wind grid gap-6 md:grid-cols-[1.2fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-faint"><Landmark className="size-4" />{tx("Platform hazinesi (zincir üstü)", "Platform treasury (on-chain)")}</div>
          <div className="mt-2 text-4xl font-semibold text-money"><AnimatedNumber value={e.live.treasury_usdc} format={(v) => money(v)} /></div>
          <div className="mt-1 text-xs text-muted">{tx("Tüm komisyonlar Treasury cüzdanında USDC olarak birikir.", "All commissions accrue as USDC in the Treasury wallet.")}</div>
        </div>
        <Mini label={tx("Birincil satış hacmi", "Primary volume")} value={money(e.live.primary_volume_usdc, { compact: true })} sub={`${tx("komisyon", "fees")} ${money(e.live.primary_fees_usdc, { decimals: 0 })}`} />
        <Mini label={tx("İkincil piyasa hacmi", "Secondary volume")} value={money(e.live.secondary_volume_usdc, { compact: true })} sub={`${num(e.live.trades)} ${tx("işlem", "trades")} · ${money(e.live.secondary_fees_usdc)}`} />
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Stream icon={<ArrowRightLeft className="size-5 text-chain" />} n="1" title={tx("İşlem komisyonu", "Transaction fee")}
          badge={<Badge tone="wind">{tx("Canlı · zincir üstü", "Live · on-chain")}</Badge>}
          text={tx(`Her birincil ve ikincil hisse satışından %0,5–%1,5 (şu an %${num(e.live.fee_rate * 100, 1)}). Oran yalnızca 2/3 çoklu imza ile, sözleşmedeki sınırlar içinde değiştirilebilir.`,
            `0.5–1.5% on every primary and secondary share sale (currently ${num(e.live.fee_rate * 100, 1)}%). The rate can only change via the 2-of-3 multisig, within bounds enforced by the contract.`)}
          value={money(e.live.primary_fees_usdc + e.live.secondary_fees_usdc)} valueLabel={tx("toplanan", "collected")} />
        <Stream icon={<Building2 className="size-5 text-ai" />} n="2" title={tx("SaaS aboneliği (B2B)", "SaaS subscription (B2B)")}
          badge={<Badge tone="ai">{tx("Demo sözleşmeler", "Demo contracts")}</Badge>}
          text={tx("Enerji şirketleri ve kurumsal yatırımcılar için gelişmiş ESG analizi, risk raporları ve veri panelleri.",
            "Advanced ESG analytics, risk reports and data dashboards for energy companies and institutional investors.")}
          value={`${money(e.saas.mrr_usd, { decimals: 0 })}/${tx("ay", "mo")}`} valueLabel={`ARR ${money(e.saas.arr_usd, { decimals: 0 })}`}
          extra={<div className="mt-3 flex flex-wrap gap-1.5">{e.saas.subscribers.map((s) => <Badge key={s.producer}>{s.producer === "solar" ? "Caspian Solar" : "Absheron Wind"} · {s.plan}</Badge>)}</div>} />
        <Stream icon={<FileKey2 className="size-5 text-solar" />} n="3" title={tx("Lisanslama", "Licensing")}
          badge={<Badge tone="warn">{tx("Satış hattı", "Pipeline")}</Badge>}
          text={tx("IoT + YZ ESG doğrulama altyapısı, üçüncü taraf enerji projelerine ve yeşil tahvil ihraççılarına lisanslanır.",
            "The IoT + AI ESG-verification stack licensed to third-party energy projects and green-bond issuers.")}
          value={`${money(e.licensing.pipeline_annual_usd, { decimals: 0 })}/${tx("yıl", "yr")}`} valueLabel={tx("görüşmedeki hat", "in negotiation")}
          extra={<ul className="mt-3 space-y-1 text-xs text-muted">{e.licensing.pipeline.map((p) => <li key={p.client}>· {tx(PIPELINE_TR[p.client] ?? p.client, p.client)} · {tx(STAGE_TR[p.stage] ?? p.stage, p.stage)} · {money(p.annual_usd, { decimals: 0 })}</li>)}</ul>} />
        <Stream icon={<Leaf className="size-5 text-wind" />} n="4" title={tx("Karbon kredisi entegrasyonu", "Carbon-credit integration")}
          badge={<Badge><Sparkles className="size-3" />{tx("Gelecek faz", "Future phase")}</Badge>}
          text={tx(`Zincirde doğrulanmış üretim, tokenize karbon kredisine dönüşür. Portföyün yıllık ~${num(e.carbon.annual_co2_t_portfolio)} t CO₂ tasarrufu, ${money(e.carbon.price_usd_t, { decimals: 0 })}/t referans fiyat ve %${num(e.carbon.platform_share * 100)} platform payı ile:`,
            `Production verified on-chain becomes tokenized carbon credits. At the portfolio's ~${num(e.carbon.annual_co2_t_portfolio)} t CO₂/yr, a ${money(e.carbon.price_usd_t, { decimals: 0 })}/t reference price and a ${num(e.carbon.platform_share * 100)}% platform share:`)}
          value={`${money(e.carbon.potential_annual_platform_usd, { decimals: 0 })}/${tx("yıl", "yr")}`} valueLabel={tx("potansiyel", "potential")}
          extra={<div className="mt-2 text-xs text-faint">{tx("Şimdiye kadar doğrulanan", "Verified so far")}: {num(e.carbon.verified_co2_t, 1)} t CO₂</div>} />
      </div>

      <Card>
        <SectionTitle title={tx("Pazar fırsatı", "Market opportunity")} hint={tx("Ön değerlendirme raporu, Bölüm 4.1", "Preliminary report, section 4.1")} />
        <div className="grid gap-4 md:grid-cols-4">
          <Fact value="$16T" label={tx("RWA tokenizasyon pazarı, 2030", "RWA tokenization market by 2030")} src="BCG, 2024" />
          <Fact value="$5T" label={tx("Yenilenebilir enerji yatırım ihtiyacı, 2030", "Renewable investment need by 2030")} src="IEA, 2024" />
          <Fact value="%20+" label={tx("Yeşil FinTech yıllık büyüme, 2028'e kadar", "Green FinTech annual growth to 2028")} src="MarketsandMarkets, 2024" />
          <Fact value="$3B" label={tx("Azerbaycan Yeşil Enerji Stratejisi 2030 hedefi", "Azerbaijan Green Energy Strategy 2030 target")} src="president.az, 2023" />
        </div>
      </Card>
    </div>
  );
}

function Mini({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl bg-surface-2 p-4">
      <div className="text-xs text-faint">{label}</div>
      <div className="num mt-1 text-2xl font-semibold">{value}</div>
      <div className="mt-0.5 text-xs text-muted">{sub}</div>
    </div>
  );
}

function Stream({ icon, n, title, badge, text, value, valueLabel, extra }: {
  icon: React.ReactNode; n: string; title: string; badge: React.ReactNode; text: string;
  value: string; valueLabel: string; extra?: React.ReactNode;
}) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">{icon}<span className="font-semibold">{title}</span></div>
        <div className="flex items-center gap-2">{badge}<span className="font-mono text-xs text-faint">0{n}</span></div>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-muted">{text}</p>
      <div className="mt-4 flex items-baseline gap-2">
        <span className="num text-2xl font-semibold">{value}</span>
        <span className="text-xs text-faint">{valueLabel}</span>
      </div>
      {extra}
    </Card>
  );
}

function Fact({ value, label, src }: { value: string; label: string; src: string }) {
  return (
    <div className="rounded-xl bg-surface-2 p-4">
      <div className="bg-gradient-to-r from-wind to-chain bg-clip-text text-3xl font-semibold text-transparent">{value}</div>
      <div className="mt-1 text-sm">{label}</div>
      <div className="mt-1 text-xs text-faint">{src}</div>
    </div>
  );
}
