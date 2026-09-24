"use client";

import clsx from "clsx";
import { motion } from "motion/react";
import { AlertTriangle, MapPin, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge, Card, EsgBadge, KindIcon, KindLabel, Progress, Skeleton, formatPower } from "@/components/ui";
import { useData, useLive } from "@/lib/live";
import { usePrefs } from "@/lib/prefs";
import type { Asset, Kind } from "@/lib/types";

export default function AssetsPage() {
  const { t } = usePrefs();
  const [filter, setFilter] = useState<"all" | Kind>("all");
  const { data: assets } = useData<Asset[]>("/assets", { refreshOn: ["investment", "batch_settled", "alert"] });
  const shown = assets?.filter((a) => filter === "all" || a.kind === filter);

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{t("assets.title")}</h1>
          <p className="mt-2 text-muted">{t("assets.subtitle")}</p>
        </div>
        <div className="flex rounded-xl border border-line p-1 text-sm">
          {(["all", "solar", "wind"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={clsx("rounded-lg px-3 py-1.5", filter === f ? "bg-surface-2 text-text" : "text-muted")}>
              {f === "all" ? t("common.all") : t(`common.${f}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {!shown && [0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-72" />)}
        {shown?.map((a, i) => (
          <motion.div key={a.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <AssetCard asset={a} />
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function AssetCard({ asset: a }: { asset: Asset }) {
  const { t, money, num } = usePrefs();
  const { latest } = useLive();
  const live = latest[a.id] ?? a.live;
  const output = live ? live.power_kw / a.capacity_kw : 0;
  const funded = a.soldShares / a.offeredShares;
  const alert = a.activeAlerts[0];

  return (
    <Link href={`/assets/${a.id}`}>
      <Card className={clsx("group h-full transition hover:-translate-y-0.5 hover:border-faint",
        alert === "fraud" || alert === "security" ? "glow-alert" : "")}>
        <div className="flex items-start justify-between">
          <div className={clsx("grid size-11 place-items-center rounded-xl", a.kind === "solar" ? "bg-solar/10" : "bg-wind/10")}>
            <KindIcon kind={a.kind} className="size-5" />
          </div>
          <EsgBadge rating={a.esg.rating} score={a.esg.score} />
        </div>
        <h3 className="mt-4 text-lg font-semibold tracking-tight group-hover:text-wind">{a.name}</h3>
        <div className="mt-1 flex items-center gap-3 text-sm text-muted">
          <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{a.region}</span>
          <KindLabel kind={a.kind} />
          <span>{num(a.capacity_kw / 1000)} MW</span>
        </div>

        {alert && (
          <Badge tone={alert === "maintenance" ? "warn" : "alert"} className="mt-3">
            <AlertTriangle className="size-3" />{t(`assets.alert.${alert as "fraud" | "maintenance" | "security"}`)}
          </Badge>
        )}

        <div className="mt-5 grid grid-cols-3 gap-2 text-sm">
          <div>
            <div className="text-xs text-faint">{t("common.expectedYield")}</div>
            <div className="num mt-0.5 font-semibold text-money">{num(a.expectedYield * 100, 1)}%</div>
          </div>
          <div>
            <div className="text-xs text-faint">{t("common.pricePerShare")}</div>
            <div className="num mt-0.5 font-semibold">{money(a.pricePerShare)}</div>
          </div>
          <div>
            <div className="text-xs text-faint">{t("assets.liveOutput")}</div>
            <div className={clsx("num mt-0.5 font-semibold", a.kind === "solar" ? "text-solar" : "text-wind")}>
              {live ? formatPower(live.power_kw, num) : "–"}
            </div>
          </div>
        </div>

        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-surface-2">
          <div className={clsx("h-full transition-all duration-700", a.kind === "solar" ? "bg-solar" : "bg-wind")}
            style={{ width: `${Math.min(100, output * 100)}%` }} />
        </div>

        <div className="mt-5">
          <div className="mb-1.5 flex justify-between text-xs">
            <span className="text-muted"><span className="num font-medium text-text">{num(funded * 100, 1)}%</span> {t("common.funded")}</span>
            <span className="inline-flex items-center gap-1 text-muted"><Users className="size-3" />{num(a.investors)} {t("common.investors")}</span>
          </div>
          <Progress value={funded} tone={a.kind === "solar" ? "solar" : "wind"} />
          <div className="mt-1.5 text-xs text-faint">
            {money(a.soldShares * a.pricePerShare, { compact: true })} / {money(a.offeredShares * a.pricePerShare, { compact: true })}
          </div>
        </div>
      </Card>
    </Link>
  );
}
