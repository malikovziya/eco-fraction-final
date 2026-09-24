"use client";

import clsx from "clsx";
import { CheckCircle2, Clock, KeyRound, Loader2, RotateCcw, ShieldAlert, Unlock, UserCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, Button, Card, SectionTitle, Skeleton, TxLink } from "@/components/ui";
import { api } from "@/lib/api";
import { assetName } from "@/lib/assets";
import { useAuth } from "@/lib/auth";
import { useData } from "@/lib/live";
import { TITLES_TR } from "@/lib/dict";
import { usePrefs } from "@/lib/prefs";
import type { BatchT, User } from "@/lib/types";

type Proposal = {
  id: number; target: string; function: { name: string; params: { batchId?: number } } | null; description: string;
  executed: boolean; approvals: number; approved_by: string[];
};
type Proposals = { threshold: number; owners: string[]; proposals: Proposal[] };

export default function GovernancePage() {
  const { tx, lang } = usePrefs();
  const { user, loginPersona } = useAuth();
  const [signers, setSigners] = useState<User[]>([]);
  const refresh = ["multisig", "batch_settled", "alert"];
  const { data: escrowed } = useData<BatchT[]>("/batches?status=escrowed&limit=20", { refreshOn: refresh });
  const { data: resolved } = useData<BatchT[]>("/batches?flagged=true&limit=12", { refreshOn: refresh });
  const { data: props, reload } = useData<Proposals>("/multisig/proposals", { refreshOn: refresh });

  useEffect(() => {
    api<User[]>("/auth/personas").then((p) => setSigners(p.filter((u) => u.role === "signer"))).catch(() => {});
  }, []);
  const nameOf = (addr: string) => signers.find((s) => s.wallet.toLowerCase() === addr.toLowerCase())?.name ?? addr.slice(0, 8);
  const isSigner = user?.role === "signer";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight"><KeyRound className="size-7 text-chain" />{tx("Yönetişim · 2/3 çoklu imza", "Governance · 2-of-3 multisig")}</h1>
          <p className="mt-2 max-w-3xl text-muted">
            {tx("Yapay zekanın işaretlediği gelir, tek bir kişinin kararıyla hareket edemez. Üç yetkiliden ikisi onaylamadan emanetteki USDC ne yatırımcılara dağıtılır ne de şebekeye iade edilir.",
              "Revenue flagged by the AI cannot be moved by any single person. Escrowed USDC is neither released to investors nor refunded to the grid until two of three signers approve.")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {signers.map((s) => (
            <button key={s.persona} onClick={() => loginPersona(s.persona!)}
              className={clsx("flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs transition",
                user?.persona === s.persona ? "border-chain bg-chain/10" : "border-line hover:border-faint")}>
              <UserCheck className={clsx("size-4", user?.persona === s.persona ? "text-chain" : "text-faint")} />
              <span><span className="block font-medium text-text">{s.name}</span><span className="text-faint">{lang === "tr" ? TITLES_TR[s.title ?? ""] ?? s.title : s.title}</span></span>
            </button>
          ))}
        </div>
      </div>

      {!isSigner && (
        <Card className="text-sm text-muted">
          {tx("İnceleme yapmak için yukarıdan bir imza yetkilisi seçin.", "Pick a signer above to review.")}
        </Card>
      )}

      <section>
        <SectionTitle title={tx("İnceleme bekleyen emanetler", "Escrow awaiting review")}
          hint={tx("Her kart: zincire yazılmış parti, YZ kararı ve kanıt olarak partinin imzalı okumaları.",
            "Each card: the anchored batch, the AI verdict, and the batch's signed readings as evidence.")} />
        {!escrowed ? <Skeleton className="h-64" /> : escrowed.length === 0 ? (
          <Card className="flex items-center gap-3 text-sm text-muted"><CheckCircle2 className="size-5 text-wind" />{tx("Emanette bekleyen gelir yok. Senaryo panelinden (Ctrl+Shift+D) sayaç manipülasyonu başlatabilirsiniz.", "Nothing in escrow. Start a meter-tampering scenario from the scenario panel (Ctrl+Shift+D).")}</Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {escrowed.map((b) => (
              <EscrowCard key={b.id} batch={b} proposals={props?.proposals ?? []} threshold={props?.threshold ?? 2}
                nameOf={nameOf} canAct={isSigner} me={user?.wallet} onChange={reload} />
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionTitle title={tx("Öneri geçmişi", "Proposal history")} hint={props ? `${props.threshold}/${props.owners.length} ${tx("imza gerekli", "signatures required")}` : ""} />
          <div className="space-y-2">
            {(props?.proposals ?? []).length === 0 && <p className="text-sm text-faint">–</p>}
            {props?.proposals.map((p) => (
              <div key={p.id} className="rounded-xl bg-surface-2 p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">#{p.id} · {p.function?.name === "refundEscrow" ? tx("Şebekeye iade", "Refund grid") : tx("Yatırımcılara serbest bırak", "Release to investors")}</span>
                  {p.executed ? <Badge tone="wind"><CheckCircle2 className="size-3" />{tx("Uygulandı", "Executed")}</Badge>
                    : <Badge tone="warn"><Clock className="size-3" />{p.approvals}/{props.threshold}</Badge>}
                </div>
                <div className="mt-1 text-xs text-muted">{p.description}</div>
                <div className="mt-2 flex flex-wrap gap-1">{p.approved_by.map((a) => <Badge key={a} tone="chain">{nameOf(a)}</Badge>)}</div>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <SectionTitle title={tx("Sonuçlanan kararlar", "Resolved decisions")} />
          <div className="space-y-2">
            {(resolved ?? []).filter((b) => b.status !== "escrowed").map((b) => (
              <div key={b.id} className="flex items-center justify-between rounded-xl bg-surface-2 p-3 text-sm">
                <span>{assetName(b.asset_id)} · #{b.id}</span>
                <Badge tone={b.status === "released" ? "wind" : "warn"}>
                  {b.status === "released" ? tx("Yatırımcılara dağıtıldı", "Released to investors") : tx("Şebekeye iade edildi", "Refunded to grid")}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function EscrowCard({ batch, proposals, threshold, nameOf, canAct, me, onChange }: {
  batch: BatchT; proposals: Proposal[]; threshold: number; nameOf: (a: string) => string;
  canAct: boolean; me?: string; onChange: () => void;
}) {
  const { t, tx, money, num } = usePrefs();
  const { data: readings } = useData<{ ts: string; power_kw: number; fraud_prob: number; capacity_kw: number }[]>(`/batches/${batch.id}/readings`);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<string | null>(null);
  const open = proposals.find((p) => !p.executed && p.function?.params?.batchId === batch.chain_batch_id);
  const iApproved = open?.approved_by.some((a) => a.toLowerCase() === me?.toLowerCase());
  const cap = readings?.[0]?.capacity_kw ?? 0;
  const mw = cap >= 10_000;

  const act = async (label: string, fn: () => Promise<{ tx_hash: string }>) => {
    setBusy(label);
    setError(null);
    try {
      setLastTx((await fn()).tx_hash);
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const propose = (action: "release" | "refund") =>
    act(action, () => api("/multisig/propose", { method: "POST", json: { batch_id: batch.id, action } }));
  const approve = () => act("approve", () => api("/multisig/approve", { method: "POST", json: { proposal_id: open!.id } }));

  return (
    <Card className="glow-alert">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-semibold"><ShieldAlert className="size-4 text-alert" />{assetName(batch.asset_id)}</div>
          <div className="mt-0.5 text-xs text-muted">
            #{batch.id} · {batch.period_start.slice(5, 10)} {batch.period_start.slice(11, 16)}–{batch.period_end.slice(11, 16)} · EnergyOracle #{batch.chain_batch_id}
          </div>
        </div>
        <div className="text-right">
          <div className="num text-xl font-semibold text-alert">{money(batch.revenue_usdc)}</div>
          <div className="text-xs text-faint">{tx("emanette", "in escrow")}</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge tone="alert">{t(`verdict.${batch.verdict}`)} · {num(batch.anomaly_score * 100)}%</Badge>
        <Badge>{batch.suspicious_readings}/{batch.readings} {tx("şüpheli okuma", "suspicious readings")}</Badge>
        <Badge tone="chain">{num(batch.energy_kwh / 1000, 1)} MWh {tx("bildirildi", "reported")}</Badge>
      </div>

      <div className="mt-3 h-32">
        {readings && (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={readings.map((r) => ({ label: r.ts.slice(11, 16), v: mw ? r.power_kw / 1000 : r.power_kw, f: r.fraud_prob }))}
              margin={{ top: 6, right: 4, left: -18, bottom: 0 }}>
              <XAxis dataKey="label" stroke="#5b6782" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis stroke="#5b6782" fontSize={10} tickLine={false} axisLine={false} width={58} unit={mw ? " MW" : " kW"} tickFormatter={(v) => num(v)} />
              <ReferenceLine y={mw ? cap / 1000 : cap} stroke="#5b6782" strokeDasharray="3 3" />
              <Tooltip contentStyle={{ background: "#0d1424", border: "1px solid #1f2a44", borderRadius: 10, fontSize: 11 }} />
              <Area dataKey="v" stroke="#f43f5e" fill="#f43f5e" fillOpacity={0.15} isAnimationActive={false}
                dot={(p) => {
                  const { cx, cy, payload, index } = p as { cx: number; cy: number; payload: { f: number }; index: number };
                  return payload.f > 0.5 ? <circle key={index} cx={cx} cy={cy} r={3} fill="#f43f5e" /> : <g key={index} />;
                }} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="mt-2 space-y-1">
        {batch.explanation.map((e) => (
          <div key={e.feature} className="flex justify-between text-xs"><span className="text-muted">{t(`feat.${e.feature}` as never)}</span><span className="num">{num(e.value, 2)}</span></div>
        ))}
      </div>

      <div className="mt-4 border-t border-line pt-4">
        {open ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span>{open.function?.name === "refundEscrow" ? tx("Öneri: şebekeye iade", "Proposal: refund grid") : tx("Öneri: serbest bırak", "Proposal: release")}</span>
              <Badge tone="warn">{open.approvals}/{threshold} {tx("imza", "signatures")}</Badge>
            </div>
            <div className="flex flex-wrap gap-1">{open.approved_by.map((a) => <Badge key={a} tone="chain">✓ {nameOf(a)}</Badge>)}</div>
            {canAct && !iApproved && (
              <Button className="w-full" disabled={busy !== null} onClick={approve}>
                {busy === "approve" ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}{tx("İkinci imzayı at ve uygula", "Add second signature & execute")}
              </Button>
            )}
            {canAct && iApproved && <p className="text-xs text-faint">{tx("Siz onayladınız. İkinci imza için yukarıdan başka bir yetkiliye geçin.", "You approved. Switch to another signer above for the second signature.")}</p>}
          </div>
        ) : canAct ? (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" disabled={busy !== null} onClick={() => propose("release")}>
              {busy === "release" ? <Loader2 className="size-4 animate-spin" /> : <Unlock className="size-4" />}{tx("Yanlış alarm: serbest bırak", "False alarm: release")}
            </Button>
            <Button variant="danger" disabled={busy !== null} onClick={() => propose("refund")}>
              {busy === "refund" ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}{tx("Manipülasyon: iade et", "Fraud: refund grid")}
            </Button>
          </div>
        ) : (
          <Link href="/login" className="text-xs text-chain">{tx("İmza yetkilisi olarak giriş yapın", "Sign in as a signer")}</Link>
        )}
        {lastTx && <div className="mt-2 text-xs text-muted">tx: <TxLink hash={lastTx} /></div>}
        {error && <p className="mt-2 text-xs text-alert">{error}</p>}
      </div>
    </Card>
  );
}
