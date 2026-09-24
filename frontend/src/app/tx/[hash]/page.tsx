"use client";

import { ArrowLeft, CheckCircle2, XCircle } from "lucide-react";
import Link from "next/link";
import { use } from "react";
import { Badge, Card, SectionTitle, Skeleton } from "@/components/ui";
import { useData } from "@/lib/live";
import { usePrefs } from "@/lib/prefs";

type Tx = {
  hash: string;
  status: "success" | "reverted";
  block: number;
  timestamp: string;
  from: string;
  to: string | null;
  to_contract: string | null;
  function: { name: string; params: Record<string, unknown> } | null;
  gas_used: number;
  events: { contract: string; event: string; args: Record<string, unknown> }[];
};

export default function TxPage({ params }: { params: Promise<{ hash: string }> }) {
  const { hash } = use(params);
  const { t, num } = usePrefs();
  const { data: tx, error } = useData<Tx>(`/chain/tx/${hash}`);

  return (
    <div className="space-y-6">
      <Link href="/explorer" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-text">
        <ArrowLeft className="size-4" />{t("ex.title")}
      </Link>
      {error && <Card className="text-alert">{error}</Card>}
      {!tx && !error && <Skeleton className="h-96" />}
      {tx && (
        <>
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h1 className="text-xl font-semibold">{t("ex.hash")}</h1>
              {tx.status === "success"
                ? <Badge tone="wind"><CheckCircle2 className="size-3" />{t("ex.success")}</Badge>
                : <Badge tone="alert"><XCircle className="size-3" />reverted</Badge>}
            </div>
            <div className="mt-2 break-all font-mono text-sm text-chain">{tx.hash}</div>
            <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <Field label={t("ex.block")} value={`#${num(tx.block)}`} />
              <Field label={t("ex.contract")} value={tx.to_contract ?? tx.to ?? "–"} />
              <Field label={t("ex.function")} value={tx.function ? `${tx.function.name}()` : "transfer"} />
              <Field label={t("ex.gas")} value={num(tx.gas_used)} />
              <Field label={t("ex.from")} value={tx.from} mono wide />
              <Field label="Time" value={tx.timestamp.replace("T", " ")} />
            </dl>
          </Card>

          {tx.function && Object.keys(tx.function.params).length > 0 && (
            <Card>
              <SectionTitle title={t("ex.params")} />
              <KeyValues data={tx.function.params} />
            </Card>
          )}

          <Card>
            <SectionTitle title={`${t("ex.events")} (${tx.events.length})`} />
            <div className="space-y-3">
              {tx.events.map((e, i) => (
                <div key={i} className="rounded-xl bg-surface-2 p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <Badge tone="chain">{e.contract}</Badge>
                    <span className="font-mono text-sm font-semibold">{e.event}</span>
                  </div>
                  <KeyValues data={e.args} />
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function Field({ label, value, mono, wide }: { label: string; value: string; mono?: boolean; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <dt className="text-xs text-faint">{label}</dt>
      <dd className={`mt-0.5 break-all ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}

function KeyValues({ data }: { data: Record<string, unknown> }) {
  return (
    <dl className="grid gap-x-6 gap-y-1.5 font-mono text-xs sm:grid-cols-[auto_1fr]">
      {Object.entries(data).map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-faint">{k}</dt>
          <dd className="break-all text-muted">{Array.isArray(v) ? v.join(", ") : String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}
