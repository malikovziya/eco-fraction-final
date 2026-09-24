"use client";

import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { Brain, Cpu, ExternalLink, LayoutDashboard, Link2, Radio, Wallet, Waves } from "lucide-react";
import { useRef, useState } from "react";
import { Badge, Card } from "@/components/ui";
import { useLiveEvent } from "@/lib/live";
import { usePrefs } from "@/lib/prefs";

type NodeId = "sensors" | "mqtt" | "kafka" | "ai" | "chain" | "payment" | "dashboard";
type Layer = "physical" | "data" | "intelligence" | "blockchain" | "financial" | "user";

const W = 760;
const X = 430; // node column
const NODES: Record<NodeId, { y: number; layer: Layer; color: string; icon: React.ElementType; sub: string }> = {
  sensors: { y: 50, layer: "physical", color: "#f5a524", icon: Cpu, sub: "6 × Ed25519 smart meters" },
  mqtt: { y: 160, layer: "data", color: "#38bdf8", icon: Radio, sub: "Mosquitto + signature bridge" },
  kafka: { y: 260, layer: "data", color: "#38bdf8", icon: Waves, sub: "Redpanda (Kafka API)" },
  ai: { y: 370, layer: "intelligence", color: "#a78bfa", icon: Brain, sub: "XGBoost + LSTM + ESG" },
  chain: { y: 480, layer: "blockchain", color: "#f59e0b", icon: Link2, sub: "ERC-1155 · Oracle · Multisig" },
  payment: { y: 590, layer: "financial", color: "#94a3b8", icon: Wallet, sub: "USDC + Open Banking" },
  dashboard: { y: 700, layer: "user", color: "#f472b6", icon: LayoutDashboard, sub: "Next.js + WebSocket" },
};
const ORDER: NodeId[] = ["sensors", "mqtt", "kafka", "ai", "chain", "payment", "dashboard"];
const EDGE_LABEL: Partial<Record<NodeId, string>> = {
  sensors: "arch.edge.readings", kafka: "arch.edge.stream", ai: "arch.edge.verdict", chain: "arch.edge.revenue", payment: "arch.edge.payout",
};
const LAYER_NODES: Record<Layer, NodeId[]> = {
  physical: ["sensors"], data: ["mqtt", "kafka"], intelligence: ["ai"], blockchain: ["chain"], financial: ["payment"], user: ["dashboard"],
};

type Pulse = { id: number; from: NodeId; to: NodeId; color: string; delay: number };
type Burst = { id: number; at: NodeId; color: string };

const NODE_H = 58, NODE_W = 240;

