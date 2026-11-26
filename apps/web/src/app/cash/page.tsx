"use client";

import { useState } from "react";
import { type CashHeld, type CashMove } from "@expresscash/shared";
import { useApp } from "@/lib/app-context";
import { supabase, must } from "@/lib/supabase";
import { RequireRole } from "@/components/shell";
import { ErrorText, Field, Money, MonthSelect, StatusBadge, monthStart, useAction, useLive, useLoad } from "@/components/ui";

export default function CashPage() {
  return (
    <RequireRole roles={["admin", "accounts"]}>
      <Cash />
    </RequireRole>
  );
}

const KIND = { withdrawal: "🏧 Withdrawn from card", deposit: "💳 Put back on card", handover: "🏢 Handed to office" } as const;

/** Riyadh calendar date of a timestamp, to compare the entry day with the withdrawal day. */
const riyadhDay = (ts: string) => new Date(ts).toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
const daysBetween = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);

function Cash() {
  const { lookups, name, profile, setting } = useApp();
  const [month, setMonth] = useState(monthStart());
  const [walletId, setWalletId] = useState("");
  const holdDays = setting("cash_hold_days", 4);

  const list = useLoad(async () => {
    let q = supabase().from("cash_moves").select("*").order("move_date", { ascending: false }).order("created_at", { ascending: false });
    if (month) q = q.eq("period_month", month);
    if (walletId) q = q.eq("wallet_id", walletId);
    return must(await q) as CashMove[];
  }, [month, walletId]);
  const held = useLoad(async () => must(await supabase().rpc("cash_held")) as CashHeld[], []);
  useLive(() => (list.reload(), held.reload()));
  const rows = list.data ?? [];
  const hands = (held.data ?? []).filter((h) => Number(h.cash_in_hand) !== 0 && (!walletId || h.wallet_id === walletId));

  return (
    <>
      <h1>Cash</h1>
      <p className="muted">
        Cash taken out of the cards, and cash given back. Withdrawals should be entered the same day; cash should be spent or returned within {holdDays} days.
      </p>

      <h2>Cash in hand now</h2>
      <div className="table-wrap" style={{ marginBottom: 18 }}>
        <table>
          <thead><tr><th>Wallet</th><th className="num">Cash in hand</th><th className="num">Held over {holdDays} days</th><th className="num">Oldest</th></tr></thead>
          <tbody>
            {hands.map((h) => (
              <tr key={h.wallet_id}>
                <td>{name("wallets", h.wallet_id)}</td>
                <td className="num"><Money value={h.cash_in_hand} /></td>
                <td className="num">{Number(h.held_too_long) > 0 ? <span className="warn-text"><Money value={h.held_too_long} /></span> : "—"}</td>
                <td className="num">{h.oldest_days != null ? `${h.oldest_days} days` : "—"}</td>
              </tr>
            ))}
            {held.data && hands.length === 0 && <tr><td colSpan={4} className="muted">Nobody is holding cash.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="toolbar">
        <Field label="Month">
          <MonthSelect value={month} onChange={setMonth} allowAll />
        </Field>
        <Field label="Wallet">
          <select value={walletId} onChange={(e) => setWalletId(e.target.value)}>
            <option value="">All</option>
            {lookups.wallets.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </Field>
      </div>
      <ErrorText error={list.error || held.error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Date</th><th>Wallet</th><th>What</th><th className="num">Amount</th><th>Entered</th><th>Notes</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const entered = riyadhDay(r.created_at);
              const late = daysBetween(entered, r.move_date);
              return (
                <tr key={r.id} className={r.status === "reversed" ? "muted" : undefined}>
                  <td style={{ whiteSpace: "nowrap" }}>{r.move_date}</td>
                  <td>{name("wallets", r.wallet_id)}</td>
                  <td>{KIND[r.kind]}</td>
                  <td className="num"><Money value={r.amount} direction={r.kind === "handover" ? "out" : undefined} /></td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {late > 0 ? <span className="chip red">{late} day{late === 1 ? "" : "s"} late</span> : <span className="small muted">same day</span>}
                  </td>
                  <td>{r.notes}</td>
                  <td>{r.checked_by ? <span className="chip">✓ checked</span> : <StatusBadge status={r.status} />}</td>
                  <td><Actions row={r} admin={profile?.role === "admin"} onDone={list.reload} /></td>
                </tr>
              );
            })}
            {list.data && rows.length === 0 && <tr><td colSpan={8} className="muted">Nothing here yet</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Actions({ row, admin, onDone }: { row: CashMove; admin: boolean; onDone: () => void }) {
  const [reversing, setReversing] = useState(false);
  const [reason, setReason] = useState("");
  const action = useAction();
  if (row.status === "reversed") return null;
  const run = async (fn: () => PromiseLike<{ error: unknown; data: unknown }>) => {
    if (await action.run(async () => must(await fn() as never))) onDone();
  };
  if (reversing) {
    return (
      <span style={{ display: "flex", gap: 6 }}>
        <input placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        <button disabled={!reason.trim() || action.busy} onClick={() => run(() => supabase().rpc("reverse_cash_move", { p_id: row.id, p_reason: reason }))}>Reverse</button>
        <button onClick={() => setReversing(false)}>✕</button>
      </span>
    );
  }
  return (
    <span style={{ display: "flex", gap: 6, whiteSpace: "nowrap" }}>
      <button disabled={action.busy} onClick={() => run(() => supabase().rpc("set_cash_checked", { p_id: row.id, p_checked: !row.checked_by, p_note: null }))}>
        {row.checked_by ? "Uncheck" : "Mark checked"}
      </button>
      {admin && <button onClick={() => setReversing(true)}>Reverse</button>}
      {action.error && <span className="error small">{action.error}</span>}
    </span>
  );
}
