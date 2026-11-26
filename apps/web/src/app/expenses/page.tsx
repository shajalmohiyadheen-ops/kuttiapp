"use client";

import { useState } from "react";
import { sum, toDecimalString, type Expense, type WalletBalance, type Topup } from "@kuttiapp/shared";
import { useApp } from "@/lib/app-context";
import { supabase, must } from "@/lib/supabase";
import { downloadXlsx, downloadZip } from "@/lib/export";
import { standardSheets } from "@/lib/workbook";
import { RequireRole } from "@/components/shell";
import { ExpenseDetail, ExpenseTable, NewExpense, invoiceFileName } from "@/components/expenses";
import { ErrorText, Field, Money, MonthSelect, monthStart, useAction, useLive, useLoad } from "@/components/ui";

export default function ExpensesPage() {
  return (
    <RequireRole roles={["admin", "accounts"]}>
      <Expenses />
    </RequireRole>
  );
}

function Expenses() {
  const { t, lookups } = useApp();
  const [month, setMonth] = useState(monthStart());
  const [checked, setChecked] = useState("");
  const [paidBy, setPaidBy] = useState("");
  const [projectId, setProjectId] = useState("");
  const [walletId, setWalletId] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Expense | null>(null);
  const [creating, setCreating] = useState(false);
  const [progress, setProgress] = useState("");
  const action = useAction();

  const list = useLoad(async () => {
    let query = supabase().from("expenses").select("*").order("expense_date", { ascending: false }).order("created_at", { ascending: false }).limit(2000);
    if (month) query = query.eq("period_month", month);
    if (checked === "yes") query = query.not("checked_by", "is", null);
    if (checked === "no") query = query.is("checked_by", null).eq("status", "recorded");
    if (paidBy) query = query.eq("paid_by", paidBy);
    if (projectId) query = query.eq("project_id", projectId);
    if (walletId) query = query.eq("wallet_id", walletId);
    if (q.trim()) {
      const s = q.trim().replace(/[%,()]/g, " ");
      query = query.or(`vendor.ilike.%${s}%,description.ilike.%${s}%,invoice_number.ilike.%${s}%,external_id.ilike.%${s}%`);
    }
    return must(await query) as Expense[];
  }, [month, checked, paidBy, projectId, walletId, q]);
  useLive(list.reload);

  const rows = list.data ?? [];
  const live = rows.filter((r) => r.status !== "reversed");

  async function exportExcel() {
    await action.run(async () => {
      const sb = supabase();
      const [balances, topups] = await Promise.all([
        sb.from("wallet_balances").select("*").order("name"),
        month ? sb.from("topups").select("*").eq("period_month", month).order("transfer_date") : sb.from("topups").select("*").order("transfer_date"),
      ]);
      await downloadXlsx(`kuttiapp-expenses-${month || "all"}`, standardSheets({
        title: month ? `Month ${month.slice(0, 7)} (filtered view)` : "All open months (filtered view)",
        expenses: rows as unknown as Array<Record<string, unknown>>,
        topups: must(topups) as Topup[] as unknown as Array<Record<string, unknown>>,
        balances: must(balances) as WalletBalance[] as unknown as Array<Record<string, unknown>>,
        ...lookups,
        invoiceName: (e) => invoiceFileName(e as unknown as Expense),
      }));
    });
  }

  async function exportBills() {
    const files = rows.filter((e) => e.invoice_path).map((e) => ({ bucket: "invoices" as const, path: e.invoice_path!, name: invoiceFileName(e) }));
    if (!files.length) return action.setError("No bills in this list");
    await action.run(() => downloadZip(`kuttiapp-bills-${month || "all"}`, files, [], (d, n) => setProgress(`${d}/${n}`)));
    setProgress("");
  }

  return (
    <>
      <h1>{t("expenses")}</h1>
      <div className="toolbar">
        <Field label={t("month")}>
          <MonthSelect value={month} onChange={setMonth} allowAll />
        </Field>
        <Field label={t("checked")}>
          <select value={checked} onChange={(e) => setChecked(e.target.value)}>
            <option value="">{t("all")}</option>
            <option value="no">{t("unchecked")}</option>
            <option value="yes">{t("checked")}</option>
          </select>
        </Field>
        <Field label={t("paidBy")}>
          <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
            <option value="">{t("all")}</option>
            <option value="card">{t("card")}</option>
            <option value="cash">{t("cash")}</option>
          </select>
        </Field>
        <Field label={t("project")}>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">{t("all")}</option>
            {lookups.projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </Field>
        <Field label={t("wallet")}>
          <select value={walletId} onChange={(e) => setWalletId(e.target.value)}>
            <option value="">{t("all")}</option>
            {lookups.wallets.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </Field>
        <Field label={t("search")}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="vendor, remarks, KE-…" />
        </Field>
        <div className="grow" />
        <button disabled={action.busy} onClick={exportExcel}>{t("exportExcel")}</button>
        <button disabled={action.busy} onClick={exportBills}>{progress ? `Bills ${progress}` : "⬇ Bills (zip)"}</button>
        <button className="primary" onClick={() => setCreating(true)}>{t("newExpense")}</button>
      </div>
      <ErrorText error={list.error || action.error} />
      <p className="muted small">
        {rows.length} entries · <Money value={toDecimalString(sum(live.map((r) => r.amount)))} direction="out" /> spent
        {" "}(card <Money value={toDecimalString(sum(live.filter((r) => r.paid_by === "card").map((r) => r.amount)))} />,
        cash <Money value={toDecimalString(sum(live.filter((r) => r.paid_by === "cash").map((r) => r.amount)))} />)
        {" "}· {live.filter((r) => !r.checked_by).length} not checked · updates live
      </p>
      <ExpenseTable rows={rows} onOpen={setOpen} />
      {open && <ExpenseDetail expense={open} onClose={() => setOpen(null)} onChanged={() => (setOpen(null), list.reload())} />}
      {creating && <NewExpense onClose={() => setCreating(false)} onSaved={() => (setCreating(false), list.reload())} />}
    </>
  );
}
