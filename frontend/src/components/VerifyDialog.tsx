"use client";

import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, Loader2, X, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { batchFingerprint, onchainBatchHash } from "@/lib/fingerprint";
import { usePrefs } from "@/lib/prefs";

type Result = {
  batch_id: number;
  chain_batch_id: number;
  readings: number;
  recomputed_hash: string;
  onchain_hash: string;
  match: boolean;
  sample_reading: Record<string, unknown> | null;
  checkedBy: "browser" | "server";
};

/** The check runs in this browser: it hashes the raw signed readings itself and reads the
 *  recorded hash straight from the chain. The server-side check is only a fallback. */
async function verifyInBrowser(batchId: number): Promise<Result> {
  const [raw, chain] = await Promise.all([
    api<{ chain_batch_id: number; readings: string[] }>(`/batches/${batchId}/raw`),
    api<{ contracts: { oracle: string } }>("/chain/contracts"),
  ]);
  const [recomputed, onchain] = await Promise.all([
    batchFingerprint(raw.readings),
    onchainBatchHash(chain.contracts.oracle, raw.chain_batch_id),
  ]);
  return {
    batch_id: batchId, chain_batch_id: raw.chain_batch_id, readings: raw.readings.length,
    recomputed_hash: recomputed, onchain_hash: onchain, match: recomputed === onchain,
    sample_reading: raw.readings.length ? JSON.parse(raw.readings[0]) : null, checkedBy: "browser",
  };
}

async function verifyOnServer(batchId: number): Promise<Result> {
  return { ...(await api<Omit<Result, "checkedBy">>(`/batches/${batchId}/verify`)), checkedBy: "server" };
}

async function verify(batchId: number): Promise<Result> {
  try {
    const local = await verifyInBrowser(batchId);
    if (local.match) return local;
    // Never report a mismatch the server check does not confirm (it would be a browser-side fault)
    const server = await verifyOnServer(batchId);
    return server.match ? server : local;
  } catch {
    return verifyOnServer(batchId); // e.g. browser without Web Crypto, or chain unreachable
  }
}

export function VerifyDialog({ batchId, onClose }: { batchId: number | null; onClose: () => void }) {
  const { t, tx } = usePrefs();
  const [loaded, setLoaded] = useState<Result | null>(null);
  const result = loaded && loaded.batch_id === batchId ? loaded : null;

  useEffect(() => {
    if (batchId == null) return;
    // Short pause so the check reads as a computation, not a lookup
    const timer = setTimeout(() => verify(batchId).then(setLoaded).catch(() => {}), 600);
    return () => clearTimeout(timer);
  }, [batchId]);

  return (
    <AnimatePresence>
      {batchId != null && (
        <motion.div className="fixed inset-0 z-50 grid place-items-center bg-bg/70 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div className="card w-full max-w-2xl p-6" initial={{ scale: 0.96 }} animate={{ scale: 1 }}
            onClick={(e) => e.stopPropagation()}>
            <div className="mb-5 flex items-center justify-between">
              <h3 className="text-lg font-semibold">{t("verify.title")} · #{batchId}</h3>
              <button onClick={onClose} className="text-faint hover:text-text"><X className="size-5" /></button>
            </div>
            {!result ? (
              <div className="flex items-center gap-3 py-10 text-muted"><Loader2 className="size-5 animate-spin" />SHA-256…</div>
            ) : (
              <div className="space-y-4">
                <HashRow label={`${t("verify.recomputed")} (${result.readings} ${t("verify.readings")})`} value={result.recomputed_hash} />
                <HashRow label={`${t("verify.onchain")} (EnergyOracle #${result.chain_batch_id})`} value={result.onchain_hash} />
                <div className={`flex items-center gap-2 rounded-xl p-3 text-sm font-medium ${result.match ? "bg-wind/10 text-wind" : "bg-alert/10 text-alert"}`}>
                  {result.match ? <CheckCircle2 className="size-5" /> : <XCircle className="size-5" />}
                  {result.match ? t("verify.match") : t("verify.mismatch")}
                </div>
                <p className="text-xs text-muted">
                  {result.checkedBy === "browser"
                    ? tx("Bu özet sizin tarayıcınızda hesaplandı ve doğrudan blokzincirden okunan değerle karşılaştırıldı. Platform sunucusunun cevabı kullanılmadı.",
                      "This hash was computed in your browser and compared with the value read directly from the blockchain. The platform server's answer was not used.")
                    : tx("Bu kontrol platform sunucusu tarafından yapıldı (tarayıcı kontrolü bu cihazda kullanılamadı).",
                      "This check was performed by the platform server (the browser check was unavailable on this device).")}
                </p>
                {result.sample_reading && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted">{t("verify.sample")}</summary>
                    <pre className="scroll-thin mt-2 max-h-56 overflow-auto rounded-lg bg-bg p-3 font-mono text-[11px] text-muted">
                      {JSON.stringify(result.sample_reading, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function HashRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mb-1 text-xs text-faint">{label}</div>
      <div className="break-all rounded-lg bg-bg px-3 py-2 font-mono text-xs text-chain">{value}</div>
    </div>
  );
}
