"use client";

import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { Link2, ShieldAlert, ShieldX, UserPlus, Wrench } from "lucide-react";
import { useState } from "react";
import { useLiveEvent } from "@/lib/live";
import { ASSET_SHORT } from "@/lib/assets";
import { usePrefs } from "@/lib/prefs";
import { TxLink } from "./ui";

type Item = { id: string; tone: string; icon: React.ReactNode; text: string; tx?: string };

export function LiveFeed({ max = 10, className }: { max?: number; className?: string }) {
  const { t, money, lang } = usePrefs();
  const [items, setItems] = useState<Item[]>([]);
  const add = (item: Item) => setItems((prev) => [item, ...prev].slice(0, max));

  useLiveEvent(["batch_settled", "alert", "investment", "rejection"], (e) => {
    const d = e.data as Record<string, string | number | null>;
    const asset = ASSET_SHORT[String(d.asset_id)] ?? String(d.asset_id);
    const id = `${e.event}-${Date.now()}-${Math.random()}`;
    if (e.event === "batch_settled" && d.revenue_usdc != null && Number(d.revenue_usdc) > 0) {
      const escrow = d.status === "escrowed";
      add({ id, tone: escrow ? "text-alert" : "text-chain", icon: <Link2 className="size-3.5" />, tx: String(d.tx_settle),
        text: escrow
          ? (lang === "tr" ? `${asset}: ${money(Number(d.revenue_usdc))} emanete alındı` : `${asset}: ${money(Number(d.revenue_usdc))} held in escrow`)
          : (lang === "tr" ? `${asset}: ${money(Number(d.revenue_usdc))} hissedarlara dağıtıldı` : `${asset}: ${money(Number(d.revenue_usdc))} distributed to holders`) });
    } else if (e.event === "investment") {
      add({ id, tone: "text-money", icon: <UserPlus className="size-3.5" />, tx: String(d.tx_hash),
        text: t("toast.investment", { name: String(d.name), shares: Number(d.shares), asset }) });
    } else if (e.event === "rejection") {
      add({ id, tone: "text-alert", icon: <ShieldX className="size-3.5" />,
        text: lang === "tr" ? `${asset}: sahte cihaz mesajı reddedildi (${d.claimed_power_kw} kW iddiası)`
          : `${asset}: forged device message rejected (claimed ${d.claimed_power_kw} kW)` });
    } else if (e.event === "alert" && d.kind !== "security") {
      add({ id, tone: d.kind === "fraud" ? "text-alert" : "text-warn",
        icon: d.kind === "fraud" ? <ShieldAlert className="size-3.5" /> : <Wrench className="size-3.5" />,
        text: `${asset}: ${d.kind === "fraud" ? t("toast.fraud") : t("toast.maintenance")}` });
    }
  });

  return (
    <div className={clsx("scroll-thin space-y-1 overflow-y-auto", className)}>
      {items.length === 0 && <p className="py-6 text-center text-sm text-faint">{t("feed.empty")}</p>}
      <AnimatePresence initial={false}>
        {items.map((it) => (
          <motion.div key={it.id} layout initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
            <span className={it.tone}>{it.icon}</span>
            <span className="flex-1 truncate text-muted">{it.text}</span>
            {it.tx && <TxLink hash={it.tx} />}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
