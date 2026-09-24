"use client";

// Stylized, offline map of Azerbaijan (simplified border; illustrative, not survey-grade).
import clsx from "clsx";
import Link from "next/link";
import { useLive } from "@/lib/live";
import { usePrefs } from "@/lib/prefs";
import type { Asset } from "@/lib/types";

const MAINLAND: [number, number][] = [
  [45.0, 41.3], [45.3, 41.47], [45.72, 41.33], [46.2, 41.2], [46.45, 41.45], [46.3, 41.75], [46.55, 41.95],
  [46.95, 41.86], [47.3, 41.62], [47.75, 41.24], [48.05, 41.47], [48.4, 41.66], [48.6, 41.86],
  [49.05, 41.37], [49.45, 40.95], [49.7, 40.6], [50.0, 40.58], [50.37, 40.43], [49.97, 40.33],
  [49.55, 40.24], [49.4, 39.95], [49.3, 39.6], [49.1, 39.25], [49.3, 39.05], [48.95, 38.9],
  [48.88, 38.43], [48.6, 38.4], [48.3, 38.6], [48.02, 38.88], [48.25, 39.12], [48.35, 39.37],
  [47.98, 39.6], [47.45, 39.47], [47.0, 39.2], [46.55, 38.87], [46.38, 39.2], [46.62, 39.55],
  [46.2, 39.85], [45.9, 40.05], [45.6, 40.25], [45.95, 40.6], [45.55, 40.8], [45.15, 40.98], [45.0, 41.3],
];
const NAKHCHIVAN: [number, number][] = [
  [44.78, 39.7], [45.1, 39.78], [45.45, 39.52], [45.82, 39.45], [46.12, 39.16], [45.98, 38.88],
  [45.5, 38.98], [45.1, 39.27], [44.78, 39.7],
];

const W = 640, H = 470;
const LON0 = 44.55, LAT0 = 42.1, SCALE = 122;
// Label placement per asset (dx, dy, anchor): four assets cluster around Absheron
const LABELS: Record<string, [number, number, "start" | "middle" | "end"]> = {
  "khizi-wind": [0, -1, "middle"],
  "gobustan-solar": [-1, 0, "end"],
  "sumgait-rooftop": [0, -1, "middle"],
  "absheron-wind": [1, 0, "start"],
  "bilasuvar-solar": [0, 1, "middle"],
  "nakhchivan-solar": [0, -1, "middle"],
};
const cosLat = Math.cos((40.3 * Math.PI) / 180);
export const project = (lon: number, lat: number) => [(lon - LON0) * SCALE * cosLat, (LAT0 - lat) * SCALE];
const path = (pts: [number, number][]) =>
  pts.map(([lon, lat], i) => `${i ? "L" : "M"}${project(lon, lat).map((v) => v.toFixed(1)).join(",")}`).join(" ") + "Z";

export function AzMap({ assets }: { assets: Asset[] }) {
  const { latest } = useLive();
  const { t, num } = usePrefs();
  const maxCap = Math.max(...assets.map((a) => a.capacity_kw), 1);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Azerbaijan asset map">
      <defs>
        <linearGradient id="land" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#15213a" />
          <stop offset="100%" stopColor="#0f192d" />
        </linearGradient>
        <radialGradient id="glow-solar"><stop offset="0%" stopColor="#f5a524" stopOpacity="0.7" /><stop offset="100%" stopColor="#f5a524" stopOpacity="0" /></radialGradient>
        <radialGradient id="glow-wind"><stop offset="0%" stopColor="#10b981" stopOpacity="0.7" /><stop offset="100%" stopColor="#10b981" stopOpacity="0" /></radialGradient>
        <pattern id="sea" width="10" height="10" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.8" fill="#38bdf8" opacity="0.18" />
        </pattern>
      </defs>

      {/* Caspian Sea */}
      <rect x={project(49.2, 42)[0]} y="0" width={W} height={H} fill="url(#sea)" />
      <text x={project(50.1, 39.6)[0]} y={project(50.1, 39.6)[1]} className="fill-chain/50 text-[11px] tracking-[0.2em]"
        style={{ writingMode: "vertical-rl" }}>{t("map.caspian").toUpperCase()}</text>

      <path d={path(MAINLAND)} fill="url(#land)" stroke="#2a3a5c" strokeWidth="1.5" />
      <path d={path(NAKHCHIVAN)} fill="url(#land)" stroke="#2a3a5c" strokeWidth="1.5" />

      {/* Baku reference */}
      <g transform={`translate(${project(49.87, 40.41).join(",")})`}>
        <circle r="2.5" fill="#8b98b2" />
        <text x="-6" y="4" textAnchor="end" className="fill-muted text-[11px]">Bakı</text>
      </g>

      {assets.map((a) => {
        const [x, y] = project(a.lon, a.lat);
        const r = 5 + 9 * Math.sqrt(a.capacity_kw / maxCap);
        const [lx, ly, anchor] = LABELS[a.id] ?? [0, -1, "middle"];
        const tx = lx * (r + 8), ty = ly === -1 ? -r - 20 : ly === 1 ? r + 16 : -4;
        const live = latest[a.id] ?? a.live;
        const output = live ? live.power_kw / a.capacity_kw : 0;
        const alert = a.activeAlerts.length > 0 || (live?.fraud_prob ?? 0) > 0.5;
        const color = alert ? "#f43f5e" : a.kind === "solar" ? "#f5a524" : "#10b981";
        return (
          <Link key={a.id} href={`/assets/${a.id}`}>
            <g transform={`translate(${x},${y})`} className="cursor-pointer">
              <circle r={r * (1.4 + output * 1.2)} fill={`url(#glow-${a.kind})`} opacity={0.25 + output * 0.75}
                style={{ transition: "all 0.8s ease" }} />
              <circle r={r} fill="#0b1220" stroke={color} strokeWidth="2.5" className={clsx(alert && "live-dot")} />
              <circle r={r * Math.max(0.12, output)} fill={color} style={{ transition: "r 0.8s ease" }} />
              <text x={tx} y={ty} textAnchor={anchor} className="fill-text text-[11px] font-medium">{a.name.split(" ")[0]}</text>
              <text x={tx} y={ty + 13} textAnchor={anchor} className="num fill-muted text-[10px]">
                {live ? (live.power_kw >= 1000 ? `${num(live.power_kw / 1000, 1)} MW` : `${num(live.power_kw)} kW`) : "–"}
              </text>
            </g>
          </Link>
        );
      })}
    </svg>
  );
}
