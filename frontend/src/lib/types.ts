export type Kind = "solar" | "wind";

export type LiveReading = {
  asset_id: string;
  ts: string;
  power_kw: number;
  energy_kwh: number;
  capacity_kw: number;
  fraud_prob: number;
  degrade_prob: number;
  predicted: "normal" | "inflate" | "flatline" | "degrade";
  irradiance_wm2?: number | null;
  wind_speed_ms?: number | null;
  temperature_c?: number | null;
  seq: number;
  device_id: string;
};

export type Asset = {
  id: string;
  tokenId: number;
  name: string;
  kind: Kind;
  region: string;
  lat: number;
  lon: number;
  capacity_kw: number;
  turbines: number;
  social: { jobs: number; local_hiring_pct: number; community: string; community_tr?: string };
  valueUsd: number;
  totalShares: number;
  offeredShares: number;
  remainingShares: number;
  soldShares: number;
  pricePerShare: number;
  expectedYield: number;
  annualRevenueUsd: number;
  investors: number;
  live: LiveReading | null;
  activeAlerts: string[];
  esg: { score: number; rating: string };
};

export type Explanation = { feature: string; label: string; value: number; contribution: number };

export type BatchT = {
  id: number;
  asset_id: string;
  period_start: string;
  period_end: string;
  readings: number;
  energy_kwh: number;
  data_hash: string;
  anomaly_score: number;
  suspicious_readings: number;
  flagged: boolean;
  verdict: "normal" | "inflate" | "flatline" | "degrade";
  explanation: Explanation[];
  status: "pending" | "distributed" | "escrowed" | "released" | "refunded" | "failed";
  chain_batch_id: number | null;
  revenue_usdc: number | null;
  tx_record: string | null;
  tx_settle: string | null;
  tx_payout: string | null;
};

export type User = {
  id: number;
  name: string;
  email: string;
  role: "investor" | "producer" | "signer";
  persona: string | null;
  title: string | null;
  wallet: string;
  kyc: "none" | "pending" | "verified";
};

export type Holding = {
  asset_id: string;
  name: string;
  kind: Kind;
  shares: number;
  ownership: number;
  value_usdc: number;
  earned_usdc: number;
  claimable_usdc: number;
  projected_annual_income_usdc: number;
  co2_avoided_annual_kg: number;
  esg: { score: number; rating: string };
};

export type Portfolio = {
  user: User;
  usdc_balance: number;
  holdings: Holding[];
  invested_value_usdc: number;
  total_earned_usdc: number;
  projected_annual_income_usdc: number;
  portfolio_esg: number | null;
  earning_rate_per_sim_hour: number;
};

export type ActivityT = {
  id: number;
  kind: "deposit" | "buy" | "payout" | "kyc" | "sell" | "trade_buy" | "withdraw";
  asset_id: string | null;
  shares: number | null;
  amount_usdc: number | null;
  tx_hash: string | null;
  detail: Record<string, unknown>;
  created_at: string;
};

export type AlertT = {
  id: number;
  asset_id: string;
  kind: "fraud" | "maintenance" | "security";
  severity: string;
  title: string;
  detail: string;
  batch_id: number | null;
  active: boolean;
  created_at: string;
};

export type SimStatus = { sim_time: string; speed: number; faults: Record<string, string[]>; assets: string[] };

export type PlatformStats = {
  revenue_distributed_usdc: number;
  revenue_escrowed_usdc: number;
  treasury_fees_usdc: number;
  investors: number;
  energy_mwh: number;
  verified: number;
  rejected: number;
  batches: number;
  flagged: number;
};
