"use client";

import { useState } from "react";
import { fromDb, monthLabel, type AttentionFlag, type Expense, type StorageUsage, type Topup, type WalletBalance, type WalletMonthSummary } from "@expresscash/shared";
import { useApp } from "@/lib/app-context";
import { supabase, must } from "@/lib/supabase";
import { downloadXlsx } from "@/lib/export";
import { standardSheets } from "@/lib/workbook";
import { RequireRole } from "@/components/shell";
import { invoiceFileName } from "@/components/expenses";
import { ErrorText, Field, Money, MonthSelect, monthStart, useAction, useLive, useLoad } from "@/components/ui";

export default function DashboardPage() {
  return (
    <RequireRole roles={["admin", "accounts"]}>
      <Dashboard />
    </RequireRole>
  );
}

/**
 * The consolidation: per wallet, what was there at the start, what was transferred in, what was spent
 * (and its VAT), and what is left. Every row and the totals satisfy opening + transferred - spent = balance.
 */
function Dashboard() {
  const { t, lookups } = useApp();
  const [month, setMonth] = useState(monthStart());
  const [walletId, setWalletId] = useState("");
  const action = useAction();

  const summary = useLoad(async () => must(await supabase().rpc("wallet_month_summary", { p_month: month || null })) as WalletMonthSummary[], [month]);
  const flags = useLoad(async () => must(await supabase().rpc("attention_flags")) as AttentionFlag[], []);
  const storage = useLoad(async () => must(await supabase().rpc("storage_usage")) as StorageUsage | null, []);
  useLive(() => (summary.reload(), flags.reload()));

  const rows = (summary.data ?? []).filter((r) => !walletId || r.wallet_id === walletId);
  const total = (k: keyof WalletMonthSummary) => (rows.reduce((a, r) => a + fromDb(r[k] as string), 0) / 100).toFixed(2);
  const ready = summary.data !== undefined;
  const hasReturned = rows.some((r) => fromDb(r.returned) !== 0);
  const shownFlags = (flags.data ?? []).filter((f) => !walletId || f.wallet_id === walletId);
  const flagsFor = (id: string) => shownFlags.filter((f) => f.wallet_id === id);
  const openingLabel = month ? `Start of ${monthLabel(month)}` : "Brought forward";
  const balanceLabel = month && month !== monthStart() ? `Balance end of ${monthLabel(month)}` : "Balance now";

  async function exportAll() {
    await action.run(async () => {
      const sb = supabase();
      let e = sb.from("expenses").select("*").order("expense_date");
      let tp = sb.from("topups").select("*").order("transfer_date");
      let b = sb.from("wallet_balances").select("*").order("name");
      let c = sb.from("cash_moves").select("*").order("move_date");
      if (month) (e = e.eq("period_month", month)), (tp = tp.eq("period_month", month)), (c = c.eq("period_month", month));
      if (walletId) (e = e.eq("wallet_id", walletId)), (tp = tp.eq("wallet_id", walletId)), (b = b.eq("wallet_id", walletId)), (c = c.eq("wallet_id", walletId));
      const [ex, tx, bx, cx] = await Promise.all([e, tp, b, c]);
      await downloadXlsx(`express-cash-${month ? month.slice(0, 7) : "all-open-months"}`, standardSheets({
        title: month ? `Month ${monthLabel(month)}` : "All open months",
        expenses: must(ex) as Expense[] as unknown as Array<Record<string, unknown>>,
        topups: must(tx) as Topup[] as unknown as Array<Record<string, unknown>>,
        balances: must(bx) as WalletBalance[] as unknown as Array<Record<string, unknown>>,
        cashMoves: must(cx) as Array<Record<string, unknown>>,
        ...lookups,
        invoiceName: (r) => invoiceFileName(r as unknown as Expense),
      }));
    });
  }

  const used = storage.data ? storage.data.used_bytes / Math.max(1, storage.data.limit_bytes) : 0;

  return (
    <>
      <h1>{t("dashboard")}</h1>
      <div className="toolbar">
        <Field label={t("month")}>
          <MonthSelect value={month} onChange={setMonth} allowAll />
        </Field>
        <Field label={t("wallet")}>
          <select value={walletId} onChange={(e) => setWalletId(e.target.value)}>
            <option value="">{t("all")}</option>
            {lookups.wallets.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </Field>
        <div className="grow" />
        <button disabled={action.busy} onClick={exportAll}>{t("exportExcel")}</button>
        <button onClick={() => window.print()}>{t("exportPdf")}</button>
      </div>
      <ErrorText error={summary.error || action.error} />

      {used >= 0.8 && (
        <div className="notice warn">
          Bill photo storage is {Math.round(used * 100)}% full. Close the oldest month (download, then erase) to free space.
        </div>
      )}

      <div className="tiles four">
        <Tile direction="in" label="Transferred to wallets" value={ready ? total("transferred") : undefined} />
        <Tile direction="out" label="Spent" value={ready ? total("spent") : undefined} />
        <Tile label="VAT in spend" value={ready ? total("vat") : undefined} />
        <Tile hero label={balanceLabel} value={ready ? total("balance") : undefined} />
      </div>
      {ready && (
        <p className="tally">
          {openingLabel} <Money value={total("opening")} /> <span className="op">+</span> transferred <Money value={total("transferred")} direction="in" />{" "}
          <span className="op">−</span> spent <Money value={total("spent")} />{" "}
          {hasReturned && <><span className="op">−</span> returned <Money value={total("returned")} />{" "}</>}
          <span className="op">=</span> <strong><Money value={total("balance")} /></strong>
        </p>
      )}

      <h2>{t("wallets")}</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("wallet")}</th>
              <th className="num">{openingLabel}</th>
              <th className="num">Transferred</th>
              <th className="num">Spent</th>
              <th className="num">VAT</th>
              {hasReturned && <th className="num">Returned</th>}
              <th className="num">{balanceLabel}</th>
              <th className="num">{t("cashInHand")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.wallet_id} className={r.active ? undefined : "muted"}>
                <td>
                  <div style={{ whiteSpace: "nowrap" }}>
                    {r.name}
                    {flagsFor(r.wallet_id).length > 0 && (
                      <span className="chip red" title={flagsFor(r.wallet_id).map((f) => f.message).join("\n")} style={{ marginLeft: 8 }}>⚠ {flagsFor(r.wallet_id).length}</span>
                    )}
                  </div>
                  <div className="small muted" style={{ whiteSpace: "nowrap" }}>{[r.custodian_name, r.card_last4 && `•••• ${r.card_last4}`].filter(Boolean).join(" · ")}</div>
                </td>
                <td className="num"><Money value={r.opening} /></td>
                <td className="num"><Money value={r.transferred} direction="in" /></td>
                <td className="num"><Money value={r.spent} direction="out" /></td>
                <td className="num"><Money value={r.vat} /></td>
                {hasReturned && <td className="num"><Money value={r.returned} /></td>}
                <td className="num">
                  <strong><Money value={r.balance} /></strong>
                  {fromDb(r.balance) < 0 && <div className="small warn-text">Transfer pending?</div>}
                </td>
                <td className="num"><Money value={r.cash_in_hand} /></td>
              </tr>
            ))}
            {ready && rows.length === 0 && (
              <tr><td colSpan={8} className="muted">No wallets yet. Add one under Wallets.</td></tr>
            )}
          </tbody>
          {rows.length > 1 && (
            <tfoot>
              <tr>
                <th>Total</th>
                <th className="num"><Money value={total("opening")} /></th>
                <th className="num"><Money value={total("transferred")} direction="in" /></th>
                <th className="num"><Money value={total("spent")} direction="out" /></th>
                <th className="num"><Money value={total("vat")} /></th>
                {hasReturned && <th className="num"><Money value={total("returned")} /></th>}
                <th className="num"><Money value={total("balance")} /></th>
                <th className="num"><Money value={total("cash_in_hand")} /></th>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="muted small">
        Balance = {openingLabel} + transferred − spent{hasReturned ? " − cash returned to the office" : ""}. Spent includes card and cash. Balance includes the cash in hand. Updates live as staff save.
      </p>
    </>
  );
}


function Tile({ label, value, direction, hero }: { label: string; value: string | undefined; direction?: "in" | "out"; hero?: boolean }) {
  return (
    <div className={`tile${direction ? ` ${direction}` : ""}${hero ? " hero" : ""}`}>
      <div className="label">{label}</div>
      <div className="value">{value === undefined ? "…" : <Money value={value} direction={direction} />}</div>
    </div>
  );
}
