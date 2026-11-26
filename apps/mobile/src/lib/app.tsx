import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { getLocales } from "expo-localization";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { t as translate, isRtl, type Category, type Locale, type MessageKey, type Profile, type Project, type WalletBalance } from "@kuttiapp/shared";
import { supabase, must } from "./supabase";
import { listDrafts, syncDrafts, type Draft } from "./drafts";

interface Cache {
  wallets: WalletBalance[];
  projects: Project[];
  categories: Category[];
  invoiceRequiredAbove: number;
  fetchedAt: string | null;
}

interface AppState {
  ready: boolean;
  session: Session | null;
  profile: Profile | null;
  online: boolean;
  locale: Locale;
  rtl: boolean;
  setLocale: (l: Locale) => void;
  t: (key: MessageKey, vars?: Record<string, string>) => string;
  data: Cache;
  drafts: Draft[];
  refresh: () => Promise<void>;
  refreshDrafts: () => Promise<void>;
  sync: () => Promise<{ sent: number; failed: number } | null>;
}

const CACHE_KEY = "kutti.cache.v1";
const LOCALE_KEY = "kutti.locale";
const emptyCache: Cache = { wallets: [], projects: [], categories: [], invoiceRequiredAbove: 100, fetchedAt: null };
const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [online, setOnline] = useState(true);
  const [locale, setLocaleState] = useState<Locale>(getLocales()[0]?.languageCode === "ar" ? "ar" : "en");
  const [data, setData] = useState<Cache>(emptyCache);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const syncing = useRef(false);

  // Boot: restore locale, cached lookups, drafts and session.
  useEffect(() => {
    (async () => {
      try {
        const [l, c] = await Promise.all([AsyncStorage.getItem(LOCALE_KEY), AsyncStorage.getItem(CACHE_KEY)]);
        if (l === "ar" || l === "en") setLocaleState(l);
        if (c) setData(JSON.parse(c));
      } catch {}
      setDrafts(await listDrafts());
      const { data: s } = await supabase.auth.getSession();
      setSession(s.session);
      setReady(true);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    const unsubNet = NetInfo.addEventListener((st) => setOnline(Boolean(st.isConnected && st.isInternetReachable !== false)));
    return () => {
      sub.subscription.unsubscribe();
      unsubNet();
    };
  }, []);

  const refreshDrafts = useCallback(async () => setDrafts(await listDrafts()), []);

  const refresh = useCallback(async () => {
    if (!session) return;
    const [p, w, pr, c, s] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", session.user.id).single(),
      supabase.from("wallet_balances").select("*").eq("custodian_id", session.user.id).eq("active", true).order("name"),
      supabase.from("projects").select("*").eq("active", true).order("code"),
      supabase.from("categories").select("*").eq("active", true).order("name"),
      supabase.from("settings").select("value").eq("key", "invoice_required_above").maybeSingle(),
    ]);
    const prof = must(p) as Profile;
    setProfile(prof);
    const next: Cache = {
      wallets: must(w) as WalletBalance[],
      projects: must(pr) as Project[],
      categories: must(c) as Category[],
      invoiceRequiredAbove: Number(s.data?.value ?? 100),
      fetchedAt: new Date().toISOString(),
    };
    setData(next);
    AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ ...next, profile: prof })).catch(() => {});
  }, [session]);

  const sync = useCallback(async () => {
    if (!session || syncing.current) return null;
    syncing.current = true;
    try {
      const r = await syncDrafts(session.user.id);
      await refreshDrafts();
      if (r.sent) await refresh().catch(() => {});
      return r;
    } finally {
      syncing.current = false;
    }
  }, [session, refresh, refreshDrafts]);

  // On sign-in: load profile (from cache first, so the app opens offline).
  useEffect(() => {
    if (!session) {
      setProfile(null);
      return;
    }
    AsyncStorage.getItem(CACHE_KEY)
      .then((c) => {
        const cached = c ? (JSON.parse(c) as { profile?: Profile }) : null;
        if (cached?.profile?.id === session.user.id) setProfile((p) => p ?? cached.profile!);
      })
      .catch(() => {});
    refresh().catch(() => {});
  }, [session, refresh]);

  // Coming back online: send queued drafts.
  useEffect(() => {
    if (online && session && drafts.length) sync().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, session]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    AsyncStorage.setItem(LOCALE_KEY, l).catch(() => {});
  }, []);

  const value = useMemo<AppState>(
    () => ({
      ready,
      session,
      profile,
      online,
      locale,
      rtl: isRtl(locale),
      setLocale,
      t: (key, vars) => translate(locale, key, vars),
      data,
      drafts,
      refresh,
      refreshDrafts,
      sync,
    }),
    [ready, session, profile, online, locale, setLocale, data, drafts, refresh, refreshDrafts, sync],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside AppProvider");
  return v;
}
