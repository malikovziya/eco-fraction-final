"use client";

import clsx from "clsx";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { ExternalLink, Sun, Wind } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { usePrefs } from "@/lib/prefs";
import type { Kind } from "@/lib/types";

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={clsx("card p-5", className)} {...rest}>
      {children}
    </div>
  );
}

export function SectionTitle({ title, hint, right }: { title: string; hint?: string; right?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {hint && <p className="mt-0.5 text-sm text-muted">{hint}</p>}
      </div>
      {right}
    </div>
  );
}

export function Button({
  variant = "primary",
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" | "outline" }) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-wind text-bg hover:bg-emerald-400",
        variant === "ghost" && "text-muted hover:bg-surface-2 hover:text-text",
        variant === "outline" && "border border-line text-text hover:border-faint hover:bg-surface-2",
        variant === "danger" && "bg-alert/15 text-alert ring-1 ring-alert/40 hover:bg-alert/25",
        className,
      )}
      {...rest}
    />
  );
}

export function Badge({ tone = "neutral", children, className }: {
  tone?: "neutral" | "wind" | "solar" | "ai" | "chain" | "alert" | "warn" | "money";
  children: React.ReactNode;
  className?: string;
}) {
  const tones = {
    neutral: "bg-surface-2 text-muted ring-line",
    wind: "bg-wind/10 text-wind ring-wind/30",
    solar: "bg-solar/10 text-solar ring-solar/30",
    ai: "bg-ai/10 text-ai ring-ai/30",
    chain: "bg-chain/10 text-chain ring-chain/30",
    alert: "bg-alert/10 text-alert ring-alert/40",
    warn: "bg-warn/10 text-warn ring-warn/30",
    money: "bg-money/10 text-money ring-money/30",
  };
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1", tones[tone], className)}>
      {children}
    </span>
  );
}

export function EsgBadge({ rating, score, size = "sm" }: { rating: string; score?: number; size?: "sm" | "lg" }) {
  const color = rating.startsWith("A") ? "text-wind ring-wind/40 bg-wind/10"
    : rating === "B" ? "text-chain ring-chain/40 bg-chain/10"
    : rating === "C" ? "text-warn ring-warn/40 bg-warn/10" : "text-alert ring-alert/40 bg-alert/10";
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded-lg font-semibold ring-1", color,
      size === "lg" ? "px-3 py-1.5 text-lg" : "px-2 py-0.5 text-xs")}>
      ESG {rating}
      {score != null && <span className="num font-normal opacity-80">{score.toFixed(0)}</span>}
    </span>
  );
}

export function KindIcon({ kind, className }: { kind: Kind; className?: string }) {
  return kind === "solar"
    ? <Sun className={clsx("text-solar", className)} />
    : <Wind className={clsx("text-wind", className)} />;
}

export function Progress({ value, tone = "wind" }: { value: number; tone?: "wind" | "solar" | "chain" }) {
  const bg = { wind: "bg-wind", solar: "bg-solar", chain: "bg-chain" }[tone];
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
      <motion.div className={clsx("h-full rounded-full", bg)} initial={{ width: 0 }}
        animate={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }} transition={{ duration: 0.8 }} />
    </div>
  );
}

/** Smoothly counts to the new value whenever it changes. */
export function AnimatedNumber({ value, format, duration = 0.9 }: {
  value: number;
  format: (n: number) => string;
  duration?: number;
}) {
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => format(v));
  useEffect(() => {
    const controls = animate(mv, value, { duration, ease: "easeOut" });
    return () => controls.stop();
  }, [value, mv, duration]);
  return <motion.span className="num">{text}</motion.span>;
}

export function Stat({ label, children, sub, accent }: {
  label: string;
  children: React.ReactNode;
  sub?: React.ReactNode;
  accent?: string;
}) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wider text-faint">{label}</div>
      <div className={clsx("mt-1 text-2xl font-semibold tracking-tight", accent)}>{children}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function shortHash(h: string | null | undefined, n = 6) {
  if (!h) return "–";
  return `${h.slice(0, n + 2)}…${h.slice(-4)}`;
}

export function TxLink({ hash, label }: { hash: string | null | undefined; label?: string }) {
  if (!hash) return <span className="text-faint">–</span>;
  return (
    <Link href={`/tx/${hash}`} className="inline-flex items-center gap-1 font-mono text-xs text-chain hover:underline">
      {label ?? shortHash(hash)}
      <ExternalLink className="size-3" />
    </Link>
  );
}

export function KindLabel({ kind }: { kind: Kind }) {
  const { t } = usePrefs();
  return <Badge tone={kind === "solar" ? "solar" : "wind"}><KindIcon kind={kind} className="size-3" />{t(kind === "solar" ? "common.solar" : "common.wind")}</Badge>;
}

export function formatPower(kw: number, num: (n: number, d?: number) => string) {
  return kw >= 1000 ? `${num(kw / 1000, 1)} MW` : `${num(kw, 0)} kW`;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("animate-pulse rounded-lg bg-surface-2", className)} />;
}
