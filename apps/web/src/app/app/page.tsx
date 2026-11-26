"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatSar, type CashHeld, type CashMove, type Expense, type Topup, type WalletBalance } from "@expresscash/shared";
import { useApp } from "@/lib/app-context";
import { supabase, must } from "@/lib/supabase";
import { listDrafts, syncDrafts, type Draft } from "@/lib/drafts";
import { Money, ThemeToggle, Wordmark, useLive } from "@/components/ui";
import { Bell, flagItems, useFlags } from "@/components/bell";

interface HomeData {
  wallet: WalletBalance | null;
  expenses: Expense[];
  topups: Topup[];
  cash: CashMove[];
  held: CashHeld | null;
  at: string;
}

const CACHE = "xc.home.v2";

const CASH_LABEL = { withdrawal: "🏧 Cash withdrawal", deposit: "↩ Cash put back on card", handover: "↩ Cash handed to office" } as const;

export default function PhoneHome() {
  const { t, profile, name } = useApp();
  const router = useRouter();
  const [data, setData] = useState<HomeData | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [online, setOnline] = useState(true);
  const [menu, setMenu] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const flags = useFlags();

  const load = useCallback(async () => {
    if (!profile) return;
    setDrafts(await listDrafts());
    try {
      const sb = supabase();
      const [w, e, tp, cm, h] = await Promise.all([
        sb.from("wallet_balances").select("*").eq("custodian_id", profile.id).eq("active", true).maybeSingle(),
        sb.from("expenses").select("*").eq("submitted_by", profile.id).order("created_at", { ascending: false }).limit(30),
        sb.from("topups").select("*").order("transfer_date", { ascending: false }).limit(10),
        sb.from("cash_moves").select("*").order("created_at", { ascending: false }).limit(15),
        sb.rpc("cash_held"),
      ]);
      const wallet = (must(w) as WalletBalance | null) ?? null;
      const mine = <T extends { wallet_id: string }>(xs: T[]) => (wallet ? xs.filter((x) => x.wallet_id === wallet.wallet_id) : []);
      const next: HomeData = {
        wallet,
        expenses: must(e) as Expense[],
        topups: mine(must(tp) as Topup[]),
        cash: mine(must(cm) as CashMove[]),
        held: mine((must(h) as CashHeld[]) ?? [])[0] ?? null,
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
  // drafts not sent yet still come off the right pocket
  const queued = (by: "card" | "cash") => drafts.filter((d) => d.paid_by === by).reduce((a, d) => a + Math.round(Number(d.amount) * 100), 0);
  const cents = (v: unknown) => Math.round(Number(v ?? 0) * 100);
  const onCard = w ? (cents(w.card_balance) - queued("card")) / 100 : 0;
  const inHand = w ? (cents(w.cash_in_hand) - queued("cash")) / 100 : 0;
  const shown = (Math.round(onCard * 100) + Math.round(inHand * 100)) / 100;
  const tooLong = Number(data?.held?.held_too_long ?? 0);

  const feed = [
    ...(data?.expenses ?? []).map((e) => ({ kind: "out" as const, id: e.id, at: e.created_at, e })),
    ...(data?.topups ?? []).filter((x) => x.status === "posted").map((x) => ({ kind: "in" as const, id: x.id, at: x.created_at, x })),
    ...(data?.cash ?? []).map((c) => ({ kind: "cash" as const, id: c.id, at: c.created_at, c })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className="phone">
      <header>
        <Wordmark />
        <div className="head-right">
          <Bell items={flagItems(flags, true)} empty="All good. Nothing needs your attention." />
          <button className="linkbtn" aria-label="Menu" onClick={() => setMenu(!menu)} style={{ fontSize: 26 }}>☰</button>
        </div>
      </header>

      {menu && (
        <div className="card" style={{ display: "grid", gap: 10 }}>
          <div className="muted small">{profile?.full_name || profile?.email}</div>
          <ThemeToggle />
          <Link href="/app/install" className="btn" style={{ textAlign: "center" }}>📲 {t("installApp")}</Link>
          <ChangePassword />
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
          <div className="muted">{w ? `${w.name}${w.card_last4 ? ` · •••• ${w.card_last4}` : ""}` : "…"}</div>
          <div className="pockets">
            <div>
              <span>💳 {t("onCard")}</span>
              <b className={onCard < 0 ? "money-out" : undefined}>{w ? formatSar(onCard) : "…"}</b>
            </div>
            <div>
              <span>💵 {t("cashInHand")}</span>
              <b className={tooLong > 0 ? "warn-text" : undefined}>{w ? formatSar(inHand) : "…"}</b>
            </div>
          </div>
          <div className="pocket-total">
            <span>{t("availableBalance")}</span>
            <b className={shown < 0 ? "money-out" : undefined}>{w ? formatSar(shown) : "…"}</b>
          </div>
        </div>
      )}

      <button className="bigbtn" disabled={data !== null && !w} onClick={() => router.push("/app/add")}>📷 {t("addExpense")}</button>
      <div className="twin">
        <button className="btn" disabled={data !== null && !w} onClick={() => router.push("/app/cash?kind=withdrawal")}>🏧 {t("cashWithdrawal")}</button>
        <button className="btn" disabled={!w || inHand <= 0} onClick={() => router.push("/app/cash?kind=return")}>↩ {t("returnCash")}</button>
      </div>

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
          f.kind === "cash" ? (
            <div key={f.id} className="item" style={f.c.status === "reversed" ? { opacity: 0.5, textDecoration: "line-through" } : undefined}>
              <div>
                {CASH_LABEL[f.c.kind]}
                <div className="sub">{f.c.move_date}{f.c.notes ? ` · ${f.c.notes}` : ""}</div>
              </div>
              <Money value={f.c.amount} direction={f.c.kind === "handover" ? "out" : undefined} />
            </div>
          ) : f.kind === "in" ? (
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

function ChangePassword() {
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState("");
  if (!open) return <button className="btn" onClick={() => setOpen(true)}>🔑 Change password</button>;
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <input type="password" autoComplete="new-password" placeholder="New password (8 or more characters)" value={pw} onChange={(e) => setPw(e.target.value)} />
      <button
        className="btn"
        disabled={pw.length < 8}
        onClick={async () => {
          const { error } = await supabase().auth.updateUser({ password: pw });
          setMsg(error ? error.message : "Password changed ✓");
          if (!error) setPw("");
        }}
      >
        Save new password
      </button>
      {msg && <div className="small">{msg}</div>}
    </div>
  );
}
