"use client";

// Language + display currency preferences, remembered per browser. Read through
// useSyncExternalStore so server and first client render agree (hydration-safe), with an
// in-memory fallback when storage is unavailable.
import { createContext, useCallback, useContext, useEffect, useSyncExternalStore } from "react";
import { dict, type DictKey, type Lang } from "./dict";

export type Currency = "USD" | "AZN" | "TRY";
const FX: Record<Currency, number> = { USD: 1, AZN: 1.7, TRY: 41 };
const SYMBOL: Record<Currency, string> = { USD: "$", AZN: "₼", TRY: "₺" };

const memory: Record<string, string> = {};
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  let v: string | null = memory[key] ?? null;
  try {
    v = localStorage.getItem(key) ?? v;
  } catch {
    /* storage blocked: memory only */
  }
  return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

function write(key: string, value: string) {
  memory[key] = value;
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage blocked: memory only */
  }
  listeners.forEach((l) => l());
}

function useStored<T extends string>(key: string, allowed: readonly T[], fallback: T): [T, (v: T) => void] {
  const value = useSyncExternalStore(subscribe, () => read(key, allowed, fallback), () => fallback);
  const set = useCallback((v: T) => write(key, v), [key]);
  return [value, set];
}

const LANGS = ["tr", "en"] as const;
const CURRENCIES = ["USD", "AZN", "TRY"] as const;

type Prefs = {
  lang: Lang;
  setLang: (l: Lang) => void;
  currency: Currency;
  setCurrency: (c: Currency) => void;
  t: (key: DictKey, vars?: Record<string, string | number>) => string;
  money: (usd: number | null | undefined, opts?: { decimals?: number; compact?: boolean }) => string;
  num: (n: number | null | undefined, decimals?: number) => string;
};

const Ctx = createContext<Prefs | null>(null);

export function PrefsProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useStored<Lang>("eco.lang", LANGS, "tr");
  const [currency, setCurrency] = useStored<Currency>("eco.currency", CURRENCIES, "USD");

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const locale = lang === "tr" ? "tr-TR" : "en-US";

  const t = useCallback(
    (key: DictKey, vars?: Record<string, string | number>) => {
      let s: string = dict[lang][key] ?? dict.tr[key] ?? key;
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
      return s;
    },
    [lang],
  );

  const num = useCallback(
    (n: number | null | undefined, decimals = 0) =>
      n == null ? "–" : n.toLocaleString(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }),
    [locale],
  );

  const money = useCallback(
    (usd: number | null | undefined, opts?: { decimals?: number; compact?: boolean }) => {
      if (usd == null) return "–";
      const v = usd * FX[currency];
      if (opts?.compact && Math.abs(v) >= 10_000) {
        return SYMBOL[currency] + v.toLocaleString(locale, { notation: "compact", maximumFractionDigits: 1 });
      }
      const d = opts?.decimals ?? 2;
      return SYMBOL[currency] + v.toLocaleString(locale, { minimumFractionDigits: d, maximumFractionDigits: d });
    },
    [currency, locale],
  );

  return <Ctx.Provider value={{ lang, setLang, currency, setCurrency, t, money, num }}>{children}</Ctx.Provider>;
}

export function usePrefs(): Prefs {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePrefs outside PrefsProvider");
  return ctx;
}
