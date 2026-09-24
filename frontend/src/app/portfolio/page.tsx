"use client";

import clsx from "clsx";
import { motion } from "motion/react";
import { ArrowDownLeft, BadgeCheck, Coins, Leaf, ShoppingCart, Wallet } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { AnimatedNumber, Badge, Button, Card, EsgBadge, KindIcon, SectionTitle, Skeleton, TxLink } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useData, useLiveEvent } from "@/lib/live";
import { assetName } from "@/lib/assets";
import { usePrefs } from "@/lib/prefs";
import type { ActivityT, Portfolio } from "@/lib/types";

export default function PortfolioPage() {
  const { t, money, num } = usePrefs();
  const { user, ready } = useAuth();
  const { data: pf } = useData<Portfolio>(user ? "/portfolio" : null, { refreshOn: ["payout", "investment"] });
  const { data: activity } = useData<ActivityT[]>(user ? "/activity?limit=40" : null, { refreshOn: ["payout", "investment"] });
  const [flash, setFlash] = useState(0);

  // Pulse the earnings figure whenever a payout lands in this wallet
  useLiveEvent(["payout"], (e) => {
    if (user && e.data.user_id === user.id) setFlash((n) => n + 1);
  });

  if (!ready) return <Skeleton className="h-96" />;
  if (!user) {
    return (
      <Card className="mx-auto max-w-md py-12 text-center">
        <Wallet className="mx-auto size-8 text-faint" />
        <p className="mt-4 text-muted">{t("pf.signIn")}</p>
        <Link href="/login"><Button className="mt-6">{t("nav.signIn")}</Button></Link>
      </Card>
    );
  }
  if (!pf) return <Skeleton className="h-96" />;

  const co2 = pf.holdings.reduce((s, h) => s + h.co2_avoided_annual_kg, 0);
  const hourly = pf.earning_rate_per_sim_hour;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{t("pf.title")}</h1>
          <p className="mt-1 text-sm text-muted">
            {pf.user.name} · <span className="font-mono text-xs">{pf.user.wallet.slice(0, 10)}…{pf.user.wallet.slice(-6)}</span>
            {pf.user.kyc === "verified" && <Badge tone="wind" className="ml-2"><BadgeCheck className="size-3" />KYC</Badge>}
          </p>
        </div>
      </div>

      {/* Headline numbers */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="lg:col-span-2">
          <div className="text-xs font-medium uppercase tracking-wider text-faint">{t("pf.earned")}</div>
          <motion.div key={flash} initial={{ scale: 1.03, color: "#6ee7b7" }} animate={{ scale: 1, color: "#34d399" }}
            transition={{ duration: 0.8 }} className="mt-2 text-4xl font-semibold tracking-tight">
            <AnimatedNumber value={pf.total_earned_usdc} format={(v) => money(v, { decimals: 4 })} duration={1.2} />
          </motion.div>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
            <span>{t("pf.rate")}: <b className="num text-money">+{money(hourly, { decimals: 4 })}</b>{t("pf.perHour")}</span>
          </div>
          <p className="mt-1 text-xs text-faint">{t("pf.earnedHint")}</p>
        </Card>
        <Card>
          <div className="text-xs font-medium uppercase tracking-wider text-faint">{t("pf.projected")}</div>
          <div className="mt-2 text-2xl font-semibold text-money">
            <AnimatedNumber value={pf.projected_annual_income_usdc} format={(v) => money(v)} />
          </div>
          <div className="mt-1 text-xs text-muted">
            {pf.invested_value_usdc ? `${num((pf.projected_annual_income_usdc / pf.invested_value_usdc) * 100, 1)}% ${t("common.expectedYield").toLowerCase()}` : ""}
          </div>
        </Card>
        <Card>
          <div className="text-xs font-medium uppercase tracking-wider text-faint">{t("pf.value")}</div>
          <div className="mt-2 text-2xl font-semibold"><AnimatedNumber value={pf.invested_value_usdc} format={(v) => money(v, { decimals: 0 })} /></div>
          <div className="mt-1 text-xs text-muted">{t("pf.balance")}: {money(pf.usdc_balance)}</div>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="flex items-center gap-4">
          <div className="grid size-12 place-items-center rounded-xl bg-wind/10"><Leaf className="size-6 text-wind" /></div>
          <div>
            <div className="text-xs uppercase tracking-wider text-faint">{t("pf.co2")}</div>
            <div className="text-xl font-semibold">{num(co2 / 1000, 2)} t CO₂</div>
          </div>
        </Card>
        <Card className="flex items-center gap-4">
          <div className="grid size-12 place-items-center rounded-xl bg-chain/10"><BadgeCheck className="size-6 text-chain" /></div>
          <div className="flex-1">
            <div className="text-xs uppercase tracking-wider text-faint">{t("pf.esg")}</div>
            <div className="text-xl font-semibold">{pf.portfolio_esg ? num(pf.portfolio_esg, 1) : "–"} / 100</div>
          </div>
        </Card>
      </div>

      {/* Holdings */}
      <Card>
        <SectionTitle title={t("pf.holdings")} />
        {pf.holdings.length === 0 ? (
          <div className="py-8 text-center text-muted">
            {t("pf.empty")} <Link href="/assets" className="text-wind hover:underline">{t("hero.cta")} →</Link>
          </div>
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-faint">
                <tr>
                  <th className="pb-2 font-medium">{t("nav.assets")}</th>
                  <th className="pb-2 text-right font-medium">{t("common.share")}</th>
                  <th className="pb-2 text-right font-medium">{t("pf.ownership")}</th>
                  <th className="pb-2 text-right font-medium">{t("pf.colValue")}</th>
                  <th className="pb-2 text-right font-medium">{t("pf.earned")}</th>
                  <th className="pb-2 text-right font-medium">{t("pf.projected")}</th>
                  <th className="pb-2 text-right font-medium">ESG</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {pf.holdings.map((h) => (
                  <tr key={h.asset_id}>
                    <td className="py-3">
                      <Link href={`/assets/${h.asset_id}`} className="flex items-center gap-2 font-medium hover:text-wind">
                        <KindIcon kind={h.kind} className="size-4" />{h.name}
                      </Link>
                    </td>
                    <td className="num py-3 text-right">{num(h.shares)}</td>
                    <td className="num py-3 text-right text-muted">{num(h.ownership * 100, 4)}%</td>
                    <td className="num py-3 text-right">{money(h.value_usdc, { decimals: 0 })}</td>
                    <td className="num py-3 text-right text-money">
                      <AnimatedNumber value={h.earned_usdc} format={(v) => money(v, { decimals: 4 })} />
                    </td>
                    <td className="num py-3 text-right">{money(h.projected_annual_income_usdc)}</td>
                    <td className="py-3 text-right"><EsgBadge rating={h.esg.rating} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Activity */}
      <Card>
        <SectionTitle title={t("pf.activity")} />
        <div className="scroll-thin max-h-[420px] space-y-1 overflow-y-auto">
          {(activity ?? []).map((a) => <ActivityRow key={a.id} a={a} />)}
        </div>
      </Card>
    </div>
  );
}

const ICONS = { deposit: ArrowDownLeft, buy: ShoppingCart, payout: Coins, kyc: BadgeCheck, sell: Coins, trade_buy: ShoppingCart };

function ActivityRow({ a }: { a: ActivityT }) {
  const { t, money, num, lang } = usePrefs();
  const Icon = ICONS[a.kind] ?? Coins;
  const positive = a.kind === "payout" || a.kind === "deposit" || a.kind === "sell";
  const time = new Date(a.created_at).toLocaleTimeString(lang === "tr" ? "tr-TR" : "en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return (
    <div className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-surface-2">
      <span className={clsx("grid size-8 place-items-center rounded-lg", positive ? "bg-money/10 text-money" : "bg-surface-2 text-muted")}>
        <Icon className="size-4" />
      </span>
      <div className="flex-1">
        <div>{t(`act.${a.kind}`)}{a.asset_id && <span className="text-muted"> · {assetName(a.asset_id)}</span>}</div>
        <div className="text-xs text-faint">{time}{a.shares ? ` · ${num(a.shares)} ${t("common.shares")}` : ""}</div>
      </div>
      {a.amount_usdc != null && (
        <span className={clsx("num font-medium", positive ? "text-money" : "text-text")}>
          {positive ? "+" : "−"}{money(a.amount_usdc, { decimals: a.amount_usdc < 1 ? 6 : 2 })}
        </span>
      )}
      <TxLink hash={a.tx_hash} />
    </div>
  );
}
