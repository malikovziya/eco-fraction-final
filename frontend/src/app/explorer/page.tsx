"use client";

import { Blocks } from "lucide-react";
import { Badge, Card, SectionTitle, Skeleton, TxLink } from "@/components/ui";
import { useData } from "@/lib/live";
import { usePrefs } from "@/lib/prefs";

type Recent = { hash: string; block: number; timestamp: number; from: string; to_contract: string | null; function: string | null };
type Contracts = { chainId: number; network: string; contracts: Record<string, string> };

const CONTRACT_NAMES: Record<string, string> = {
  usdc: "MockUSDC", kyc: "KYCRegistry", token: "AssetToken (ERC-1155)", oracle: "EnergyOracle",
  distributor: "RevenueDistributor", primary: "PrimaryMarket", market: "Marketplace", multisig: "MultiSig (2/3)",
};

export default function ExplorerPage() {
  const { t, num } = usePrefs();
  const { data: recent } = useData<Recent[]>("/chain/recent?limit=30", { interval: 3000 });
  const { data: contracts } = useData<Contracts>("/chain/contracts");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight"><Blocks className="size-7 text-chain" />{t("ex.title")}</h1>
        <p className="mt-2 text-muted">{t("ex.subtitle")}</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card>
          <SectionTitle title={t("ex.recent")} />
          {!recent ? <Skeleton className="h-96" /> : (
            <div className="scroll-thin overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-faint">
                  <tr>
                    <th className="pb-2 font-medium">{t("ex.hash")}</th>
                    <th className="pb-2 font-medium">{t("ex.block")}</th>
                    <th className="pb-2 font-medium">{t("ex.contract")}</th>
                    <th className="pb-2 font-medium">{t("ex.function")}</th>
                    <th className="pb-2 font-medium">{t("ex.from")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {recent.map((r) => (
                    <tr key={r.hash}>
                      <td className="py-2"><TxLink hash={r.hash} /></td>
                      <td className="num py-2 font-mono text-xs text-muted">#{num(r.block)}</td>
                      <td className="py-2">{r.to_contract ? <Badge tone="chain">{CONTRACT_NAMES[r.to_contract] ?? r.to_contract}</Badge> : <span className="text-faint">ETH</span>}</td>
                      <td className="py-2 font-mono text-xs">{r.function ?? "transfer"}()</td>
                      <td className="py-2 font-mono text-xs text-faint">{r.from.slice(0, 8)}…{r.from.slice(-4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card className="h-fit">
          <SectionTitle title={t("ex.contracts")} hint={contracts ? `${contracts.network} · chainId ${contracts.chainId}` : ""} />
          <div className="space-y-2.5">
            {contracts && Object.entries(contracts.contracts).map(([k, addr]) => (
              <div key={k}>
                <div className="text-sm font-medium">{CONTRACT_NAMES[k] ?? k}</div>
                <div className="break-all font-mono text-[11px] text-faint">{addr}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
