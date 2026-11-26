"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { t as translate, type MessageKey, type Profile, type Project, type Category, type Wallet } from "@expresscash/shared";
import { supabase, must } from "./supabase";

interface Lookups {
  profiles: Profile[];
  projects: Project[];
  categories: Category[];
  wallets: Wallet[];
  settings: Record<string, unknown>;
}

interface AppState {
  ready: boolean;
  session: Session | null;
  profile: Profile | null;
  t: (key: MessageKey, vars?: Record<string, string>) => string;
  lookups: Lookups;
  reloadLookups: () => Promise<void>;
  name: (map: "profiles" | "projects" | "categories" | "wallets", id: string | null | undefined) => string;
  setting: (key: string, fallback: number) => number;
}

const Ctx = createContext<AppState | null>(null);
const empty: Lookups = { profiles: [], projects: [], categories: [], wallets: [], settings: {} };

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [lookups, setLookups] = useState<Lookups>(empty);

  useEffect(() => {
    const sb = supabase();
    sb.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const reloadLookups = useCallback(async () => {
    const sb = supabase();
    const [profiles, projects, categories, wallets, settings] = await Promise.all([
      sb.from("profiles").select("*").order("full_name"),
      sb.from("projects").select("*").order("name"),
      sb.from("categories").select("*").order("name"),
      sb.from("wallets").select("*").order("name"),
      sb.from("settings").select("key, value"),
    ]);
    const next: Lookups = {
      profiles: must(profiles) as Profile[],
      projects: must(projects) as Project[],
      categories: must(categories) as Category[],
      wallets: must(wallets) as Wallet[],
      settings: Object.fromEntries((must(settings) as Array<{ key: string; value: unknown }>).map((r) => [r.key, r.value])),
    };
    setLookups(next);
    try {
      localStorage.setItem("xc.lookups", JSON.stringify(next)); // used by the phone app when offline
    } catch {}
  }, []);

  useEffect(() => {
    if (!session) {
      setProfile(null);
      setLookups(empty);
      return;
    }
    try {
      const cached = localStorage.getItem("xc.lookups");
      if (cached) setLookups(JSON.parse(cached));
      const p = localStorage.getItem("xc.profile");
      if (p && JSON.parse(p).id === session.user.id) setProfile(JSON.parse(p));
    } catch {}
    supabase()
      .from("profiles")
      .select("*")
      .eq("id", session.user.id)
      .single()
      .then(({ data }) => {
        if (!data) return;
        setProfile(data as Profile);
        try {
          localStorage.setItem("xc.profile", JSON.stringify(data));
        } catch {}
      });
    reloadLookups().catch(console.error);
  }, [session, reloadLookups]);

  const value = useMemo<AppState>(() => {
    const maps = {
      profiles: new Map(lookups.profiles.map((p) => [p.id, p.full_name || p.email || "?"])),
      projects: new Map(lookups.projects.map((p) => [p.id, p.name])),
      categories: new Map(lookups.categories.map((c) => [c.id, c.name])),
      wallets: new Map(lookups.wallets.map((w) => [w.id, w.name])),
    };
    return {
      ready,
      session,
      profile,
      t: (key, vars) => translate(key, vars),
      lookups,
      reloadLookups,
      name: (map, id) => (id ? maps[map].get(id) ?? "—" : "—"),
      setting: (key, fallback) => {
        const v = Number(lookups.settings[key]);
        return Number.isFinite(v) ? v : fallback;
      },
    };
  }, [ready, session, profile, lookups, reloadLookups]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside AppProvider");
  return v;
}