export default function ArchitecturePage() {
  const { t, lang } = usePrefs();
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const [selected, setSelected] = useState<Layer>("intelligence");
  const [counts, setCounts] = useState({ readings: 0, rejected: 0, batches: 0, flagged: 0, anchored: 0, escrowed: 0, payouts: 0, investments: 0 });
  const nextId = useRef(1);
  const lastReading = useRef(0);

  const flow = (path: NodeId[], color: string, stagger = 0.45) => {
    const created: Pulse[] = [];
    for (let i = 0; i < path.length - 1; i++) {
      created.push({ id: nextId.current++, from: path[i], to: path[i + 1], color, delay: i * stagger });
    }
    setPulses((prev) => [...prev.slice(-60), ...created]);
    const ttl = (path.length * stagger + 1) * 1000;
    setTimeout(() => setPulses((prev) => prev.filter((p) => !created.includes(p))), ttl);
  };
  const burst = (at: NodeId, color: string, delay = 0) => {
    setTimeout(() => {
      const b = { id: nextId.current++, at, color };
      setBursts((prev) => [...prev, b]);
      setTimeout(() => setBursts((prev) => prev.filter((x) => x !== b)), 900);
    }, delay * 1000);
  };

  useLiveEvent(["reading", "rejection", "batch_closed", "batch_settled", "payout", "investment"], (e) => {
    const d = e.data as Record<string, unknown>;
    if (e.event === "reading") {
      setCounts((c) => ({ ...c, readings: c.readings + 1 }));
      // Six readings arrive per second; animate a sample so the diagram stays readable
      const now = Date.now();
      if (now - lastReading.current < 280) return;
      lastReading.current = now;
      const suspicious = Number(d.fraud_prob) > 0.5;
      flow(["sensors", "mqtt", "kafka", "ai"], suspicious ? "#f43f5e" : "#f5a524");
      if (suspicious) burst("ai", "#f43f5e", 1.4);
    } else if (e.event === "rejection") {
      setCounts((c) => ({ ...c, rejected: c.rejected + 1 }));
      flow(["sensors", "mqtt"], "#f43f5e");
      burst("mqtt", "#f43f5e", 0.5);
    } else if (e.event === "batch_closed") {
      setCounts((c) => ({ ...c, batches: c.batches + 1, flagged: c.flagged + (d.flagged ? 1 : 0) }));
      flow(["ai", "chain"], d.flagged ? "#f43f5e" : "#a78bfa");
    } else if (e.event === "batch_settled" && d.revenue_usdc != null) {
      const escrow = d.status === "escrowed";
      setCounts((c) => ({ ...c, anchored: c.anchored + 1, escrowed: c.escrowed + (escrow ? 1 : 0) }));
      if (escrow) burst("chain", "#f43f5e");
      else if (Number(d.revenue_usdc) > 0) flow(["chain", "payment"], "#38bdf8");
    } else if (e.event === "payout") {
      setCounts((c) => ({ ...c, payouts: c.payouts + 1 }));
      flow(["payment", "dashboard"], "#34d399");
    } else if (e.event === "investment") {
      setCounts((c) => ({ ...c, investments: c.investments + 1 }));
      flow(["dashboard", "payment", "chain"], "#34d399", 0.35);
    }
  });

  const layers: Layer[] = ["physical", "data", "intelligence", "blockchain", "financial", "user"];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">{t("arch.title")}</h1>
        <p className="mt-2 max-w-3xl text-muted">{t("arch.subtitle")}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
        <Card className="p-3">
          <svg viewBox={`0 0 ${W} 760`} className="h-auto w-full">
            {/* Layer brackets */}
            {layers.map((layer) => {
              const ys = LAYER_NODES[layer].map((n) => NODES[n].y);
              const top = Math.min(...ys) - 22, bottom = Math.max(...ys) + NODE_H - 36;
              const active = selected === layer;
              return (
                <g key={layer} onClick={() => setSelected(layer)} className="cursor-pointer">
                  <rect x={8} y={top - 6} width={W - 16} height={bottom - top + 12} rx={14}
                    fill={active ? "rgb(19 28 49 / 0.9)" : "transparent"} stroke={active ? "#2a3a5c" : "transparent"} />
                  <text x={28} y={(top + bottom) / 2 + 4} className={clsx("text-[13px]", active ? "fill-text" : "fill-muted")}>
                    [{t(`arch.layer.${layer}`)}]
                  </text>
                </g>
              );
            })}

            {/* Edges */}
            {ORDER.slice(0, -1).map((id, i) => {
              const a = NODES[id], b = NODES[ORDER[i + 1]];
              const y1 = a.y + NODE_H / 2, y2 = b.y - NODE_H / 2;
              return (
                <g key={id}>
                  <line x1={X} x2={X} y1={y1} y2={y2} stroke="#2a3a5c" strokeWidth={2} />
                  <path d={`M${X - 5},${y2 - 7} L${X},${y2} L${X + 5},${y2 - 7}`} fill="none" stroke="#2a3a5c" strokeWidth={2} />
                  {EDGE_LABEL[id] && (
                    <text x={X + 12} y={(y1 + y2) / 2 + 4} className="fill-faint text-[11px]">{t(EDGE_LABEL[id] as never)}</text>
                  )}
                </g>
              );
            })}

            {/* Nodes */}
            {ORDER.map((id) => {
              const n = NODES[id];
              const Icon = n.icon;
              return (
                <g key={id} onClick={() => setSelected(n.layer)} className="cursor-pointer">
                  <rect x={X - NODE_W / 2} y={n.y - NODE_H / 2} width={NODE_W} height={NODE_H} rx={12}
                    fill="#0d1424" stroke={n.color} strokeWidth={selected === n.layer ? 2.5 : 1.5} />
                  <foreignObject x={X - NODE_W / 2 + 12} y={n.y - 14} width={28} height={28}>
                    <Icon style={{ color: n.color, width: 22, height: 22 }} />
                  </foreignObject>
                  <text x={X - NODE_W / 2 + 46} y={n.y - 3} className="fill-text text-[14px] font-semibold">{t(`arch.node.${id}`)}</text>
                  <text x={X - NODE_W / 2 + 46} y={n.y + 15} className="fill-faint text-[11px]">{n.sub}</text>
                </g>
              );
            })}

            {/* Data pulses */}
            {pulses.map((p) => {
              const y1 = NODES[p.from].y + (NODES[p.to].y > NODES[p.from].y ? NODE_H / 2 : -NODE_H / 2);
              const y2 = NODES[p.to].y + (NODES[p.to].y > NODES[p.from].y ? -NODE_H / 2 : NODE_H / 2);
              return (
                <motion.circle key={p.id} cx={X} r={5} fill={p.color}
                  style={{ filter: `drop-shadow(0 0 6px ${p.color})` }}
                  initial={{ cy: y1, opacity: 0 }} animate={{ cy: y2, opacity: [0, 1, 1, 0] }}
                  transition={{ duration: 0.45, delay: p.delay, ease: "easeInOut" }} />
              );
            })}
            <AnimatePresence>
              {bursts.map((b) => (
                <motion.circle key={b.id} cx={X + NODE_W / 2 - 16} cy={NODES[b.at].y} fill="none" stroke={b.color} strokeWidth={2}
                  initial={{ r: 4, opacity: 1 }} animate={{ r: 26, opacity: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.8 }} />
              ))}
            </AnimatePresence>
          </svg>
          <p className="px-3 pb-2 text-center text-xs text-faint">{t("arch.clickHint")}</p>
        </Card>

        <LayerDetail layer={selected} counts={counts} lang={lang} />
      </div>
    </div>
  );
}

