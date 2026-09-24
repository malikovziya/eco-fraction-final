"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area, AreaChart, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api } from "@/lib/api";
import { useLiveEvent } from "@/lib/live";
import { usePrefs } from "@/lib/prefs";
import type { Kind, LiveReading } from "@/lib/types";

const AXIS = { stroke: "#5b6782", fontSize: 11, tickLine: false, axisLine: false } as const;
const TOOLTIP = {
  contentStyle: { background: "#0d1424", border: "1px solid #1f2a44", borderRadius: 12, fontSize: 12 },
  labelStyle: { color: "#8b98b2" },
} as const;

type Point = { ts: string; label: string; power: number; fraud: number };

/** Rolling chart of signed readings; points turn red when the AI suspects manipulation. */
export function LiveProductionChart({ assetId, kind, capacityKw }: { assetId: string; kind: Kind; capacityKw: number }) {
  const { num } = usePrefs();
  const [points, setPoints] = useState<Point[]>([]);
  const color = kind === "solar" ? "#f5a524" : "#10b981";
  const mw = capacityKw >= 10_000;

  useEffect(() => {
    api<{ ts: string; power_kw: number; fraud_prob: number }[]>(`/assets/${assetId}/readings?limit=120`)
      .then((rows) => setPoints(rows.map((r) => ({ ts: r.ts, label: r.ts.slice(11, 16), power: r.power_kw, fraud: r.fraud_prob }))))
      .catch(() => {});
  }, [assetId]);

  useLiveEvent(["reading"], (e) => {
    const r = e.data as unknown as LiveReading;
    if (r.asset_id !== assetId) return;
    setPoints((prev) => [...prev, { ts: r.ts, label: r.ts.slice(11, 16), power: r.power_kw, fraud: r.fraud_prob }].slice(-120));
  });

  const data = points.map((p) => ({ ...p, value: mw ? p.power / 1000 : p.power }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 10, right: 8, left: -8, bottom: 0 }}>
        <defs>
          <linearGradient id={`fill-${assetId}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.45} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#1f2a44" strokeDasharray="3 6" vertical={false} />
        <XAxis dataKey="label" {...AXIS} minTickGap={40} />
        <YAxis {...AXIS} width={48} tickFormatter={(v) => num(v, mw ? 0 : 0)} unit={mw ? " MW" : " kW"} />
        <ReferenceLine y={mw ? capacityKw / 1000 : capacityKw} stroke="#5b6782" strokeDasharray="4 4" />
        <Tooltip {...TOOLTIP} formatter={(v) => [`${num(Number(v), mw ? 2 : 0)} ${mw ? "MW" : "kW"}`, ""]} />
        <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill={`url(#fill-${assetId})`}
          isAnimationActive={false}
          dot={(props) => {
            const { cx, cy, payload, index } = props as { cx: number; cy: number; payload: Point; index: number };
            if (payload.fraud < 0.5) return <g key={index} />;
            return <circle key={index} cx={cx} cy={cy} r={4} fill="#f43f5e" stroke="#0b1220" strokeWidth={1.5} />;
          }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

type ForecastData = {
  history: { hour: string; ratio: number; energy_kwh: number }[];
  forecast: { hour: string; ratio: number; energy_kwh: number }[];
};

export function ForecastChart({ data, kind, capacityKw }: { data: ForecastData; kind: Kind; capacityKw: number }) {
  const { t, num } = usePrefs();
  const color = kind === "solar" ? "#f5a524" : "#10b981";
  const toMw = (kwh: number) => kwh / 1000; // energy in one hour == average power
  const rows = useMemo(() => {
    const hist = data.history.map((h) => ({ label: h.hour.slice(5, 13).replace("T", " "), actual: toMw(h.energy_kwh), forecast: null as number | null }));
    if (hist.length && data.forecast.length) hist[hist.length - 1].forecast = hist[hist.length - 1].actual;
    const fut = data.forecast.map((f) => ({ label: f.hour.slice(5, 13).replace("T", " "), actual: null as number | null, forecast: toMw(f.energy_kwh) }));
    return [...hist, ...fut];
  }, [data]);
  const now = data.history.at(-1)?.hour.slice(5, 13).replace("T", " ");

  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={rows} margin={{ top: 10, right: 8, left: -8, bottom: 0 }}>
        <defs>
          <linearGradient id="fc-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#1f2a44" strokeDasharray="3 6" vertical={false} />
        <XAxis dataKey="label" {...AXIS} minTickGap={50} tickFormatter={(v: string) => v.slice(6) + ":00"} />
        <YAxis {...AXIS} width={48} unit=" MW" domain={[0, capacityKw / 1000]} tickFormatter={(v) => num(v)} />
        {now && <ReferenceLine x={now} stroke="#8b98b2" strokeDasharray="3 3" label={{ value: t("common.now"), fill: "#8b98b2", fontSize: 11, position: "insideTopRight" }} />}
        <Tooltip {...TOOLTIP} formatter={(v, name) => [v == null ? "–" : `${num(Number(v), 1)} MW`, name === "actual" ? t("asset.actual") : t("asset.predicted")]} />
        <Area type="monotone" dataKey="actual" stroke={color} strokeWidth={2} fill="url(#fc-fill)" connectNulls={false} isAnimationActive={false} />
        <Line type="monotone" dataKey="forecast" stroke="#a78bfa" strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls={false} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
