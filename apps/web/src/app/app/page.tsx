"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Expense, Topup, WalletBalance } from "@expresscash/shared";
import { useApp } from "@/lib/app-context";
import { supabase, must } from "@/lib/supabase";
import { listDrafts, syncDrafts, type Draft } from "@/lib/drafts";
import { Money, ThemeToggle, Wordmark, useLive } from "@/components/ui";

interface HomeData {
  wallet: WalletBalance | null;
  expenses: Expense[];
  topups: Topup[];
  at: string;
}

const CACHE = "xc.home.v1";

export default function PhoneHome() {
  const { t, profile, name } = useApp();
  const router = useRouter();
  const [data, setData] = useState<HomeData | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [online, setOnline] = useState(true);
  const [menu, setMenu] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");

  const load = useCallback(async () => {
    if (!profile) return;
    setDrafts(await listDrafts());
    try {
      const sb = supabase();
      const [w, e, tp] = await Promise.all([
        sb.from("wallet_balances").select("*").eq("custodian_id", profile.id).eq("active", true).maybeSingle(),
        sb.from("expenses").select("*").eq("submitted_by", profile.id).order("created_at", { ascending: false }).limit(30),
        sb.from("topups").select("*").order("transfer_date", { ascending: false }).limit(10),
      ]);
      const wallet = (must(w) as WalletBalance | null) ?? null;
      const next: HomeData = {
        wallet,
        expenses: must(e) as Expense[],
        topups: wallet ? (must(tp) as Topup[]).filter((x) => x.wallet_id === wallet.wallet_id) : [],
        at: new Date().toISOString(),
      };
      setData(next);
      try {
        localStorage.setItem(CACHE, JSON.stringify(next));
      } catch {}
    } catch {
      try {
        const c = localStorage.getItem(CACHE);
        if (c) setData(JSON.parse(c));
      } catch {}
    }
  }, [profile]);

  const sync = useCallback(async () => {
    if (!profile || !navigator.onLine) return;
    const waiting = await listDrafts();
    if (!waiting.length) return;
    const r = await syncDrafts(profile.id);
    if (r.sent) setSyncMsg(`${r.sent} sent ✓`);
    load();
  }, [profile, load]);

  useEffect(() => {
    load();
    sync();
    const on = () => (setOnline(true), sync());
    const off = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [load, sync]);
  useLive(load);

  const w = data?.wallet;
  const queued = drafts.reduce((a, d) => a + Math.round(Number(d.amount) * 100), 0) / 100;
  const feed = [
    ...(data?.expenses ?? []).map((e) => ({ kind: "out" as const, id: e.id, at: e.created_at, e })),
    ...(data?.topups ?? []).filter((x) => x.status === "posted").map((x) => ({ kind: "in" as const, id: x.id, at: x.created_at, x })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const shown = w ? (Math.round(Number(w.available_balance) * 100) / 100 - queued).toFixed(2) : "0";

  return (
    <div className="phone">
      <header>
        <Wordmark />
        <button className="linkbtn" aria-label="Menu" onClick={() => setMenu(!menu)} style={{ fontSize: 26 }}>☰</button>
      </header>

      {menu && (
        <div className="card" style={{ display: "grid", gap: 10 }}>
          <div className="muted small">{profile?.full_name || profile?.email}</div>
          <ThemeToggle />
          <Link href="/app/install" className="btn" style={{ textAlign: "center" }}>📲 {t("installApp")}</Link>
          {profile && profile.role !== "custodian" && <Link href="/">← Admin screens</Link>}
          <button className="btn" onClick={() => supabase().auth.signOut()}>{t("signOut")}</button>
        </div>
      )}

      {!online && <div className="banner">📴 {t("offline")}. You can still add expenses; they&apos;ll be sent when you&apos;re back online.</div>}
      {syncMsg && <div className="banner" onClick={() => setSyncMsg("")}>{syncMsg}</div>}

      {data && !w ? (
        <div className="card">No wallet is assigned to you yet. Ask your admin.</div>
      ) : (
        <div className="card hero">
          <div className="muted">{w ? `${w.name}${w.card_last4 ? ` · 💳 •••• ${w.card_last4}` : ""}` : "…"}</div>
          <div className="balance">{w ? <Money value={shown} /> : "…"}</div>
          <div className="muted small">{t("availableBalance")} (card + cash in hand)</div>
          {w && Number(shown) < 0 && (
            <div className="hint-pending">⏳ Below zero: a transfer is probably still to be recorded. Keep adding expenses as normal.</div>
          )}
          {w && (
            <div className="split">
              <div>
                {t("moneyIn")}
                <b className="money-in">+{Number(w.topups_total).toLocaleString("en", { minimumFractionDigits: 2 })}</b>
              </div>
              <div>
                💳 {t("card")}
                <b className="money-out">−{Number(w.spent_card).toLocaleString("en", { minimumFractionDigits: 2 })}</b>
              </div>
              <div>
                💵 {t("cash")}
                <b className="money-out">−{Number(w.spent_cash).toLocaleString("en", { minimumFractionDigits: 2 })}</b>
              </div>
            </div>
          )}
        </div>
      )}

      <button className="bigbtn" disabled={data !== null && !w} onClick={() => router.push("/app/add")}>📷 {t("addExpense")}</button>

      {drafts.length > 0 && (
        <div className="card" style={{ display: "grid", gap: 8 }}>
          <div className="row">
            <strong>📤 {t("drafts")}: {drafts.length}</strong>
            <button disabled={!online} onClick={sync}>Send now</button>
          </div>
          {drafts.map((d) => (
            <div key={d.client_id}>
              <div className="row">
                <span>{name("projects", d.project_id)}</span>
                <Money value={d.amount} direction="out" />
              </div>
              {d.last_error && <div className="small" style={{ color: "var(--danger)" }}>{d.last_error}</div>}
            </div>
          ))}
        </div>
      )}

      <h2 style={{ margin: "6px 0 0" }}>{t("recent")}</h2>
      <div className="list">
        {feed.length === 0 && <div className="muted">{t("noData")}</div>}
        {feed.map((f) =>
          f.kind === "in" ? (
            <div key={f.id} className="item">
              <div>
                ⬇ {t("transfer")}
                <div className="sub">{f.x.transfer_date}{f.x.reference ? ` · ${f.x.reference}` : ""}</div>
              </div>
              <Money value={f.x.amount} direction="in" />
            </div>
          ) : (
            <button key={f.id} className="item" onClick={() => router.push(`/app/expense?id=${f.e.id}`)} style={f.e.status === "reversed" ? { opacity: 0.5, textDecoration: "line-through" } : undefined}>
              <div>
                {f.e.paid_by === "card" ? "💳" : "💵"} {name("projects", f.e.project_id)}
                <div className="sub">
                  {f.e.expense_date} · {name("categories", f.e.category_id)}
                  {f.e.checked_by ? " · ✓ checked" : ""}
                </div>
              </div>
              <Money value={f.e.amount} direction="out" />
            </button>
          ),
        )}
      </div>
      {data?.at && !online && <p className="muted small">Last updated {new Date(data.at).toLocaleString("en-GB")}</p>}
    </div>
  );
}
