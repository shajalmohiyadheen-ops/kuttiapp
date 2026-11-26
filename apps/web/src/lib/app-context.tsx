"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { t as translate, isRtl, type Locale, type MessageKey, type Profile, type Project, type Category, type Wallet } from "@kuttiapp/shared";
import { supabase, must } from "./supabase";

interface Lookups {
  profiles: Profile[];
  projects: Project[];
  categories: Category[];
  wallets: Wallet[];
}

interface AppState {
  ready: boolean;
  session: Session | null;
  profile: Profile | null;
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: MessageKey, vars?: Record<string, string>) => string;
  lookups: Lookups;
  reloadLookups: () => Promise<void>;
  name: (map: "profiles" | "projects" | "categories" | "wallets", id: string | null | undefined) => string;
}

const Ctx = createContext<AppState | null>(null);
const empty: Lookups = { profiles: [], projects: [], categories: [], wallets: [] };

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [locale, setLocaleState] = useState<Locale>("en");
  const [lookups, setLookups] = useState<Lookups>(empty);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("kutti.locale");
      if (saved === "ar" || saved === "en") setLocaleState(saved);
    } catch {}
    const sb = supabase();
    sb.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = isRtl(locale) ? "rtl" : "ltr";
  }, [locale]);

  const reloadLookups = useCallback(async () => {
    const sb = supabase();
    const [profiles, projects, categories, wallets] = await Promise.all([
      sb.from("profiles").select("*").order("full_name"),
      sb.from("projects").select("*").order("code"),
      sb.from("categories").select("*").order("name"),
      sb.from("wallets").select("*").order("name"),
    ]);
    setLookups({
      profiles: must(profiles) as Profile[],
      projects: must(projects) as Project[],
      categories: must(categories) as Category[],
      wallets: must(wallets) as Wallet[],
    });
  }, []);

  useEffect(() => {
    if (!session) {
      setProfile(null);
      setLookups(empty);
      return;
    }
    supabase()
      .from("profiles")
      .select("*")
      .eq("id", session.user.id)
      .single()
      .then(({ data }) => {
        setProfile(data as Profile);
        if (data?.locale === "ar" || data?.locale === "en") {
          try {
            if (!localStorage.getItem("kutti.locale")) setLocaleState(data.locale);
          } catch {}
        }
      });
    reloadLookups().catch(console.error);
  }, [session, reloadLookups]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem("kutti.locale", l);
    } catch {}
  }, []);

  const value = useMemo<AppState>(() => {
    const maps = {
      profiles: new Map(lookups.profiles.map((p) => [p.id, p.full_name || p.email || "?"])),
      projects: new Map(lookups.projects.map((p) => [p.id, `${p.code} ${locale === "ar" && p.name_ar ? p.name_ar : p.name}`])),
      categories: new Map(lookups.categories.map((c) => [c.id, locale === "ar" && c.name_ar ? c.name_ar : c.name])),
      wallets: new Map(lookups.wallets.map((w) => [w.id, w.name])),
    };
    return {
      ready,
      session,
      profile,
      locale,
      setLocale,
      t: (key, vars) => translate(locale, key, vars),
      lookups,
      reloadLookups,
      name: (map, id) => (id ? maps[map].get(id) ?? "—" : "—"),
    };
  }, [ready, session, profile, locale, setLocale, lookups, reloadLookups]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside AppProvider");
  return v;
}
