"use client";

import { motion } from "motion/react";
import { ArrowRight, BadgeCheck, Brain, Coins, Cpu, Droplets, Link2, Lock, Radio, Scale, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { AzMap } from "@/components/AzMap";
import { LiveFeed } from "@/components/LiveFeed";
import { AnimatedNumber, Card, SectionTitle } from "@/components/ui";
import { useData, useLive } from "@/lib/live";
import { usePrefs } from "@/lib/prefs";
import type { Asset, PlatformStats } from "@/lib/types";

export default function Landing() {
  const { t, money, num } = usePrefs();
  const { latest } = useLive();
  const { data: assets } = useData<Asset[]>("/assets", { refreshOn: ["batch_settled", "alert"] });
  const { data: stats } = useData<PlatformStats>("/platform/stats", { refreshOn: ["batch_settled", "investment"] });

  const liveMw = Object.values(latest).reduce((s, r) => s + r.power_kw, 0) / 1000;
  const co2 = (stats?.energy_mwh ?? 0) * 0.44;

  return (
    <div className="space-y-16">
      {/* Hero */}
      <section className="grid items-center gap-10 pt-6 lg:grid-cols-[1.1fr_1fr]">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-line bg-surface/60 px-3 py-1 text-xs text-muted">
            <span className="live-dot size-1.5 rounded-full bg-wind" />{t("hero.kicker")}
          </div>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            {t("hero.title1")}<br />
            <span className="bg-gradient-to-r from-wind via-chain to-solar bg-clip-text text-transparent">{t("hero.title2")}</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">{t("hero.subtitle")}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/assets" className="inline-flex items-center gap-2 rounded-xl bg-wind px-5 py-3 font-medium text-bg hover:bg-emerald-400">
              {t("hero.cta")} <ArrowRight className="size-4" />
            </Link>
            <Link href="/architecture" className="inline-flex items-center gap-2 rounded-xl border border-line px-5 py-3 font-medium hover:bg-surface-2">
              <Radio className="size-4 text-chain" /> {t("hero.cta2")}
            </Link>
          </div>
        </motion.div>

        <div className="grid grid-cols-2 gap-3">
          <BigStat label={t("stats.liveOutput")} tone="text-wind">
            <AnimatedNumber value={liveMw} format={(v) => `${num(v, 1)} MW`} />
          </BigStat>
          <BigStat label={t("stats.distributed")} tone="text-money">
            <AnimatedNumber value={stats?.revenue_distributed_usdc ?? 0} format={(v) => money(v, { decimals: 0 })} />
          </BigStat>
          <BigStat label={t("stats.energy")} tone="text-chain">
            <AnimatedNumber value={stats?.energy_mwh ?? 0} format={(v) => `${num(v, 1)} MWh`} />
          </BigStat>
          <BigStat label={t("stats.co2")} tone="text-wind">
            <AnimatedNumber value={co2} format={(v) => `${num(v, 1)} t`} />
          </BigStat>
          <BigStat label={t("stats.investors")} tone="text-text">
            <AnimatedNumber value={stats?.investors ?? 0} format={(v) => num(v)} />
          </BigStat>
          <BigStat label={t("stats.escrow")} tone={(stats?.revenue_escrowed_usdc ?? 0) > 0 ? "text-alert" : "text-muted"}>
            <AnimatedNumber value={stats?.revenue_escrowed_usdc ?? 0} format={(v) => money(v, { decimals: 0 })} />
          </BigStat>
        </div>
      </section>

      {/* Map + feed */}
      <section className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <SectionTitle title={t("map.title")} hint={t("map.subtitle")} />
          {assets ? <AzMap assets={assets} /> : <div className="aspect-[640/460]" />}
        </Card>
        <Card className="flex flex-col">
          <SectionTitle title={t("feed.title")} right={<span className="live-dot size-2 rounded-full bg-wind" />} />
          <LiveFeed className="max-h-[460px] flex-1" max={14} />
        </Card>
      </section>

      {/* Problem -> solution (report section 2.1) */}
      <section>
        <h2 className="mb-6 text-2xl font-semibold tracking-tight">{t("why.title")}</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {([
            [Coins, "why.p1"], [Droplets, "why.p2"], [Scale, "why.p3"], [BadgeCheck, "why.p4"],
          ] as const).map(([Icon, k]) => (
            <Card key={k} className="flex flex-col gap-3">
              <Icon className="size-5 text-wind" />
              <div className="font-semibold">{t(`${k}.problem`)}</div>
              <div className="text-sm text-faint line-through decoration-alert/60">{t(`${k}.old`)}</div>
              <div className="text-sm text-text">{t(`${k}.new`)}</div>
            </Card>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section>
        <div className="mb-6 flex items-end justify-between">
          <h2 className="text-2xl font-semibold tracking-tight">{t("how.title")}</h2>
          <Link href="/architecture" className="text-sm text-chain hover:underline">{t("hero.cta2")} →</Link>
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          {([
            [Cpu, "how.s1", "text-solar"], [Brain, "how.s2", "text-ai"], [Lock, "how.s3", "text-chain"], [ShieldCheck, "how.s4", "text-money"],
          ] as const).map(([Icon, k, tone], i) => (
            <Card key={k} className="relative">
              <div className="absolute right-4 top-4 font-mono text-xs text-faint">0{i + 1}</div>
              <Icon className={`size-6 ${tone}`} />
              <div className="mt-3 font-semibold">{t(`${k}.title`)}</div>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{t(`${k}.text`)}</p>
            </Card>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-faint">
          {["MQTT", "Kafka", "XGBoost", "LSTM", "ERC-1155", "USDC", "Ed25519", "2-of-3 Multisig", "KYC Whitelist"].map((x) => (
            <span key={x} className="inline-flex items-center gap-1.5"><Link2 className="size-3" />{x}</span>
          ))}
        </div>
      </section>
    </div>
  );
}

function BigStat({ label, tone, children }: { label: string; tone: string; children: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium uppercase tracking-wider text-faint">{label}</div>
      <div className={`mt-2 text-2xl font-semibold tracking-tight ${tone}`}>{children}</div>
    </Card>
  );
}
