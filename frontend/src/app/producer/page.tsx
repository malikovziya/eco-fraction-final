"use client";

import clsx from "clsx";
import { Building2, Check, FileText, Gauge, Lock, ShieldAlert, Sparkles, Users, Wrench } from "lucide-react";
import Link from "next/link";
import { Badge, Button, Card, EsgBadge, KindIcon, Progress, SectionTitle, Skeleton } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useData } from "@/lib/live";
import { usePrefs } from "@/lib/prefs";
import type { Kind } from "@/lib/types";

type AssetOps = {
  asset_id: string; name: string; kind: Kind; capacity_kw: number; raised_usdc: number; offered_usdc: number;
  investors: number; energy_24h_kwh: number; capacity_factor_24h: number; performance_ratio: number;
  revenue_24h_usdc: number; escrowed_batches: number[]; forecast_next_24h_kwh: number;
  alerts: { id: number; kind: string; severity: string; title: string; detail: string; title_tr: string | null; detail_tr: string | null }[];
  esg: { score: number; rating: string };
};
type Overview = {
  producer: { name: string; wallet: string };
  usdc_balance: number; revenue_received_usdc: number; raised_total_usdc: number; investors_total: number;
  assets: AssetOps[];
  subscription: { plan: string; price_month: number; features: string[]; plans: Record<string, { price_month: number; features: string[] }> };
};

const FEATURES: Record<string, [string, string]> = {
  listing: ["Varlık listeleme ve tokenizasyon", "Asset listing & tokenization"],
  live_monitoring: ["Canlı IoT izleme", "Live IoT monitoring"],
  esg_reports: ["Gelişmiş ESG raporları", "Advanced ESG reports"],
  risk_reports: ["Risk raporları", "Risk reports"],
  forecast: ["YZ üretim tahmini", "AI production forecast"],
  api_access: ["Veri API erişimi", "Data API access"],
  white_label: ["Beyaz etiket panel", "White-label dashboard"],
};

