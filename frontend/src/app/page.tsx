"use client";

// Temporary system-status page (Part 1). Replaced by the real landing page in Part 5.
import { useEffect, useState } from "react";

type Health = {
  api: boolean;
  mqtt: boolean;
  kafka: boolean;
  chain: boolean;
  chainBlock: number | null;
};

const LABELS: [keyof Health, string][] = [
  ["api", "Backend API"],
  ["mqtt", "MQTT broker"],
  ["kafka", "Kafka stream"],
  ["chain", "Blockchain"],
];

export default function Home() {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    const load = () =>
      fetch("http://localhost:8100/api/health")
        .then((r) => r.json())
        .then(setHealth)
        .catch(() => setHealth(null));
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, []);

  return (
    <main className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-100 p-6">
      <div className="w-full max-w-md space-y-4">
        <h1 className="text-2xl font-semibold">Eco-Fraction · System Status</h1>
        <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800">
          {LABELS.map(([key, label]) => {
            const up = health ? Boolean(health[key]) : false;
            return (
              <li key={key} className="flex items-center justify-between px-4 py-3">
                <span>{label}</span>
                <span className={up ? "text-emerald-400" : "text-rose-400"}>
                  {up ? "● online" : "● offline"}
                </span>
              </li>
            );
          })}
        </ul>
        {health?.chainBlock != null && (
          <p className="text-sm text-zinc-400">Latest block: #{health.chainBlock}</p>
        )}
      </div>
    </main>
  );
}
