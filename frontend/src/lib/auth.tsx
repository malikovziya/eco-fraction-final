"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, getToken, setToken } from "./api";
import type { User } from "./types";

type Auth = {
  user: User | null;
  ready: boolean;
  loginPersona: (persona: string) => Promise<User>;
  login: (email: string, password: string) => Promise<User>;
  signup: (name: string, email: string, password: string) => Promise<User>;
  logout: () => void;
  refresh: () => Promise<void>;
};

const Ctx = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      return;
    }
    try {
      setUser(await api<User>("/me"));
    } catch {
      setToken(null); // session belongs to a previous deployment
      setUser(null);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    const token = getToken();
    const load = token
      ? api<User>("/me").then((u) => alive && setUser(u)).catch(() => setToken(null)) // token from an old deployment
      : Promise.resolve();
    load.finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);

  const start = useCallback(async (path: string, json: unknown) => {
    const res = await api<{ token: string; user: User }>(path, { method: "POST", json });
    setToken(res.token);
    setUser(res.user);
    return res.user;
  }, []);

  const value: Auth = {
    user,
    ready,
    loginPersona: (persona) => start("/auth/persona", { persona }),
    login: (email, password) => start("/auth/login", { email, password }),
    signup: (name, email, password) => start("/auth/signup", { name, email, password }),
    logout: () => {
      setToken(null);
      setUser(null);
    },
    refresh,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): Auth {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