export default function ProducerPage() {
  const { tx, money, num, lang } = usePrefs();
  const { user, ready } = useAuth();
  const { data } = useData<Overview>(user?.role === "producer" ? "/producer/overview" : null,
    { refreshOn: ["batch_settled", "alert", "investment"] });
  const i = lang === "tr" ? 0 : 1;

  if (!ready) return <Skeleton className="h-96" />;
  if (user?.role !== "producer") {
    return (
      <Card className="mx-auto max-w-md py-10 text-center">
        <Building2 className="mx-auto size-8 text-faint" />
        <p className="mt-4 text-muted">{tx("Bu panel enerji üreticileri içindir.", "This dashboard is for energy producers.")}</p>
        <Link href="/login"><Button className="mt-6">{tx("Üretici olarak giriş yap", "Sign in as a producer")}</Button></Link>
      </Card>
    );
  }
  if (!data) return <Skeleton className="h-96" />;
  const sub = data.subscription;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-faint">{tx("Üretici paneli · B2B", "Producer dashboard · B2B")}</div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{data.producer.name}</h1>
        </div>
        <Badge tone="ai" className="px-3 py-1 text-sm"><Sparkles className="size-3.5" />{sub.plan} {tx("plan", "plan")} · {money(sub.price_month, { decimals: 0 })}/{tx("ay", "mo")}</Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Kpi label={tx("Platformdan sağlanan finansman", "Financing raised")} value={money(data.raised_total_usdc, { decimals: 0 })} tone="text-money" />
        <Kpi label={tx("Yatırımcı sayısı", "Investors")} value={num(data.investors_total)} />
        <Kpi label={tx("Alınan üretim geliri", "Revenue received")} value={money(data.revenue_received_usdc, { decimals: 0 })} sub={tx("hissedar olarak (%80 pay)", "as shareholder (80% stake)")} />
        <Kpi label={tx("USDC bakiyesi", "USDC balance")} value={money(data.usdc_balance, { decimals: 0 })} />
      </div>

      {data.assets.map((a) => (
        <Card key={a.asset_id}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className={clsx("grid size-11 place-items-center rounded-xl", a.kind === "solar" ? "bg-solar/10" : "bg-wind/10")}><KindIcon kind={a.kind} className="size-5" /></div>
              <div>
                <Link href={`/assets/${a.asset_id}`} className="text-lg font-semibold hover:text-wind">{a.name}</Link>
                <div className="text-xs text-muted">{num(a.capacity_kw / 1000)} MW</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <EsgBadge rating={a.esg.rating} score={a.esg.score} />
              <Link href={`/producer/report/${a.asset_id}`}>
                <Button variant="outline" className="py-1.5"><FileText className="size-4" />{tx("ESG & risk raporu (PDF)", "ESG & risk report (PDF)")}</Button>
              </Link>
            </div>
          </div>

          <div className="mt-5 grid gap-5 md:grid-cols-4">
            <div>
              <div className="flex items-center gap-1.5 text-xs text-faint"><Users className="size-3.5" />{tx("Finansman", "Financing")}</div>
              <div className="num mt-1 font-semibold">{money(a.raised_usdc, { compact: true })} <span className="text-xs font-normal text-faint">/ {money(a.offered_usdc, { compact: true })}</span></div>
              <div className="mt-2"><Progress value={a.raised_usdc / a.offered_usdc} tone={a.kind === "solar" ? "solar" : "wind"} /></div>
              <div className="mt-1 text-xs text-muted">{num(a.investors)} {tx("yatırımcı", "investors")}</div>
            </div>
            <div>
              <div className="flex items-center gap-1.5 text-xs text-faint"><Gauge className="size-3.5" />{tx("Performans oranı (24s)", "Performance ratio (24h)")}</div>
              <div className={clsx("num mt-1 text-2xl font-semibold", a.performance_ratio >= 0.9 ? "text-wind" : a.performance_ratio >= 0.7 ? "text-warn" : "text-alert")}>{num(a.performance_ratio * 100)}%</div>
              <div className="text-xs text-muted">{tx("Kapasite faktörü", "Capacity factor")} {num(a.capacity_factor_24h * 100, 1)}%</div>
            </div>
            <div>
              <div className="text-xs text-faint">{tx("Son 24s üretim / gelecek 24s tahmin", "Last 24h output / next 24h forecast")}</div>
              <div className="num mt-1 font-semibold">{num(a.energy_24h_kwh / 1000, 1)} MWh</div>
              <div className="num text-xs text-ai">→ {num(a.forecast_next_24h_kwh / 1000, 1)} MWh (LSTM)</div>
            </div>
            <div>
              <div className="text-xs text-faint">{tx("Son 24s dağıtılan gelir", "Revenue distributed (24h)")}</div>
              <div className="num mt-1 font-semibold text-money">{money(a.revenue_24h_usdc, { decimals: 0 })}</div>
              {a.escrowed_batches.length > 0 && <Badge tone="alert" className="mt-1"><Lock className="size-3" />{a.escrowed_batches.length} {tx("parti emanette", "batches in escrow")}</Badge>}
            </div>
          </div>

          {a.alerts.length > 0 && (
            <div className="mt-5 space-y-2">
              {a.alerts.map((al) => (
                <div key={al.id} className={clsx("flex gap-3 rounded-xl p-3 text-sm", al.kind === "maintenance" ? "bg-warn/10" : "bg-alert/10")}>
                  {al.kind === "maintenance" ? <Wrench className="size-5 shrink-0 text-warn" /> : <ShieldAlert className="size-5 shrink-0 text-alert" />}
                  <div>
                    <div className="font-medium">{lang === "tr" ? al.title_tr ?? al.title : al.title}</div>
                    <div className="text-xs text-muted">{lang === "tr" ? al.detail_tr ?? al.detail : al.detail}</div>
                    {al.kind === "maintenance" && (
                      <div className="mt-1.5 text-xs text-warn">
                        {tx("Önerilen aksiyon: 48 saat içinde saha kontrolü planlayın (panel temizliği / inverter testi). Yatırımcı geliri etkilenmeden ödenmeye devam ediyor.",
                          "Suggested action: schedule a site check within 48h (panel cleaning / inverter test). Investor revenue continues to be paid.")}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      ))}

      <Card>
        <SectionTitle title={tx("SaaS abonelik planları", "SaaS subscription plans")} hint={tx("İş modeli: enerji şirketlerine yönelik gelişmiş analiz ve raporlama", "Business model: advanced analytics and reporting for energy companies")} />
        <div className="grid gap-4 md:grid-cols-3">
          {Object.entries(sub.plans).map(([name, plan]) => (
            <div key={name} className={clsx("rounded-xl border p-4", name === sub.plan ? "border-ai bg-ai/5" : "border-line")}>
              <div className="flex items-center justify-between">
                <span className="font-semibold">{name}</span>
                {name === sub.plan && <Badge tone="ai">{tx("Mevcut plan", "Current plan")}</Badge>}
              </div>
              <div className="num mt-2 text-2xl font-semibold">{plan.price_month ? money(plan.price_month, { decimals: 0 }) : tx("Ücretsiz", "Free")}<span className="text-sm font-normal text-faint">{plan.price_month ? `/${tx("ay", "mo")}` : ""}</span></div>
              <ul className="mt-3 space-y-1.5 text-xs">
                {Object.keys(FEATURES).map((f) => (
                  <li key={f} className={clsx("flex items-center gap-1.5", plan.features.includes(f) ? "text-muted" : "text-faint line-through")}>
                    <Check className={clsx("size-3.5", plan.features.includes(f) ? "text-wind" : "text-faint")} />{FEATURES[f][i]}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <Card>
      <div className="text-xs font-medium uppercase tracking-wider text-faint">{label}</div>
      <div className={clsx("num mt-2 text-2xl font-semibold", tone)}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </Card>
  );
}