type Counts = { readings: number; rejected: number; batches: number; flagged: number; anchored: number; escrowed: number; payouts: number; investments: number };

const DETAILS: Record<Layer, { impl: "sim" | "real" | "local" | "sandbox"; tech: [string, string][]; text: [string, string] }> = {
  physical: {
    impl: "sim",
    tech: [["Fizik modelleri", "Physics models"], ["Ed25519 cihaz anahtarları", "Ed25519 device keys"], ["Arıza enjeksiyonu", "Fault injection"]],
    text: [
      "6 akıllı sayaç (4 güneş, 2 rüzgar), güneş açısı + bulut ve rüzgar + türbin güç eğrisi modelleriyle üretim üretir. Her mesaj cihazın kendi özel anahtarıyla imzalanır.",
      "6 smart meters (4 solar, 2 wind) generate output from sun-angle + cloud and wind + turbine power-curve models. Every message is signed with the device's own private key.",
    ],
  },
  data: {
    impl: "real",
    tech: [["MQTT (Mosquitto)", "MQTT (Mosquitto)"], ["İmza doğrulayan köprü (AWS IoT Core rolü)", "Signature-verifying bridge (AWS IoT Core role)"], ["Kafka API (Redpanda)", "Kafka API (Redpanda)"]],
    text: [
      "Köprü her mesajın imzasını ve tekrar (replay) korumasını kontrol eder. Geçerli okumalar telemetry.verified, saldırılar telemetry.rejected Kafka konusuna gider.",
      "The bridge checks every message's signature and replay protection. Valid readings go to the telemetry.verified Kafka topic, attacks to telemetry.rejected.",
    ],
  },
  intelligence: {
    impl: "real",
    tech: [["XGBoost: 4 sınıflı anomali", "XGBoost: 4-class anomaly"], ["LSTM: 24 saatlik tahmin", "LSTM: 24h forecast"], ["SHAP açıklamaları", "SHAP explanations"], ["E/S/G skor motoru", "E/S/G scoring engine"]],
    text: [
      "Her okuma fizik tabanlı özelliklerle puanlanır; her simülasyon saatinde bir parti kapanır ve yapay zeka kararı (normal / şişirme / donma / düşüş) açıklamasıyla birlikte verilir.",
      "Every reading is scored with physics-informed features; each simulated hour closes a batch and the AI verdict (normal / inflate / flatline / degrade) is issued with its explanation.",
    ],
  },
  blockchain: {
    impl: "local",
    tech: [["ERC-1155 AssetToken (KYC)", "ERC-1155 AssetToken (KYC)"], ["EnergyOracle", "EnergyOracle"], ["RevenueDistributor + emanet", "RevenueDistributor + escrow"], ["2/3 MultiSig", "2-of-3 MultiSig"]],
    text: [
      "Parti özeti, enerji ve YZ kararı EnergyOracle'a yazılır. Şebeke alıcısı kWh × 0,05 $ öder; işaretli partilerin geliri çoklu imza kararına kadar emanette kalır.",
      "Batch hash, energy and AI verdict are written to the EnergyOracle. The grid buyer pays kWh × $0.05; revenue from flagged batches stays in escrow until the multisig decides.",
    ],
  },
  financial: {
    impl: "sandbox",
    tech: [["USDC (test token, 6 ondalık)", "USDC (test token, 6 decimals)"], ["Otomatik ödeme (keeper)", "Auto-payout keeper"], ["Açık Bankacılık (PSD2 sandbox)", "Open Banking (PSD2 sandbox)"]],
    text: [
      "Birikimli pay başına gelir (accumulator) modeli ile ödeme maliyeti yatırımcı sayısından bağımsızdır. Keeper her döngüde USDC'yi doğrudan cüzdanlara iter.",
      "A revenue-per-share accumulator keeps payout cost independent of investor count. The keeper pushes USDC straight into wallets every cycle.",
    ],
  },
  user: {
    impl: "real",
    tech: [["Next.js + TypeScript", "Next.js + TypeScript"], ["WebSocket canlı akış", "WebSocket live stream"], ["Emanetli cüzdan", "Custodial wallets"]],
    text: [
      "Yatırımcı paneli tüm olayları WebSocket ile anlık alır. Her işlem blok gezgininde doğrulanabilir.",
      "The investor dashboard receives every event instantly over WebSocket. Every action can be verified in the block explorer.",
    ],
  },
};

