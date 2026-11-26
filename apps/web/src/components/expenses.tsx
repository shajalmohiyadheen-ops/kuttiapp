"use client";

import { useState } from "react";
import { parseAmount, toDecimalString, vatFromInclusive, invoicePath, formatSar, monthLabel, monthOf, type Expense, type PaymentMethod } from "@expresscash/shared";
import { useApp } from "@/lib/app-context";
import { supabase, must, signedUrl } from "@/lib/supabase";
import { ErrorText, Field, Modal, Money, MonthSelect, PaidBy, StatusBadge, fmtDateTime, today, useAction, useLoad } from "./ui";

export function ExpenseTable({ rows, onOpen }: { rows: Expense[]; onOpen: (e: Expense) => void }) {
  const { t, name } = useApp();
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{t("date")}</th>
            <th>{t("custodian")}</th>
            <th>{t("project")}</th>
            <th>{t("category")}</th>
            <th>{t("paidBy")}</th>
            <th>{t("vendor")} / {t("remarks")}</th>
            <th className="num">{t("amount")}</th>
            <th>{t("invoice")}</th>
            <th>{t("checked")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id} className={`clickable${e.status === "reversed" ? " struck" : ""}`} onClick={() => onOpen(e)}>
              <td style={{ whiteSpace: "nowrap" }}>
                {e.expense_date}
                {monthOf(e.expense_date) !== e.period_month && <div className="small muted">for {monthLabel(e.period_month)}</div>}
              </td>
              <td>{name("profiles", e.submitted_by)}</td>
              <td>{name("projects", e.project_id)}</td>
              <td>{name("categories", e.category_id)}</td>
              <td><PaidBy value={e.paid_by} /></td>
              <td>
                {e.vendor}
                {e.description && <div className="small muted">{e.description}</div>}
              </td>
              <td className="num"><Money value={e.amount} direction="out" /></td>
              <td>{e.invoice_path ? "📎" : <span className="muted">—</span>}</td>
              <td>{e.status === "reversed" ? <StatusBadge status="reversed" /> : e.checked_by ? <span className="badge checked">✓ {t("checked")}</span> : <span className="muted small">—</span>}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={9} className="muted">{t("noData")}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Downloads a stored file under a readable name. */
export async function downloadStored(bucket: "invoices" | "attachments", path: string, filename: string) {
  const { data, error } = await supabase().storage.from(bucket).download(path);
  if (error || !data) throw new Error(error?.message ?? "Download failed");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(data);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function invoiceFileName(e: Pick<Expense, "expense_date" | "external_id" | "invoice_path">): string {
  const ext = (e.invoice_path?.split(".").pop() || "jpg").toLowerCase();
  return `${e.expense_date}_${e.external_id}.${ext}`;
}

export function ExpenseDetail({ expense, onClose, onChanged }: { expense: Expense; onClose: () => void; onChanged: () => void }) {
  const { t, name, profile } = useApp();
  const [note, setNote] = useState(expense.check_note ?? "");
  const [month, setMonth] = useState(expense.period_month);
  const action = useAction();
  const image = useLoad(() => signedUrl("invoices", expense.invoice_path), [expense.invoice_path]);

  const isAdmin = profile?.role === "admin";
  const canCheck = (profile?.role === "admin" || profile?.role === "accounts") && expense.status === "recorded";
  const isPdf = expense.invoice_path?.toLowerCase().endsWith(".pdf");

  async function setChecked(checked: boolean) {
    const ok = await action.run(async () => must(await supabase().rpc("set_checked", { p_id: expense.id, p_checked: checked, p_note: note || null })));
    if (ok) onChanged();
  }
  async function reverse() {
    if (!note.trim()) return action.setError(`${t("reason")}: ${t("required")}`);
    const ok = await action.run(async () => must(await supabase().rpc("reverse_expense", { p_id: expense.id, p_reason: note })));
    if (ok) onChanged();
  }
  async function move() {
    const ok = await action.run(async () => must(await supabase().from("expenses").update({ period_month: month }).eq("id", expense.id).select()));
    if (ok) onChanged();
  }

  return (
    <Modal title={`${t("expense")} ${expense.external_id}`} onClose={onClose}>
      <div className="grid2">
        <dl className="kv">
          <dt>{t("amount")}</dt>
          <dd><strong><Money value={expense.amount} direction="out" /></strong></dd>
          <dt>{t("paidBy")}</dt>
          <dd><PaidBy value={expense.paid_by} /></dd>
          <dt>{t("vat")}</dt>
          <dd><Money value={expense.vat_amount} /></dd>
          <dt>{t("date")}</dt>
          <dd>{expense.expense_date}</dd>
          <dt>{t("month")}</dt>
          <dd>{monthLabel(expense.period_month)}</dd>
          <dt>{t("custodian")}</dt>
          <dd>{name("profiles", expense.submitted_by)}</dd>
          <dt>{t("project")}</dt>
          <dd>{name("projects", expense.project_id)}</dd>
          <dt>{t("category")}</dt>
          <dd>{name("categories", expense.category_id)}</dd>
          <dt>{t("vendor")}</dt>
          <dd>{expense.vendor || "—"}</dd>
          <dt>{t("vendorVat")}</dt>
          <dd>{expense.vendor_vat_number || "—"}</dd>
          <dt>{t("invoiceNumber")}</dt>
          <dd>{expense.invoice_number || "—"}</dd>
          <dt>{t("remarks")}</dt>
          <dd>{expense.description || "—"}</dd>
          <dt>{t("checked")}</dt>
          <dd>
            {expense.checked_by ? `✓ ${name("profiles", expense.checked_by)}, ${fmtDateTime(expense.checked_at)}` : t("unchecked")}
            {expense.check_note ? <div className="small muted">{expense.check_note}</div> : null}
          </dd>
          {expense.reversal_reason && (
            <>
              <dt>{t("reversed")}</dt>
              <dd>{expense.reversal_reason}</dd>
            </>
          )}
          <dt>Saved</dt>
          <dd className="small muted">{fmtDateTime(expense.created_at)}</dd>
        </dl>
        <div>
          {expense.invoice_path ? (
            <>
              {image.data ? (
                isPdf ? (
                  <a href={image.data} target="_blank" rel="noreferrer">{t("invoice")} (PDF)</a>
                ) : (
                  <a href={image.data} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img className="invoice-img" src={image.data} alt={t("invoice")} />
                  </a>
                )
              ) : (
                <span className="muted">…</span>
              )}
              <div style={{ marginTop: 8 }}>
                <button
                  disabled={action.busy}
                  onClick={() => action.run(() => downloadStored("invoices", expense.invoice_path!, invoiceFileName(expense)))}
                >
                  ⬇ {t("downloadInvoice")}
                </button>
              </div>
            </>
          ) : (
            <span className="muted">No bill attached</span>
          )}
        </div>
      </div>

      {(canCheck || isAdmin) && expense.status === "recorded" && (
        <Field label={isAdmin ? `${t("notes")} (check note, or reason to reverse)` : t("notes")} full>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </Field>
      )}
      {isAdmin && expense.status === "recorded" && (
        <div className="toolbar" style={{ marginTop: 8 }}>
          <span className="small muted">{t("month")}</span>
          <MonthSelect value={month} onChange={setMonth} />
          <button disabled={action.busy || month === expense.period_month} onClick={move}>Move to this month</button>
        </div>
      )}
      <ErrorText error={action.error} />
      <div className="actions">
        {isAdmin && expense.status === "recorded" && (
          <button className="danger" disabled={action.busy} onClick={reverse} title="For an entry made by mistake or refunded">{t("reverse")}</button>
        )}
        {canCheck && (expense.checked_by ? (
          <button disabled={action.busy} onClick={() => setChecked(false)}>Untick</button>
        ) : (
          <button className="primary" disabled={action.busy} onClick={() => setChecked(true)}>✓ {t("markChecked")}</button>
        ))}
        <button onClick={onClose}>{t("cancel")}</button>
      </div>
    </Modal>
  );
}

/** Web form for recording an expense (e.g. finance entering one for a staff member). */
export function NewExpense({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t, lookups, profile, setting } = useApp();
  const threshold = setting("invoice_required_above", 100);
  const wallets = lookups.wallets.filter((w) => w.active && (profile?.role === "admin" || w.custodian_id === profile?.id));
  const [f, setF] = useState({
    wallet_id: wallets[0]?.id ?? "",
    project_id: "",
    category_id: "",
    paid_by: "card" as PaymentMethod,
    expense_date: today(),
    period_month: monthOf(today()),
    amount: "",
    vat_amount: "",
    vendor: "",
    vendor_vat_number: "",
    invoice_number: "",
    description: "",
  });
  const [file, setFile] = useState<File | null>(null);
  const action = useAction();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const category = lookups.categories.find((c) => c.id === f.category_id);
  const amountH = parseAmount(f.amount);
  const needsInvoice = (category?.receipt_required ?? true) && amountH !== null && amountH > threshold * 100;
  const needsRemarks = category ? !category.receipt_required : false;

  async function save() {
    if (!profile) return;
    if (amountH === null || amountH <= 0) return action.setError(t("invalidAmount"));
    const vatH = f.vat_amount ? parseAmount(f.vat_amount) : 0;
    if (vatH === null) return action.setError(`${t("vat")}: ${t("invalidAmount")}`);
    if (!f.wallet_id || !f.project_id || !f.category_id) return action.setError(`${t("wallet")}, ${t("project")}, ${t("category")}: ${t("required")}`);
    if (needsInvoice && !file) return action.setError(t("invoiceRequired", { amount: formatSar(threshold) }));
    if (needsRemarks && !f.description.trim()) return action.setError(t("remarksRequired"));
    const ok = await action.run(async () => {
      const sb = supabase();
      let path: string | null = null;
      if (file) {
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
        path = invoicePath(profile.id, crypto.randomUUID(), new Date(), ext);
        const up = await sb.storage.from("invoices").upload(path, file, { contentType: file.type || undefined });
        if (up.error) throw new Error(up.error.message);
      }
      must(
        await sb.from("expenses").insert({
          wallet_id: f.wallet_id,
          project_id: f.project_id,
          category_id: f.category_id,
          paid_by: f.paid_by,
          expense_date: f.expense_date,
          period_month: f.period_month,
          amount: toDecimalString(amountH),
          vat_amount: toDecimalString(vatH),
          vendor: f.vendor.trim(),
          vendor_vat_number: f.vendor_vat_number.trim() || null,
          invoice_number: f.invoice_number.trim() || null,
          description: f.description.trim() || null,
          invoice_path: path,
          client_id: crypto.randomUUID(),
        }),
      );
      return true;
    });
    if (ok) onSaved();
  }

  return (
    <Modal title={t("newExpense")} onClose={onClose}>
      <div className="form">
        <Field label={t("wallet")}>
          <select value={f.wallet_id} onChange={set("wallet_id")}>
            {wallets.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </Field>
        <Field label={t("paidBy")}>
          <select value={f.paid_by} onChange={set("paid_by")}>
            <option value="card">{t("card")}</option>
            <option value="cash">{t("cash")}</option>
          </select>
        </Field>
        <Field label={t("date")}>
          <input type="date" value={f.expense_date} onChange={(e) => setF({ ...f, expense_date: e.target.value, period_month: monthOf(e.target.value || today()) })} />
        </Field>
        <Field label={t("month")}>
          <MonthSelect value={f.period_month} onChange={(v) => setF({ ...f, period_month: v })} />
        </Field>
        <Field label={t("project")}>
          <select value={f.project_id} onChange={set("project_id")}>
            <option value="" />
            {lookups.projects.filter((p) => p.active).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </Field>
        <Field label={t("category")}>
          <select value={f.category_id} onChange={set("category_id")}>
            <option value="" />
            {lookups.categories.filter((c) => c.active).map((c) => (
              <option key={c.id} value={c.id}>{c.name}{c.receipt_required ? "" : " (no bill)"}</option>
            ))}
          </select>
        </Field>
        <Field label={`${t("amount")} (SAR, incl. VAT)`}>
          <input inputMode="decimal" value={f.amount} onChange={set("amount")} />
        </Field>
        <Field label={t("vat")}>
          <div style={{ display: "flex", gap: 6 }}>
            <input inputMode="decimal" value={f.vat_amount} onChange={set("vat_amount")} style={{ flex: 1 }} />
            <button type="button" disabled={amountH === null} onClick={() => amountH !== null && setF({ ...f, vat_amount: toDecimalString(vatFromInclusive(amountH)) })}>15%</button>
          </div>
        </Field>
        <Field label={t("vendor")}>
          <input value={f.vendor} onChange={set("vendor")} />
        </Field>
        <Field label={t("invoiceNumber")}>
          <input value={f.invoice_number} onChange={set("invoice_number")} />
        </Field>
        <Field label={`${t("invoice")}${needsInvoice ? " *" : ""}`}>
          <input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
        <Field label={`${t("vendorVat")}`}>
          <input value={f.vendor_vat_number} onChange={set("vendor_vat_number")} maxLength={15} />
        </Field>
        <Field label={`${t("remarks")}${needsRemarks ? " *" : ""}`} full>
          <textarea value={f.description} onChange={set("description")} placeholder={t("remarksHint")} />
        </Field>
      </div>
      <ErrorText error={action.error} />
      <div className="actions">
        <button onClick={onClose}>{t("cancel")}</button>
        <button className="primary" disabled={action.busy} onClick={save}>{t("save")}</button>
      </div>
    </Modal>
  );
}
