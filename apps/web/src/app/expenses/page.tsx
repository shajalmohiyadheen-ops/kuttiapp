"use client";

import { useState } from "react";
import type { Expense, ExpenseStatus } from "@kuttiapp/shared";
import { useApp } from "@/lib/app-context";
import { supabase, must } from "@/lib/supabase";
import { downloadXlsx } from "@/lib/export";
import { ExpenseDetail, ExpenseTable, NewExpense } from "@/components/expenses";
import { ErrorText, Field, Money, monthStart, today, useLoad } from "@/components/ui";
import { sum, toDecimalString } from "@kuttiapp/shared";

const STATUSES: ExpenseStatus[] = ["pending", "changes_requested", "approved", "rejected", "reversed"];

export default function ExpensesPage() {
  const { t, lookups, name } = useApp();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [status, setStatus] = useState("");
  const [projectId, setProjectId] = useState("");
  const [walletId, setWalletId] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Expense | null>(null);
  const [creating, setCreating] = useState(false);

  const list = useLoad(async () => {
    let query = supabase().from("expenses").select("*").order("expense_date", { ascending: false }).order("created_at", { ascending: false }).limit(1000);
    if (from) query = query.gte("expense_date", from);
    if (to) query = query.lte("expense_date", to);
    if (status) query = query.eq("status", status);
    if (projectId) query = query.eq("project_id", projectId);
    if (walletId) query = query.eq("wallet_id", walletId);
    if (q.trim()) {
      const s = q.trim().replace(/[%,()]/g, " ");
      query = query.or(`vendor.ilike.%${s}%,description.ilike.%${s}%,invoice_number.ilike.%${s}%,external_id.ilike.%${s}%`);
    }
    return must(await query) as Expense[];
  }, [from, to, status, projectId, walletId, q]);

  const rows = list.data ?? [];

  async function exportRows() {
    await downloadXlsx(`expenses-${from}-to-${to}`, [
      {
        name: "Expenses",
        columns: [
          { header: "Date", key: "expense_date", width: 12 },
          { header: "ID", key: "external_id", width: 16 },
          { header: "Custodian", key: "person" },
          { header: "Wallet", key: "wallet" },
          { header: "Project", key: "project", width: 24 },
          { header: "Category", key: "category" },
          { header: "Vendor", key: "vendor" },
          { header: "Vendor VAT no.", key: "vendor_vat_number" },
          { header: "Invoice no.", key: "invoice_number" },
          { header: "Description", key: "description", width: 30 },
          { header: "Amount", key: "amount", money: true },
          { header: "VAT", key: "vat_amount", money: true },
          { header: "Status", key: "status", width: 12 },
        ],
        rows: rows.map((e) => ({
          ...e,
          person: name("profiles", e.submitted_by),
          wallet: name("wallets", e.wallet_id),
          project: name("projects", e.project_id),
          category: name("categories", e.category_id),
        })),
      },
    ]);
  }

  return (
    <>
      <h1>{t("expenses")}</h1>
      <div className="toolbar">
        <Field label={t("from")}>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label={t("to")}>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label={t("status")}>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t("all")}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{t(s)}</option>
            ))}
          </select>
        </Field>
        <Field label={t("project")}>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">{t("all")}</option>
            {lookups.projects.map((p) => (
              <option key={p.id} value={p.id}>{p.code} {p.name}</option>
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
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="vendor, invoice no., KE-…" />
        </Field>
        <div className="grow" />
        <button onClick={exportRows}>{t("exportExcel")}</button>
        <button className="primary" onClick={() => setCreating(true)}>{t("newExpense")}</button>
      </div>
      <ErrorText error={list.error} />
      <p className="muted small">
        {rows.length} · <Money value={toDecimalString(sum(rows.filter((r) => r.status !== "rejected" && r.status !== "reversed").map((r) => r.amount)))} /> (excluding rejected and reversed)
      </p>
      <ExpenseTable rows={rows} onOpen={setOpen} />
      {open && <ExpenseDetail expense={open} onClose={() => setOpen(null)} onChanged={() => (setOpen(null), list.reload())} />}
      {creating && <NewExpense onClose={() => setCreating(false)} onSaved={() => (setCreating(false), list.reload())} />}
    </>
  );
}
