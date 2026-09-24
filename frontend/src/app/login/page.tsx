"use client";

import clsx from "clsx";
import { motion } from "motion/react";
import { BadgeCheck, Building2, Check, KeyRound, Loader2, ShieldCheck, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Button, Card, TxLink } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { TITLES_TR } from "@/lib/dict";
import { usePrefs } from "@/lib/prefs";
import type { User } from "@/lib/types";

export default function LoginPage() {
  return <Suspense><Login /></Suspense>;
}

const ROLE_ICON = { investor: UserRound, producer: Building2, signer: KeyRound };

function Login() {
  const { t, lang } = usePrefs();
  const router = useRouter();
  const params = useSearchParams();
  const { user, loginPersona, signup, login, refresh } = useAuth();
  const [personas, setPersonas] = useState<User[]>([]);
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"auth" | "kyc">(params.get("step") === "kyc" ? "kyc" : "auth");

  useEffect(() => {
    api<User[]>("/auth/personas").then(setPersonas).catch(() => {});
  }, []);

  const goPersona = async (p: User) => {
    await loginPersona(p.persona!);
    router.push(p.role === "investor" ? "/portfolio" : "/assets");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "signup") {
        await signup(form.name, form.email, form.password);
        setStep("kyc");
      } else {
        const u = await login(form.email, form.password);
        if (u.kyc === "verified") router.push("/portfolio");
        else setStep("kyc");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (step === "kyc" && user) return <KycStep user={user} onDone={refresh} />;

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-center text-3xl font-semibold tracking-tight">{t("auth.title")}</h1>
      <div className="mt-10 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <h2 className="font-semibold">{t("auth.personas")}</h2>
          <p className="mt-1 text-sm text-muted">{t("auth.personasHint")}</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {personas.map((p) => {
              const Icon = ROLE_ICON[p.role];
              return (
                <button key={p.persona} onClick={() => goPersona(p)}
                  className="flex items-start gap-3 rounded-xl border border-line bg-surface-2/50 p-4 text-left transition hover:border-wind/50 hover:bg-surface-2">
                  <span className={clsx("grid size-10 shrink-0 place-items-center rounded-lg",
                    p.role === "investor" ? "bg-wind/10 text-wind" : p.role === "producer" ? "bg-solar/10 text-solar" : "bg-chain/10 text-chain")}>
                    <Icon className="size-5" />
                  </span>
                  <span>
                    <span className="block font-medium">{p.name}</span>
                    <span className="block text-xs text-muted">{lang === "tr" ? TITLES_TR[p.title ?? ""] ?? p.title : p.title}</span>
                    <span className="mt-1 block text-[11px] text-faint">{t(`role.${p.role}`)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </Card>

        <Card>
          <h2 className="font-semibold">{mode === "signup" ? t("auth.signup") : t("auth.login")}</h2>
          <form onSubmit={submit} className="mt-5 space-y-3">
            {mode === "signup" && <Input label={t("auth.name")} value={form.name} onChange={(v) => setForm({ ...form, name: v })} />}
            <Input label={t("auth.email")} type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
            <Input label={t("auth.password")} type="password" value={form.password} onChange={(v) => setForm({ ...form, password: v })} />
            {error && <p className="text-xs text-alert">{error}</p>}
            <Button className="w-full" disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}{mode === "signup" ? t("auth.create") : t("auth.login")}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted">
            {mode === "signup" ? t("auth.haveAccount") : t("auth.noAccount")}{" "}
            <button onClick={() => setMode(mode === "signup" ? "login" : "signup")} className="text-wind hover:underline">
              {mode === "signup" ? t("auth.login") : t("auth.signup")}
            </button>
          </p>
        </Card>
      </div>
    </div>
  );
}

function Input({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="block">
      <span className="text-xs text-faint">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} required
        className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2.5 text-sm outline-none focus:border-wind" />
    </label>
  );
}

const CHECKS = ["kyc.check.doc", "kyc.check.sanctions", "kyc.check.liveness", "kyc.check.wallet"] as const;

function KycStep({ user, onDone }: { user: User; onDone: () => Promise<void> }) {
  const { t } = usePrefs();
  const [form, setForm] = useState({ full_name: user.name, national_id: "", country: "AZ", birth_date: "1995-05-15" });
  const [progress, setProgress] = useState(user.kyc === "verified" ? CHECKS.length : -1);
  const [tx, setTx] = useState<string | null>(null);
  const [deposited, setDeposited] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    for (let i = 0; i < CHECKS.length - 1; i++) {
      setProgress(i);
      await new Promise((r) => setTimeout(r, 750));
    }
    setProgress(CHECKS.length - 1);
    try {
      const res = await api<{ tx_hash?: string }>("/kyc", { method: "POST", json: form });
      setTx(res.tx_hash ?? null);
      setProgress(CHECKS.length);
      await onDone();
    } catch (err) {
      setError((err as Error).message);
      setProgress(-1);
    }
  };

  const deposit = async () => {
    const res = await api<{ tx_hash: string }>("/wallet/deposit", { method: "POST", json: { amount: 1000, bank: "Sandbox Bank" } });
    setDeposited(res.tx_hash);
  };

  const done = progress >= CHECKS.length;
  return (
    <div className="mx-auto max-w-xl">
      <Card>
        <div className="flex items-center gap-2"><ShieldCheck className="size-5 text-wind" /><h1 className="text-xl font-semibold">{t("kyc.title")}</h1></div>
        <p className="mt-1 text-sm text-muted">{t("kyc.subtitle")}</p>
        <div className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
          {t("auth.walletCreated")}: <span className="font-mono text-text">{user.wallet}</span>
        </div>

        {progress < 0 ? (
          <form onSubmit={start} className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><Input label={t("kyc.fullName")} value={form.full_name} onChange={(v) => setForm({ ...form, full_name: v })} /></div>
            <Input label={t("kyc.nationalId")} value={form.national_id} onChange={(v) => setForm({ ...form, national_id: v })} />
            <Input label={t("kyc.country")} value={form.country} onChange={(v) => setForm({ ...form, country: v })} />
            <div className="sm:col-span-2"><Input label={t("kyc.birth")} type="date" value={form.birth_date} onChange={(v) => setForm({ ...form, birth_date: v })} /></div>
            {error && <p className="text-xs text-alert sm:col-span-2">{error}</p>}
            <Button className="sm:col-span-2">{t("kyc.submit")}</Button>
          </form>
        ) : (
          <div className="mt-6 space-y-3">
            {CHECKS.map((c, i) => (
              <motion.div key={c} initial={{ opacity: 0, x: -8 }} animate={{ opacity: i <= progress ? 1 : 0.35, x: 0 }}
                className="flex items-center gap-3 text-sm">
                <span className={clsx("grid size-7 place-items-center rounded-full",
                  i < progress || done ? "bg-wind/15 text-wind" : "bg-surface-2 text-muted")}>
                  {i < progress || done ? <Check className="size-4" /> : i === progress ? <Loader2 className="size-4 animate-spin" /> : <span className="size-1.5 rounded-full bg-faint" />}
                </span>
                {t(c)}
                {c === "kyc.check.wallet" && tx && <TxLink hash={tx} />}
              </motion.div>
            ))}
          </div>
        )}

        {done && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-6 space-y-3">
            <div className="flex items-center gap-2 rounded-xl bg-wind/10 p-3 text-sm font-medium text-wind">
              <BadgeCheck className="size-5" />{t("kyc.done")}
            </div>
            {deposited ? (
              <div className="flex items-center justify-between rounded-xl bg-surface-2 p-3 text-sm">+ $1,000 USDC <TxLink hash={deposited} /></div>
            ) : (
              <Button variant="outline" className="w-full" onClick={deposit}>{t("kyc.deposit")}</Button>
            )}
            <Link href="/assets"><Button className="w-full">{t("kyc.continue")}</Button></Link>
          </motion.div>
        )}
        <p className="mt-5 text-xs text-faint">{t("kyc.sandbox")}</p>
      </Card>
    </div>
  );
}
