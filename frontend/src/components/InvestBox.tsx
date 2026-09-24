"use client";

import { CheckCircle2, Loader2, Minus, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useData } from "@/lib/live";
import { usePrefs } from "@/lib/prefs";
import type { Asset, Portfolio } from "@/lib/types";
import { Button, Card, TxLink } from "./ui";

const PRESETS = [5, 25, 100, 500];

export function InvestBox({ asset, onDone }: { asset: Asset; onDone?: () => void }) {
  const { t, money, num } = usePrefs();
  const { user } = useAuth();
  const [shares, setShares] = useState(25);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ tx: string; shares: number } | null>(null);
  const { data: pf, reload } = useData<Portfolio>(user ? "/portfolio" : null);

  const cost = shares * asset.pricePerShare;
  const ownership = shares / asset.totalShares;
  const income = asset.annualRevenueUsd * ownership;
  const co2Kg = (asset.annualRevenueUsd / 0.05) * ownership * 0.44;
  const tooSmall = cost < 50;

  const buy = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ tx_hash: string }>("/invest", { method: "POST", json: { asset_id: asset.id, shares } });
      setDone({ tx: r.tx_hash, shares });
      reload();
      onDone?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="glow-wind">
      <h3 className="font-semibold">{t("invest.title")}</h3>
      <label className="mt-4 block text-xs text-faint">{t("invest.shares")}</label>
      <div className="mt-1.5 flex items-center gap-2">
        <button onClick={() => setShares((s) => Math.max(1, s - 5))} className="rounded-lg border border-line p-2 hover:bg-surface-2"><Minus className="size-4" /></button>
        <input type="number" min={1} value={shares} onChange={(e) => setShares(Math.max(1, Number(e.target.value) || 1))}
          className="num w-full rounded-lg border border-line bg-bg px-3 py-2 text-center text-lg font-semibold outline-none focus:border-wind" />
        <button onClick={() => setShares((s) => s + 5)} className="rounded-lg border border-line p-2 hover:bg-surface-2"><Plus className="size-4" /></button>
      </div>
      <div className="mt-2 flex gap-1.5">
        {PRESETS.map((p) => (
          <button key={p} onClick={() => setShares(p)}
            className={`flex-1 rounded-md py-1 text-xs ring-1 ${shares === p ? "text-wind ring-wind/40" : "text-muted ring-line"}`}>
            {money(p * asset.pricePerShare, { decimals: 0 })}
          </button>
        ))}
      </div>

      <dl className="mt-5 space-y-2 text-sm">
        <Row label={t("invest.cost")} value={<span className="text-lg font-semibold">{money(cost)}</span>} />
        <Row label={t("invest.ownership")} value={`${num(ownership * 100, 5)}%`} />
        <Row label={t("invest.projected")} value={<span className="text-money">{money(income)}{t("common.perYear")}</span>} />
        <Row label={t("invest.co2")} value={`${num(co2Kg, 0)} kg`} />
        <Row label={t("invest.fee")} value={<span className="text-faint">{money(cost * 0.01)}</span>} />
      </dl>

      {tooSmall && <p className="mt-3 text-xs text-warn">{t("invest.min")}</p>}
      {error && <p className="mt-3 text-xs text-alert">{error}</p>}
      {done && (
        <div className="mt-3 flex items-center justify-between rounded-lg bg-wind/10 px-3 py-2 text-sm text-wind">
          <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="size-4" />{t("invest.success", { shares: done.shares })}</span>
          <TxLink hash={done.tx} />
        </div>
      )}

      <div className="mt-4">
        {!user ? (
          <Link href="/login"><Button className="w-full">{t("invest.signIn")}</Button></Link>
        ) : user.kyc !== "verified" ? (
          <Link href="/login?step=kyc"><Button className="w-full" variant="outline">{t("invest.kyc")}</Button></Link>
        ) : (
          <Button className="w-full" disabled={busy || tooSmall || user.role !== "investor"} onClick={buy}>
            {busy ? <><Loader2 className="size-4 animate-spin" />{t("invest.processing")}</> : t("invest.button", { amount: money(cost) })}
          </Button>
        )}
      </div>
      {pf && <p className="mt-2 text-center text-xs text-faint">{t("invest.balance")}: {money(pf.usdc_balance)}</p>}
    </Card>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="num text-right">{value}</dd>
    </div>
  );
}
