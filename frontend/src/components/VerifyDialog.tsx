"use client";

import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, Loader2, X, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { usePrefs } from "@/lib/prefs";

type Result = {
  batch_id: number;
  chain_batch_id: number;
  readings: number;
  recomputed_hash: string;
  onchain_hash: string;
  match: boolean;
  sample_reading: Record<string, unknown> | null;
};

/** Recomputes a batch hash from the raw signed readings and compares it with the chain. */
export function VerifyDialog({ batchId, onClose }: { batchId: number | null; onClose: () => void }) {
  const { t } = usePrefs();
  const [loaded, setLoaded] = useState<Result | null>(null);
  const result = loaded && loaded.batch_id === batchId ? loaded : null;

  useEffect(() => {
    if (batchId == null) return;
    // Short pause so the check reads as a computation, not a lookup
    const timer = setTimeout(() => api<Result>(`/batches/${batchId}/verify`).then(setLoaded).catch(() => {}), 600);
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
