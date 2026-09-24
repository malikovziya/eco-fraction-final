"use client";

import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRightLeft, CheckCircle2, Loader2, Repeat2, Tag } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge, Button, Card, KindIcon, SectionTitle, Skeleton, TxLink } from "@/components/ui";
import { api } from "@/lib/api";
import { assetName } from "@/lib/assets";
import { useAuth } from "@/lib/auth";
import { useData } from "@/lib/live";
import { usePrefs } from "@/lib/prefs";
import type { Kind, Portfolio } from "@/lib/types";

type Listing = {
  id: number; asset_id: string; asset_name: string; kind: Kind; seller: string; seller_name: string;
  seller_id: number | null; shares: number; available: number; price_usdc: number; premium: number;
};
type Trade = { id: number; asset_id: string; shares: number; price_usdc: number; cost_usdc: number; fee_usdc: number; tx_hash: string; buyer: string; created_at: string };
type Summary = { asset_id: string; name: string; kind: Kind; last_price: number | null; volume_usdc: number; trades: number; best_ask: number | null; listings: number };

export default function MarketPage() {
  const { tx, money, num } = usePrefs();
  const { user } = useAuth();
  const [filter, setFilter] = useState<string | null>(null);
  const [buying, setBuying] = useState<Listing | null>(null);
  const refresh = ["trade", "listing"];
  const { data: listings, reload: reloadListings } = useData<Listing[]>("/market/listings", { refreshOn: refresh });
  const { data: trades } = useData<Trade[]>("/market/trades?limit=14", { refreshOn: refresh });
  const { data: summary } = useData<Summary[]>("/market/summary", { refreshOn: refresh });
  const shown = listings?.filter((l) => !filter || l.asset_id === filter);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight"><ArrowRightLeft className="size-7 text-chain" />{tx("İkincil piyasa", "Secondary market")}</h1>
        <p className="mt-2 max-w-3xl text-muted">
          {tx("Hisseler yıllarca kilitli kalmaz: yatırımcılar birbirine doğrudan satar. İlanlar emanetsizdir, hisse satılana kadar satıcının cüzdanında kalır ve gelir üretmeye devam eder. Komisyon %1 (satıcıdan).",
            "Shares are not locked for years: investors sell to each other directly. Listings are non-custodial, so shares stay in the seller's wallet and keep earning until sold. Fee 1% (paid by seller).")}
        </p>
      </div>

      {/* Per-asset tickers */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        {(summary ?? []).map((s) => {
          const active = filter === s.asset_id;
          const change = s.last_price ? s.last_price / 10 - 1 : null;
          return (
            <button key={s.asset_id} onClick={() => setFilter(active ? null : s.asset_id)}
              className={clsx("card p-3 text-left transition", active ? "ring-1 ring-chain" : "hover:border-faint")}>
              <div className="flex items-center gap-1.5 text-xs text-muted"><KindIcon kind={s.kind} className="size-3.5" />{s.name.split(" ")[0]}</div>
              <div className="num mt-1.5 text-lg font-semibold">{s.last_price ? money(s.last_price) : "–"}</div>
              <div className="flex justify-between text-[11px]">
                <span className={clsx("num", change == null ? "text-faint" : change >= 0 ? "text-money" : "text-alert")}>
                  {change == null ? "NAV $10" : `${change >= 0 ? "+" : ""}${num(change * 100, 1)}% NAV`}
                </span>
                <span className="text-faint">{s.listings} {tx("ilan", "asks")}</span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Card>
          <SectionTitle title={tx("Satış ilanları", "Order book (asks)")}
            hint={filter ? assetName(filter) : tx("Tüm varlıklar · fiyata göre", "All assets · by price")}
            right={filter && <button onClick={() => setFilter(null)} className="text-xs text-chain">{tx("Filtreyi kaldır", "Clear filter")}</button>} />
          {!shown ? <Skeleton className="h-80" /> : (
            <div className="scroll-thin overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-faint">
                  <tr>
                    <th className="pb-2 font-medium">{tx("Varlık", "Asset")}</th>
                    <th className="pb-2 text-right font-medium">{tx("Fiyat", "Price")}</th>
                    <th className="pb-2 text-right font-medium">NAV</th>
                    <th className="pb-2 text-right font-medium">{tx("Adet", "Shares")}</th>
                    <th className="pb-2 pl-6 font-medium">{tx("Satıcı", "Seller")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  <AnimatePresence initial={false}>
                    {shown.map((l) => (
                      <motion.tr key={l.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                        <td className="py-2.5"><span className="flex items-center gap-2"><KindIcon kind={l.kind} className="size-4" />{l.asset_name}</span></td>
                        <td className="num py-2.5 text-right font-semibold">{money(l.price_usdc)}</td>
                        <td className={clsx("num py-2.5 text-right text-xs", l.premium > 0 ? "text-warn" : "text-money")}>
                          {l.premium > 0 ? "+" : ""}{num(l.premium * 100, 1)}%
                        </td>
                        <td className="num py-2.5 text-right">{num(l.available)}</td>
                        <td className="py-2.5 pl-6 text-muted">{l.seller_name}{user && l.seller_id === user.id && <Badge tone="chain" className="ml-1.5">{tx("Siz", "You")}</Badge>}</td>
                        <td className="py-2.5 text-right">
                          {user && l.seller_id === user.id ? (
                            <button onClick={() => api("/market/cancel", { method: "POST", json: { listing_id: l.id } }).then(reloadListings)}
                              className="text-xs text-muted hover:text-alert">{tx("İptal", "Cancel")}</button>
                          ) : (
                            <button onClick={() => setBuying(l)} className="rounded-lg bg-wind/10 px-3 py-1 text-xs font-medium text-wind ring-1 ring-wind/30 hover:bg-wind/20">
                              {tx("Satın al", "Buy")}
                            </button>
                          )}
                        </td>
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-6">
          <SellBox onListed={reloadListings} />
          <Card>
            <SectionTitle title={tx("Son işlemler", "Trade tape")} right={<span className="live-dot size-2 rounded-full bg-wind" />} />
            <div className="space-y-1">
              <AnimatePresence initial={false}>
                {(trades ?? []).map((tr) => (
                  <motion.div key={tr.id} layout initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }}
                    className="flex items-center gap-2 rounded-lg px-1 py-1.5 text-xs">
                    <Repeat2 className="size-3.5 text-chain" />
                    <span className="flex-1 truncate text-muted">{assetName(tr.asset_id).split(" ")[0]} · {num(tr.shares)} × {money(tr.price_usdc)}</span>
                    <span className="text-faint">{tr.buyer}</span>
                    <TxLink hash={tr.tx_hash} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </Card>
        </div>
      </div>

      <BuyDialog listing={buying} onClose={() => setBuying(null)} onDone={reloadListings} />
    </div>
  );
}

function SellBox({ onListed }: { onListed: () => void }) {
  const { tx, money } = usePrefs();
  const { user } = useAuth();
  const { data: pf } = useData<Portfolio>(user?.role === "investor" ? "/portfolio" : null, { refreshOn: ["trade"] });
  const [assetId, setAssetId] = useState<string>("");
  const [shares, setShares] = useState(10);
  const [price, setPrice] = useState(10.2);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!user || user.role !== "investor") {
    return (
      <Card>
        <SectionTitle title={tx("Hisse sat", "Sell shares")} />
        <Link href="/login"><Button variant="outline" className="w-full">{tx("Satış için yatırımcı olarak giriş yapın", "Sign in as an investor to sell")}</Button></Link>
      </Card>
    );
  }
  const holdings = pf?.holdings ?? [];
  const selected = holdings.find((h) => h.asset_id === (assetId || holdings[0]?.asset_id));

  const submit = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ tx_hash: string }>("/market/list", { method: "POST", json: { asset_id: selected.asset_id, shares, price_usdc: price } });
      setDone(r.tx_hash);
      onListed();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <SectionTitle title={tx("Hisse sat", "Sell shares")} hint={tx("İlan oluştur, alıcı gelene kadar gelir kazanmaya devam et.", "List shares and keep earning until a buyer fills.")} />
      <div className="space-y-3 text-sm">
        <select value={selected?.asset_id ?? ""} onChange={(e) => setAssetId(e.target.value)}
          className="w-full rounded-lg border border-line bg-bg px-3 py-2 outline-none focus:border-wind">
          {holdings.map((h) => <option key={h.asset_id} value={h.asset_id}>{h.name} ({h.shares})</option>)}
        </select>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-faint">{tx("Adet", "Shares")}
            <input type="number" min={1} max={selected?.shares} value={shares} onChange={(e) => setShares(Number(e.target.value))}
              className="num mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-text outline-none focus:border-wind" />
          </label>
          <label className="text-xs text-faint">{tx("Fiyat (USDC)", "Price (USDC)")}
            <input type="number" step={0.05} min={1} value={price} onChange={(e) => setPrice(Number(e.target.value))}
              className="num mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-text outline-none focus:border-wind" />
          </label>
        </div>
        <div className="flex justify-between text-xs text-muted">
          <span>{tx("Net gelir (komisyon sonrası)", "Net proceeds (after fee)")}</span>
          <span className="num text-text">{money(shares * price * 0.99)}</span>
        </div>
        {error && <p className="text-xs text-alert">{error}</p>}
        {done && <div className="flex items-center justify-between rounded-lg bg-wind/10 px-3 py-2 text-xs text-wind"><span className="inline-flex items-center gap-1.5"><CheckCircle2 className="size-4" />{tx("İlan yayında", "Listing live")}</span><TxLink hash={done} /></div>}
        <Button className="w-full" disabled={busy || !selected} onClick={submit}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Tag className="size-4" />}{tx("İlan ver", "Create listing")}
        </Button>
      </div>
    </Card>
  );
}

function BuyDialog({ listing, onClose, onDone }: { listing: Listing | null; onClose: () => void; onDone: () => void }) {
  const { tx, money, num } = usePrefs();
  const { user } = useAuth();
  const [shares, setShares] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tx_hash: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const qty = shares || listing?.available || 0;

  const close = () => { setShares(0); setResult(null); setError(null); onClose(); };
  const buy = async () => {
    if (!listing) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await api<{ tx_hash: string }>("/market/buy", { method: "POST", json: { listing_id: listing.id, shares: qty } }));
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {listing && (
        <motion.div className="fixed inset-0 z-50 grid place-items-center bg-bg/70 p-4 backdrop-blur-sm" onClick={close}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="card w-full max-w-md p-6" onClick={(e) => e.stopPropagation()} initial={{ scale: 0.96 }} animate={{ scale: 1 }}>
            <h3 className="text-lg font-semibold">{listing.asset_name}</h3>
            <p className="text-sm text-muted">{tx("Satıcı", "Seller")}: {listing.seller_name} · {money(listing.price_usdc)} / {tx("hisse", "share")}</p>
            <label className="mt-5 block text-xs text-faint">{tx("Adet", "Shares")} (max {num(listing.available)})</label>
            <input type="number" min={1} max={listing.available} value={qty}
              onChange={(e) => setShares(Math.min(listing.available, Math.max(1, Number(e.target.value))))}
              className="num mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2 text-lg font-semibold outline-none focus:border-wind" />
            <div className="mt-4 flex justify-between text-sm"><span className="text-muted">{tx("Toplam", "Total")}</span><span className="num font-semibold">{money(qty * listing.price_usdc)}</span></div>
            {error && <p className="mt-3 text-xs text-alert">{error}</p>}
            {result ? (
              <div className="mt-4 flex items-center justify-between rounded-lg bg-wind/10 px-3 py-2 text-sm text-wind">
                <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="size-4" />{tx("Alım tamamlandı", "Purchase complete")}</span><TxLink hash={result.tx_hash} />
              </div>
            ) : !user ? (
              <Link href="/login"><Button className="mt-5 w-full">{tx("Giriş yap", "Sign in")}</Button></Link>
            ) : (
              <Button className="mt-5 w-full" disabled={busy || user.role !== "investor"} onClick={buy}>
                {busy && <Loader2 className="size-4 animate-spin" />}{tx("Satın al", "Buy")} · {money(qty * listing.price_usdc)}
              </Button>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
