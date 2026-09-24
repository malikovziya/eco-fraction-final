"use client";

import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { Coins, ShieldAlert, ShieldX, UserPlus, Wrench } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useLiveEvent } from "@/lib/live";
import { ASSET_NAMES } from "@/lib/assets";
import { usePrefs } from "@/lib/prefs";

type Toast = { id: number; tone: "money" | "alert" | "warn" | "neutral"; icon: React.ReactNode; title: string; sub?: string };

export function Toasts() {
  const { t, money } = usePrefs();
  const { user } = useAuth();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const payoutBuffer = useRef<{ amount: number; assets: Set<string>; timer?: ReturnType<typeof setTimeout> }>({
    amount: 0, assets: new Set(),
  });

  const push = useCallback((toast: Omit<Toast, "id">) => {
    const id = nextId.current++;
    setToasts((prev) => [...prev.slice(-3), { ...toast, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 5000);
  }, []);

  useLiveEvent(["payout", "alert", "investment"], (e) => {
    const d = e.data as Record<string, string | number>;
    if (e.event === "payout" && user && d.user_id === user.id) {
      // Six assets pay out within a second of each other: show one combined toast
      const buf = payoutBuffer.current;
      buf.amount += Number(d.amount_usdc);
      buf.assets.add(ASSET_NAMES[String(d.asset_id)] ?? String(d.asset_id));
      clearTimeout(buf.timer);
      buf.timer = setTimeout(() => {
        const names = [...buf.assets];
        push({ tone: "money", icon: <Coins className="size-4" />,
          title: t("toast.payout", { amount: money(buf.amount, { decimals: buf.amount < 1 ? 4 : 2 }),
            asset: names.length > 1 ? t("toast.nAssets", { n: names.length }) : names[0] }) });
        buf.amount = 0;
        buf.assets = new Set();
      }, 700);
    } else if (e.event === "alert") {
      const name = ASSET_NAMES[String(d.asset_id)] ?? String(d.asset_id);
      if (d.kind === "fraud") push({ tone: "alert", icon: <ShieldAlert className="size-4" />, title: t("toast.fraud"), sub: name });
      if (d.kind === "security") push({ tone: "alert", icon: <ShieldX className="size-4" />, title: t("toast.security"), sub: name });
      if (d.kind === "maintenance") push({ tone: "warn", icon: <Wrench className="size-4" />, title: t("toast.maintenance"), sub: name });
    } else if (e.event === "investment") {
      push({ tone: "neutral", icon: <UserPlus className="size-4" />,
        title: t("toast.investment", { name: String(d.name), shares: Number(d.shares), asset: String(d.asset_name) }),
        sub: money(Number(d.amount_usdc), { decimals: 0 }) });
    }
  });

  return (
    <div className="pointer-events-none fixed right-4 top-20 z-50 flex w-80 flex-col gap-2">
      <AnimatePresence>
        {toasts.map((x) => (
          <motion.div key={x.id} layout initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 30 }}
            className={clsx("card flex items-start gap-3 px-4 py-3 text-sm shadow-xl",
              x.tone === "money" && "glow-wind", x.tone === "alert" && "glow-alert")}>
            <span className={clsx("mt-0.5",
              x.tone === "money" && "text-money", x.tone === "alert" && "text-alert",
              x.tone === "warn" && "text-warn", x.tone === "neutral" && "text-chain")}>{x.icon}</span>
            <div>
              <div className="font-medium">{x.title}</div>
              {x.sub && <div className="text-xs text-muted">{x.sub}</div>}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
