"use client";

import clsx from "clsx";
import { LogOut, Zap } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useLive } from "@/lib/live";
import { usePrefs, type Currency } from "@/lib/prefs";

const LINKS = [
  { href: "/assets", key: "nav.assets" },
  { href: "/portfolio", key: "nav.portfolio" },
  { href: "/architecture", key: "nav.architecture" },
  { href: "/ai", key: "nav.ai" },
  { href: "/explorer", key: "nav.explorer" },
] as const;

export function Nav() {
  const path = usePathname();
  const { t, lang, setLang, currency, setCurrency } = usePrefs();
  const { user, logout } = useAuth();
  const { connected, sim } = useLive();
  const simTime = sim?.sim_time ? sim.sim_time.slice(11, 16) : "--:--";
  const simDay = sim?.sim_time ? sim.sim_time.slice(5, 10).split("-").reverse().join(".") : "";

  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-bg/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-wind to-chain text-bg">
            <Zap className="size-4" strokeWidth={2.5} />
          </span>
          <span className="hidden whitespace-nowrap sm:inline">Eco-Fraction</span>
        </Link>

        <nav className="hidden items-center gap-0.5 md:flex">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href}
              className={clsx("whitespace-nowrap rounded-lg px-3 py-2 text-sm transition",
                path.startsWith(l.href) ? "bg-surface-2 text-text" : "text-muted hover:text-text")}>
              {t(l.key)}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <div className="hidden items-center gap-2 whitespace-nowrap rounded-lg border border-line px-2.5 py-1.5 text-xs xl:flex"
            title={connected ? t("nav.connected") : t("nav.disconnected")}>
            <span className={clsx("size-2 rounded-full", connected ? "live-dot bg-wind" : "bg-alert")} />
            <span className="hidden text-faint 2xl:inline">{t("nav.simTime")}</span>
            <span className="num font-mono text-text">{simDay} {simTime}</span>
            {sim && <span className="text-faint">×{sim.speed}</span>}
          </div>

          <Segmented value={currency} options={["USD", "AZN", "TRY"]} onChange={(v) => setCurrency(v as Currency)} />
          <Segmented value={lang} options={["tr", "en"]} onChange={(v) => setLang(v as "tr" | "en")} upper />

          {user ? (
            <div className="flex items-center gap-2">
              <Link href="/portfolio" className="hidden text-right leading-tight lg:block">
                <div className="whitespace-nowrap text-sm font-medium">{user.name}</div>
                <div className="text-xs text-faint">{t(`role.${user.role}`)}</div>
              </Link>
              <button onClick={logout} title={t("nav.signOut")}
                className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-text">
                <LogOut className="size-4" />
              </button>
            </div>
          ) : (
            <Link href="/login" className="rounded-xl bg-wind px-4 py-2 text-sm font-medium text-bg hover:bg-emerald-400">
              {t("nav.signIn")}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

function Segmented({ value, options, onChange, upper }: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  upper?: boolean;
}) {
  return (
    <div className="flex rounded-lg border border-line p-0.5 text-xs">
      {options.map((o) => (
        <button key={o} onClick={() => onChange(o)}
          className={clsx("rounded-md px-2 py-1 transition", upper && "uppercase",
            o === value ? "bg-surface-2 text-text" : "text-faint hover:text-muted")}>
          {o}
        </button>
      ))}
    </div>
  );
}
