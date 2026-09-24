"use client";

import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, Landmark, Loader2, Lock, ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { usePrefs } from "@/lib/prefs";
import { Button, TxLink } from "./ui";

type Bank = { id: string; name: string; country: string; bic: string; color: string };
type Consent = {
  consent_id: string; bank: Bank; type: "deposit" | "withdraw"; amount: number; account_iban: string;
  scopes: string[]; expires_at: number; sandbox_otp: string;
};
type Step = "choose" | "consent" | "bank" | "done";

const SCOPE_LABEL: Record<string, [string, string]> = {
  "accounts:read": ["Hesap bilgilerini ve bakiyeyi görüntüleme", "View account details and balance"],
  "payments:initiate": ["Tek seferlik ödeme başlatma", "Initiate a single payment"],
  "payments:receive": ["Hesabınıza ödeme alma", "Receive a payment into your account"],
};

/** PSD2-style Open Banking flow: choose bank -> consent -> bank authorization -> on-chain settlement. */
export function BankDialog({ open, mode, onClose, onDone }: {
  open: boolean; mode: "deposit" | "withdraw"; onClose: () => void; onDone?: () => void;
}) {
  const { tx, money, lang } = usePrefs();
  const [banks, setBanks] = useState<Bank[]>([]);
  const [bankId, setBankId] = useState("caspian");
  const [amount, setAmount] = useState(500);
  const [step, setStep] = useState<Step>("choose");
  const [consent, setConsent] = useState<Consent | null>(null);
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ tx_hash: string; reference: string } | null>(null);
  const i = lang === "tr" ? 0 : 1;

  useEffect(() => {
    if (open && banks.length === 0) api<Bank[]>("/banking/banks").then(setBanks).catch(() => {});
  }, [open, banks.length]);

  const reset = () => { setStep("choose"); setConsent(null); setOtp(""); setError(null); setResult(null); };
  const close = () => { reset(); onClose(); };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const requestConsent = () => run(async () => {
    setConsent(await api<Consent>("/banking/consents", { method: "POST", json: { bank_id: bankId, type: mode, amount } }));
    setStep("consent");
  });
  const authorize = () => run(async () => {
    await new Promise((r) => setTimeout(r, 700)); // bank-side processing
    setResult(await api<{ tx_hash: string; reference: string }>(`/banking/consents/${consent!.consent_id}/authorize`, { method: "POST", json: { otp } }));
    setStep("done");
    onDone?.();
  });

  const bank = consent?.bank ?? banks.find((b) => b.id === bankId);

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 grid place-items-center bg-bg/75 p-4 backdrop-blur-sm" onClick={close}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="card w-full max-w-lg overflow-hidden p-0" onClick={(e) => e.stopPropagation()} initial={{ scale: 0.96 }} animate={{ scale: 1 }}>
            <div className="flex items-center justify-between border-b border-line px-6 py-4">
              <div className="flex items-center gap-2 font-semibold">
                {mode === "deposit" ? <ArrowDownLeft className="size-5 text-money" /> : <ArrowUpRight className="size-5 text-chain" />}
                {mode === "deposit" ? tx("Açık Bankacılık ile para yatır", "Deposit with Open Banking") : tx("Banka hesabına çek", "Withdraw to bank")}
              </div>
              <button onClick={close} className="text-faint hover:text-text"><X className="size-5" /></button>
            </div>
            <Steps step={step} />

            <div className="p-6">
              {step === "choose" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-2">
                    {banks.map((b) => (
                      <button key={b.id} onClick={() => setBankId(b.id)}
                        className={clsx("flex items-center gap-2.5 rounded-xl border p-3 text-left text-sm transition",
                          bankId === b.id ? "border-chain bg-chain/5" : "border-line hover:border-faint")}>
                        <span className="grid size-8 shrink-0 place-items-center rounded-lg text-xs font-bold text-bg" style={{ background: b.color }}>{b.name[0]}</span>
                        <span className="leading-tight"><span className="block font-medium">{b.name}</span><span className="text-[11px] text-faint">{b.country} · {b.bic}</span></span>
                      </button>
                    ))}
                  </div>
                  <label className="block text-xs text-faint">{tx("Tutar (USD)", "Amount (USD)")}
                    <input type="number" min={10} value={amount} onChange={(e) => setAmount(Number(e.target.value))}
                      className="num mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2.5 text-lg font-semibold text-text outline-none focus:border-wind" />
                  </label>
                  <div className="flex gap-1.5">
                    {[100, 500, 1000, 5000].map((v) => (
                      <button key={v} onClick={() => setAmount(v)} className={clsx("flex-1 rounded-md py-1 text-xs ring-1", amount === v ? "text-wind ring-wind/40" : "text-muted ring-line")}>{money(v, { decimals: 0 })}</button>
                    ))}
                  </div>
                  <Button className="w-full" disabled={busy || amount <= 0} onClick={requestConsent}>
                    {busy && <Loader2 className="size-4 animate-spin" />}{tx("Devam et", "Continue")}
                  </Button>
                </div>
              )}

              {step === "consent" && consent && (
                <div className="space-y-4 text-sm">
                  <p className="text-muted">
                    {tx(`Eco-Fraction, ${consent.bank.name} hesabınıza aşağıdaki izinlerle erişmek istiyor:`,
                      `Eco-Fraction requests the following access to your ${consent.bank.name} account:`)}
                  </p>
                  <ul className="space-y-2">
                    {consent.scopes.map((s) => (
                      <li key={s} className="flex items-center gap-2"><ShieldCheck className="size-4 text-wind" />{SCOPE_LABEL[s]?.[i] ?? s}</li>
                    ))}
                  </ul>
                  <dl className="space-y-1.5 rounded-xl bg-surface-2 p-3 text-xs">
                    <Row k={tx("Hesap", "Account")} v={<span className="font-mono">{consent.account_iban}</span>} />
                    <Row k={tx("Tutar", "Amount")} v={<span className="num font-semibold">{money(consent.amount)}</span>} />
                    <Row k={tx("İşlem", "Operation")} v={consent.type === "deposit" ? tx("Cüzdana USDC (1:1)", "USDC to wallet (1:1)") : tx("USDC → banka hesabı", "USDC → bank account")} />
                    <Row k={tx("Geçerlilik", "Valid for")} v={tx("5 dakika, tek kullanımlık", "5 minutes, single use")} />
                    <Row k={tx("Çerçeve", "Framework")} v="PSD2 · Strong Customer Authentication" />
                  </dl>
                  <Button className="w-full" onClick={() => setStep("bank")}><Lock className="size-4" />{tx(`${consent.bank.name}'a yönlendir`, `Continue to ${consent.bank.name}`)}</Button>
                </div>
              )}

              {step === "bank" && consent && bank && (
                <div className="overflow-hidden rounded-xl border border-line">
                  <div className="flex items-center gap-2 px-4 py-3 text-sm font-semibold text-bg" style={{ background: bank.color }}>
                    <Landmark className="size-4" />{bank.name} · {tx("Güvenli onay", "Secure approval")}
                  </div>
                  <div className="space-y-3 bg-bg p-4 text-sm">
                    <p className="text-muted">{tx("Eco-Fraction için", "Authorise for Eco-Fraction:")} <b className="num text-text">{money(consent.amount)}</b></p>
                    <label className="block text-xs text-faint">{tx("SMS doğrulama kodu", "SMS one-time code")}
                      <input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="••••••"
                        className="num mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-center font-mono text-xl tracking-[0.5em] text-text outline-none focus:border-chain" />
                    </label>
                    <p className="text-[11px] text-faint">{tx("Sandbox kodu", "Sandbox code")}: <span className="font-mono">{consent.sandbox_otp}</span></p>
                    {error && <p className="text-xs text-alert">{error}</p>}
                    <button onClick={authorize} disabled={busy || otp.length !== 6}
                      className="flex w-full items-center justify-center gap-2 rounded-lg py-2.5 font-medium text-bg disabled:opacity-50" style={{ background: bank.color }}>
                      {busy && <Loader2 className="size-4 animate-spin" />}{tx("Ödemeyi onayla", "Approve payment")}
                    </button>
                  </div>
                </div>
              )}

              {step === "done" && result && consent && (
                <div className="space-y-4 text-center">
                  <CheckCircle2 className="mx-auto size-12 text-money" />
                  <div className="text-lg font-semibold">
                    {consent.type === "deposit" ? tx(`${money(consent.amount)} cüzdanınıza yatırıldı`, `${money(consent.amount)} added to your wallet`)
                      : tx(`${money(consent.amount)} bankanıza gönderildi`, `${money(consent.amount)} sent to your bank`)}
                  </div>
                  <dl className="space-y-1.5 rounded-xl bg-surface-2 p-3 text-left text-xs">
                    <Row k={tx("Banka referansı", "Bank reference")} v={<span className="font-mono">{result.reference}</span>} />
                    <Row k={tx("Zincir işlemi", "On-chain tx")} v={<TxLink hash={result.tx_hash} />} />
                  </dl>
                  <Button className="w-full" onClick={close}>{tx("Kapat", "Close")}</Button>
                </div>
              )}
              {error && step !== "bank" && <p className="mt-3 text-xs text-alert">{error}</p>}
            </div>
            <p className="border-t border-line px-6 py-3 text-[11px] text-faint">
              {tx("Sandbox ortamı: bankalar kurgusaldır. Zincir üzerindeki USDC hareketi gerçektir (test token).",
                "Sandbox: banks are fictional. The on-chain USDC movement is real (test token).")}
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Steps({ step }: { step: Step }) {
  const { tx } = usePrefs();
  const steps: [Step, string][] = [["choose", tx("Banka", "Bank")], ["consent", tx("İzin", "Consent")], ["bank", tx("Onay", "Approve")], ["done", tx("Tamam", "Done")]];
  const idx = steps.findIndex(([s]) => s === step);
  return (
    <div className="flex gap-1 px-6 pt-4">
      {steps.map(([s, label], i) => (
        <div key={s} className="flex-1">
          <div className={clsx("h-1 rounded-full", i <= idx ? "bg-chain" : "bg-surface-2")} />
          <div className={clsx("mt-1 text-[10px]", i <= idx ? "text-text" : "text-faint")}>{label}</div>
        </div>
      ))}
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex justify-between gap-3"><dt className="text-faint">{k}</dt><dd className="text-right">{v}</dd></div>;
}
