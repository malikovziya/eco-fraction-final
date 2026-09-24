"use client";

import clsx from "clsx";
import { Brain, Database, GitBranch, LineChart, ShieldAlert, ShieldX, Wrench } from "lucide-react";
import Link from "next/link";
import { Badge, Card, Progress, SectionTitle, Skeleton } from "@/components/ui";
import { useData } from "@/lib/live";
import { usePrefs } from "@/lib/prefs";
import type { BatchT } from "@/lib/types";

type Cards = {
  anomaly: {
    classes: string[];
    features: string[];
    train_rows: number;
    test_rows: number;
    accuracy: number;
    metrics: Record<string, { precision: number; recall: number; "f1-score": number; support: number }>;
    confusion_matrix: number[][];
    feature_importance: Record<string, number>;
  };
  forecast: {
    kinds: Record<string, { mae_capacity_ratio: number; persistence_mae: number; improvement_vs_persistence: number; train_windows: number; test_windows: number }>;
  };
};

export default function AiLab() {
  const { t, num } = usePrefs();
  const { data } = useData<Cards>("/ai/models");
  const { data: flagged } = useData<BatchT[]>("/batches?flagged=true&limit=5", { refreshOn: ["batch_closed"] });
  if (!data) return <Skeleton className="h-96" />;
  const a = data.anomaly;
  const importance = Object.entries(a.feature_importance).slice(0, 8);
  const maxImp = Math.max(...importance.map(([, v]) => v));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">{t("ai.title")}</h1>
        <p className="mt-2 text-muted">{t("ai.subtitle")}</p>
      </div>

      {/* Anomaly model */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <div className="flex items-center gap-2 text-ai"><Brain className="size-5" /><h2 className="font-semibold text-text">{t("ai.anomaly")}</h2></div>
          <p className="mt-3 text-sm leading-relaxed text-muted">{t("ai.anomalyText")}</p>
          <div className="mt-5 rounded-xl bg-surface-2 p-4">
            <div className="text-xs uppercase tracking-wider text-faint">{t("ai.accuracy")}</div>
            <div className="num mt-1 text-4xl font-semibold text-ai">{num(a.accuracy * 100, 1)}%</div>
            <div className="mt-1 text-xs text-muted">{num(a.test_rows)} {t("ai.heldOut")}</div>
          </div>
          <p className="mt-4 flex gap-2 text-xs text-faint"><Database className="size-4 shrink-0" />{t("ai.dataNote")}</p>
        </Card>

        <Card className="lg:col-span-2">
          <SectionTitle title={`${t("ai.precision")} / ${t("ai.recall")}`} />
          <div className="grid gap-4 sm:grid-cols-2">
            {a.classes.map((c) => {
              const m = a.metrics[c];
              return (
                <div key={c} className="rounded-xl bg-surface-2 p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{t(`verdict.${c}` as never)}</span>
                    <span className="num text-xs text-faint">n={num(m.support)}</span>
                  </div>
                  <div className="mt-3 space-y-2 text-xs">
                    <Metric label={t("ai.precision")} value={m.precision} />
                    <Metric label={t("ai.recall")} value={m.recall} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionTitle title={t("ai.confusion")} hint={t("ai.confusionHint")} />
          <ConfusionMatrix classes={a.classes} matrix={a.confusion_matrix} />
        </Card>
        <Card>
          <SectionTitle title={t("ai.importance")} hint="XGBoost gain" />
          <div className="space-y-2.5">
            {importance.map(([f, v]) => (
              <div key={f}>
                <div className="flex justify-between text-xs"><span>{t(`feat.${f}` as never)}</span><span className="num text-faint">{num(v, 1)}</span></div>
                <div className="mt-1 h-2 rounded-full bg-surface-2">
                  <div className="h-full rounded-full bg-gradient-to-r from-ai to-chain" style={{ width: `${(v / maxImp) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Forecast model */}
      <Card>
        <div className="flex items-center gap-2 text-ai"><LineChart className="size-5" /><h2 className="font-semibold text-text">{t("ai.forecast")}</h2></div>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">{t("ai.forecastText")}</p>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {Object.entries(data.forecast.kinds).map(([kind, m]) => (
            <div key={kind} className="rounded-xl bg-surface-2 p-4">
              <div className="flex items-center justify-between">
                <span className="font-medium">{t(`common.${kind}` as never)}</span>
                <Badge tone="ai">{num(m.improvement_vs_persistence * 100)}% {t("ai.better")}</Badge>
              </div>
              <div className="mt-4 space-y-3 text-xs">
                <Bar label="LSTM" value={m.mae_capacity_ratio} max={m.persistence_mae} tone="bg-ai" />
                <Bar label={t("ai.baseline")} value={m.persistence_mae} max={m.persistence_mae} tone="bg-faint" />
              </div>
              <div className="mt-2 text-xs text-faint">{t("ai.mae")} · {num(m.test_windows)} test</div>
            </div>
          ))}
        </div>
      </Card>

      {/* Policy + recent verdicts */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <div className="flex items-center gap-2"><GitBranch className="size-5 text-chain" /><h2 className="font-semibold">{t("ai.policy")}</h2></div>
          <ul className="mt-4 space-y-3 text-sm">
            <li className="flex gap-3"><ShieldAlert className="size-5 shrink-0 text-alert" /><span className="text-muted">{t("ai.policy.fraud")}</span></li>
            <li className="flex gap-3"><Wrench className="size-5 shrink-0 text-warn" /><span className="text-muted">{t("ai.policy.degrade")}</span></li>
            <li className="flex gap-3"><ShieldX className="size-5 shrink-0 text-alert" /><span className="text-muted">{t("ai.policy.forge")}</span></li>
          </ul>
        </Card>
        <Card>
          <SectionTitle title={t("ai.recent")} />
          <div className="space-y-3">
            {(flagged ?? []).length === 0 && <p className="text-sm text-faint">–</p>}
            {(flagged ?? []).map((b) => (
              <Link key={b.id} href={`/assets/${b.asset_id}`} className="block rounded-xl bg-surface-2 p-3 hover:ring-1 hover:ring-line">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{b.asset_id} · #{b.id}</span>
                  <Badge tone="alert">{t(`verdict.${b.verdict}`)} · {num(b.anomaly_score * 100)}%</Badge>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {b.explanation.map((e) => <Badge key={e.feature}>{t(`feat.${e.feature}` as never)}</Badge>)}
                </div>
              </Link>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  const { num } = usePrefs();
  return (
    <div>
      <div className="mb-1 flex justify-between"><span className="text-muted">{label}</span><span className="num">{num(value * 100, 1)}%</span></div>
      <Progress value={value} tone="chain" />
    </div>
  );
}

function Bar({ label, value, max, tone }: { label: string; value: number; max: number; tone: string }) {
  const { num } = usePrefs();
  return (
    <div>
      <div className="mb-1 flex justify-between"><span className="text-muted">{label}</span><span className="num">{num(value * 100, 2)}%</span></div>
      <div className="h-2 rounded-full bg-bg"><div className={clsx("h-full rounded-full", tone)} style={{ width: `${(value / max) * 100}%` }} /></div>
    </div>
  );
}

function ConfusionMatrix({ classes, matrix }: { classes: string[]; matrix: number[][] }) {
  const { t, num } = usePrefs();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-center text-xs">
        <thead>
          <tr>
            <th />
            {classes.map((c) => <th key={c} className="pb-2 font-medium text-faint">{t(`verdict.${c}` as never)}</th>)}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row, i) => {
            const total = row.reduce((s, v) => s + v, 0) || 1;
            return (
              <tr key={classes[i]}>
                <th className="pr-2 text-right font-medium text-faint">{t(`verdict.${classes[i]}` as never)}</th>
                {row.map((v, j) => {
                  const share = v / total;
                  return (
                    <td key={j} className="p-1">
                      <div className={clsx("num rounded-lg py-3", i === j ? "text-bg" : v ? "text-alert" : "text-faint")}
                        style={{ background: i === j ? `rgb(167 139 250 / ${0.3 + share * 0.7})` : v ? `rgb(244 63 94 / ${0.08 + share * 2})` : "rgb(19 28 49)" }}>
                        {num(v)}
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