const IMPL_LABEL = {
  sim: ["Simülasyon", "Simulated", "solar"],
  real: ["Gerçek, çalışıyor", "Real, running", "wind"],
  local: ["Gerçek sözleşmeler · yerel zincir", "Real contracts · local chain", "chain"],
  sandbox: ["Test token + sandbox", "Test token + sandbox", "warn"],
} as const;

function LayerDetail({ layer, counts, lang }: { layer: Layer; counts: Counts; lang: "tr" | "en" }) {
  const { t, num } = usePrefs();
  const d = DETAILS[layer];
  const i = lang === "tr" ? 0 : 1;
  const impl = IMPL_LABEL[d.impl];
  const stats: Record<Layer, [string, number, string?][]> = {
    physical: [[lang === "tr" ? "İmzalı okuma" : "Signed readings", counts.readings]],
    data: [[lang === "tr" ? "Doğrulanan" : "Verified", counts.readings], [lang === "tr" ? "Reddedilen (sahte)" : "Rejected (forged)", counts.rejected, "text-alert"]],
    intelligence: [[lang === "tr" ? "Puanlanan okuma" : "Readings scored", counts.readings], [lang === "tr" ? "Kapanan parti" : "Batches closed", counts.batches], [lang === "tr" ? "İşaretlenen" : "Flagged", counts.flagged, "text-alert"]],
    blockchain: [[lang === "tr" ? "Zincire yazılan parti" : "Batches anchored", counts.anchored], [lang === "tr" ? "Emanete alınan" : "Escrowed", counts.escrowed, "text-alert"], [lang === "tr" ? "Yatırım işlemi" : "Investment txs", counts.investments]],
    financial: [[lang === "tr" ? "Otomatik ödeme" : "Auto-payouts", counts.payouts, "text-money"]],
    user: [[lang === "tr" ? "Canlı olay" : "Live events", counts.readings + counts.batches + counts.payouts]],
  };

  return (
    <Card className="h-fit lg:sticky lg:top-24">
      <div className="text-xs uppercase tracking-wider text-faint">{t(`arch.layer.${layer}`)}</div>
      <h2 className="mt-1 text-xl font-semibold">{LAYER_NODES[layer].map((n) => t(`arch.node.${n}`)).join(" + ")}</h2>
      <div className="mt-3"><Badge tone={impl[2]}>{t("arch.impl")}: {impl[i]}</Badge></div>
      <p className="mt-4 text-sm leading-relaxed text-muted">{d.text[i]}</p>

      <div className="mt-5 text-xs font-medium uppercase tracking-wider text-faint">{t("arch.tech")}</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {d.tech.map((x) => <Badge key={x[0]}>{x[i]}</Badge>)}
      </div>

      <div className="mt-5 text-xs font-medium uppercase tracking-wider text-faint">{t("arch.liveStats")}</div>
      <div className="mt-2 grid grid-cols-2 gap-3">
        {stats[layer].map(([label, value, tone]) => (
          <div key={label} className="rounded-xl bg-surface-2 p-3">
            <div className="text-xs text-faint">{label}</div>
            <motion.div key={value} initial={{ opacity: 0.4 }} animate={{ opacity: 1 }} className={clsx("num text-xl font-semibold", tone)}>
              {num(value)}
            </motion.div>
          </div>
        ))}
      </div>
      {layer === "data" && (
        <a href="http://localhost:8080/topics" target="_blank" rel="noreferrer"
          className="mt-5 inline-flex items-center gap-1.5 text-sm text-chain hover:underline">
          Kafka Console <ExternalLink className="size-3.5" />
        </a>
      )}
      <p className="mt-4 text-xs text-faint">{lang === "tr" ? "Sayaçlar bu sayfa açıldığından beri." : "Counters since this page was opened."}</p>
    </Card>
  );
}
