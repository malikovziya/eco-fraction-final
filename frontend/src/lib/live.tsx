"use client";

// One WebSocket for the whole app. Keeps the latest reading per asset and the simulator
// status, and lets components subscribe to individual event types.
import { createContext, useCallback, useContext, useEffect, useEffectEvent, useRef, useState } from "react";
import { WS_URL, api } from "./api";
import type { Asset, LiveReading, SimStatus } from "./types";

export type LiveEvent = { event: string; data: Record<string, unknown> };
type Listener = (e: LiveEvent) => void;

type Live = {
  connected: boolean;
  latest: Record<string, LiveReading>;
  sim: SimStatus | null;
  subscribe: (fn: Listener) => () => void;
};

const Ctx = createContext<Live | null>(null);

export function LiveProvider({ children }: { children: React.ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [latest, setLatest] = useState<Record<string, LiveReading>>({});
  const [sim, setSim] = useState<SimStatus | null>(null);
  const listeners = useRef(new Set<Listener>());

  useEffect(() => {
    // Seed with the current state so the UI is populated before the first event arrives
    api<Asset[]>("/assets")
      .then((assets) => {
        const seed: Record<string, LiveReading> = {};
        for (const a of assets) if (a.live) seed[a.id] = a.live;
        setLatest((prev) => ({ ...seed, ...prev }));
      })
      .catch(() => {});

    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout>;
    let closed = false;

    const connect = () => {
      ws = new WebSocket(WS_URL);
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 1500);
      };
      ws.onmessage = (m) => {
        const e = JSON.parse(m.data) as LiveEvent;
        if (e.event === "reading") {
          const r = e.data as unknown as LiveReading;
          setLatest((prev) => ({ ...prev, [r.asset_id]: r }));
        } else if (e.event === "sim") {
          setSim(e.data as unknown as SimStatus);
        }
        for (const fn of listeners.current) fn(e);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      ws?.close();
    };
  }, []);

  const subscribe = useCallback((fn: Listener) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  return <Ctx.Provider value={{ connected, latest, sim, subscribe }}>{children}</Ctx.Provider>;
}

export function useLive(): Live {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useLive outside LiveProvider");
  return ctx;
}

/** Run `handler` for every live event of the given types. */
export function useLiveEvent(types: string[], handler: (e: LiveEvent) => void) {
  const { subscribe } = useLive();
  const onEvent = useEffectEvent(handler);
  const key = types.join(",");
  useEffect(() => {
    const wanted = new Set(key.split(","));
    return subscribe((e) => {
      if (wanted.has(e.event)) onEvent(e);
    });
  }, [subscribe, key]);
}

/** Fetch JSON and re-fetch on an interval and/or when given live events arrive. */
export function useData<T>(path: string | null, opts?: { interval?: number; refreshOn?: string[] }) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const reload = () => setTick((n) => n + 1);

  useEffect(() => {
    if (!path) return;
    let alive = true;
    api<T>(path)
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => {
      alive = false;
    };
  }, [path, tick]);

  useEffect(() => {
    if (!opts?.interval) return;
    const id = setInterval(reload, opts.interval);
    return () => clearInterval(id);
  }, [opts?.interval]);

  const refreshKey = opts?.refreshOn ?? [];
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useLiveEvent(refreshKey.length ? refreshKey : ["__none__"], () => {
    // Coalesce bursts (six assets settle at once) into one refetch after the last event
    clearTimeout(debounce.current);
    debounce.current = setTimeout(reload, 400);
  });

  return { data, error, reload };
}
