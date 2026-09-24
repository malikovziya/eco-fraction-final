"use client";

// Presenter-only scenario controls, hidden until Ctrl+Shift+D.
import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { FlaskConical, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLive } from "@/lib/live";
import { usePrefs } from "@/lib/prefs";
import type { User } from "@/lib/types";

const ASSETS = [
  ["gobustan-solar", "Gobustan Solar"],
  ["bilasuvar-solar", "Bilasuvar Solar"],
  ["nakhchivan-solar", "Sharur Solar"],
  ["sumgait-rooftop", "Sumgait Rooftop"],
  ["khizi-wind", "Khizi Wind"],
  ["absheron-wind", "Absheron Wind"],
] as const;
const FAULTS = ["inflate", "flatline", "degrade", "forge"] as const;
const SPEEDS = [
  [1, "1×"],
  [300, "300×"],
  [1200, "1200×"],
] as const;

export function DemoPanel() {
  const { t } = usePrefs();
  const { sim } = useLive();
  const { user, loginPersona } = useAuth();
  const [open, setOpen] = useState(false);
  const [asset, setAsset] = useState<string>("khizi-wind");
  const [personas, setPersonas] = useState<User[]>([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open && personas.length === 0) api<User[]>("/auth/personas").then(setPersonas).catch(() => {});
  }, [open, personas.length]);

  const active = new Set(sim?.faults?.[asset] ?? []);
  const toggle = (fault: string) =>
    api("/sim/fault", { method: "POST", json: { asset_id: asset, fault, on: !active.has(fault) } });

  return (
    <AnimatePresence>
      {open && (
        <motion.aside initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
          className="card fixed bottom-4 right-4 z-50 w-80 p-4 shadow-2xl">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 font-semibold"><FlaskConical className="size-4 text-ai" />{t("demo.title")}</div>
            <button onClick={() => setOpen(false)} className="text-faint hover:text-text"><X className="size-4" /></button>
          </div>

          <label className="text-xs text-faint">{t("demo.asset")}</label>
          <div className="mt-1 grid grid-cols-2 gap-1">
            {ASSETS.map(([id, name]) => (
              <button key={id} onClick={() => setAsset(id)}
                className={clsx("rounded-lg px-2 py-1.5 text-left text-xs transition",
                  asset === id ? "bg-surface-2 text-text ring-1 ring-line" : "text-muted hover:bg-surface-2",
                  (sim?.faults?.[id]?.length ?? 0) > 0 && "text-alert")}>
                {name}
              </button>
            ))}
          </div>

          <div className="mt-3 text-xs text-faint">{t("demo.faults")}</div>
          <div className="mt-1 grid grid-cols-2 gap-1.5">
            {FAULTS.map((f) => (
              <button key={f} onClick={() => toggle(f)}
                className={clsx("rounded-lg px-2 py-2 text-xs font-medium ring-1 transition",
                  active.has(f) ? "bg-alert/20 text-alert ring-alert/50" : "text-muted ring-line hover:text-text")}>
                {t(`demo.fault.${f}`)}{active.has(f) && ` · ${t("demo.active")}`}
              </button>
            ))}
          </div>

          <div className="mt-3 text-xs text-faint">{t("demo.speed")}</div>
          <div className="mt-1 flex gap-1.5">
            {SPEEDS.map(([v, label]) => (
              <button key={v} onClick={() => api("/sim/speed", { method: "POST", json: { value: v } })}
                className={clsx("flex-1 rounded-lg py-1.5 text-xs ring-1",
                  sim?.speed === v ? "bg-surface-2 text-text ring-faint" : "text-muted ring-line")}>
                {label}
              </button>
            ))}
          </div>

          <button onClick={() => api("/sim/clear", { method: "POST" })}
            className="mt-3 w-full rounded-lg bg-surface-2 py-2 text-xs text-muted hover:text-text">
            {t("demo.clear")}
          </button>

          <div className="mt-3 text-xs text-faint">{t("demo.persona")}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {personas.map((p) => (
              <button key={p.persona} onClick={() => loginPersona(p.persona!)}
                className={clsx("rounded-md px-2 py-1 text-xs ring-1",
                  user?.persona === p.persona ? "text-wind ring-wind/40" : "text-muted ring-line hover:text-text")}>
                {p.name.split(" ")[0]}
              </button>
            ))}
          </div>
          <div className="mt-3 text-[10px] text-faint">{t("demo.hint")}</div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
