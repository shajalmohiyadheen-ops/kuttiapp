"use client";

import { useState } from "react";
import { parseAmount, toDecimalString, vatFromInclusive, invoicePath, formatSar, type Expense, type ExpenseEvent, type ReviewDecision } from "@kuttiapp/shared";
import { useApp } from "@/lib/app-context";
import { supabase, must, signedUrl } from "@/lib/supabase";
import { ErrorText, Field, Modal, Money, StatusBadge, fmtDateTime, today, useAction, useLoad } from "./ui";

export function ExpenseTable({ rows, onOpen }: { rows: Expense[]; onOpen: (e: Expense) => void }) {
  const { t, name } = useApp();
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{t("date")}</th>
            <th>ID</th>
            <th>{t("custodian")}</th>
            <th>{t("wallet")}</th>
            <th>{t("project")}</th>
            <th>{t("category")}</th>
            <th>{t("vendor")}</th>
            <th className="num">{t("amount")}</th>
            <th>{t("invoice")}</th>
            <th>{t("status")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id} className="clickable" onClick={() => onOpen(e)}>
              <td>{e.expense_date}</td>
              <td className="small muted">{e.external_id}</td>
              <td>{name("profiles", e.submitted_by)}</td>
              <td>{name("wallets", e.wallet_id)}</td>
              <td>{name("projects", e.project_id)}</td>
              <td>{name("categories", e.category_id)}</td>
              <td>{e.vendor}</td>
              <td className="num"><Money value={e.amount} /></td>
              <td>{e.invoice_path ? "📎" : <span className="muted">—</span>}</td>
              <td><StatusBadge status={e.status} /></td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={10} className="muted">{t("noData")}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function ExpenseDetail({ expense, onClose, onChanged }: { expense: Expense; onClose: () => void; onChanged: () => void }) {
  const { t, name, profile } = useApp();
  const [note, setNote] = useState("");
  const action = useAction();
  const image = useLoad(() => signedUrl("invoices", expense.invoice_path), [expense.invoice_path]);
  const events = useLoad(
    async () => must(await supabase().from("expense_events").select("*").eq("expense_id", expense.id).order("at")) as ExpenseEvent[],
    [expense.id],
  );

  const canReview = expense.status === "pending" && profile && (profile.role === "admin" || (profile.role === "approver" && expense.submitted_by !== profile.id));
  const canReverse = expense.status === "approved" && profile?.role === "admin";

  async function review(decision: ReviewDecision) {
    if (decision !== "approve" && !note.trim()) {
      action.setError(`${t("reason")}: ${t("required")}`);
      return;
    }
    const ok = await action.run(async () => must(await supabase().rpc("review_expense", { p_id: expense.id, p_decision: decision, p_note: note || null })));
    if (ok) onChanged();
  }

  async function reverse() {
    if (!note.trim()) {
      action.setError(`${t("reason")}: ${t("required")}`);
      return;
    }
    const ok = await action.run(async () => must(await supabase().rpc("reverse_expense", { p_id: expense.id, p_reason: note })));
    if (ok) onChanged();
  }

  const isPdf = expense.invoice_path?.toLowerCase().endsWith(".pdf");

  return (
    <Modal title={`${t("expense")} ${expense.external_id}`} onClose={onClose}>
      <div className="grid2">
        <dl className="kv">
          <dt>{t("status")}</dt>
          <dd><StatusBadge status={expense.status} /></dd>
          <dt>{t("amount")}</dt>
          <dd><strong><Money value={expense.amount} /></strong></dd>
          <dt>{t("vat")}</dt>
          <dd><Money value={expense.vat_amount} /></dd>
          <dt>{t("date")}</dt>
          <dd>{expense.expense_date}</dd>
          <dt>{t("custodian")}</dt>
          <dd>{name("profiles", expense.submitted_by)}</dd>
          <dt>{t("wallet")}</dt>
          <dd>{name("wallets", expense.wallet_id)}</dd>
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
          <dt>{t("description")}</dt>
          <dd>{expense.description || "—"}</dd>
          {expense.review_note && (
            <>
              <dt>{t("notes")}</dt>
              <dd>{expense.review_note}</dd>
            </>
          )}
          {expense.reversal_reason && (
            <>
              <dt>{t("reversed")}</dt>
              <dd>{expense.reversal_reason}</dd>
            </>
          )}
        </dl>
        <div>
          {expense.invoice_path ? (
            image.data ? (
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
            )
          ) : (
            <span className="muted">No invoice attached</span>
          )}
        </div>
      </div>

      <h2>{t("history")}</h2>
      <ul className="small">
        {(events.data ?? []).map((ev) => (
          <li key={ev.id}>
            {fmtDateTime(ev.at)}: {ev.from_status ? `${t(ev.from_status)} → ` : ""}
            <strong>{t(ev.to_status)}</strong> {ev.actor_id ? `(${name("profiles", ev.actor_id)})` : ""}
            {ev.note ? ` · ${ev.note}` : ""}
          </li>
        ))}
      </ul>

      {(canReview || canReverse) && (
        <Field label={`${t("reason")} / ${t("notes")}`} full>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      )}
      <ErrorText error={action.error} />
      <div className="actions">
        {canReview && (
          <>
            <button className="danger" disabled={action.busy} onClick={() => review("reject")}>{t("reject")}</button>
            <button disabled={action.busy} onClick={() => review("request_changes")}>{t("requestChanges")}</button>
            <button className="primary" disabled={action.busy} onClick={() => review("approve")}>{t("approve")}</button>
          </>
        )}
        {canReverse && (
          <button className="danger" disabled={action.busy} onClick={reverse}>{t("reverse")}</button>
        )}
        <button onClick={onClose}>{t("cancel")}</button>
      </div>
    </Modal>
  );
}

/** Web form for recording an expense (e.g. finance entering a cash disbursement). */
export function NewExpense({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t, lookups, profile, locale } = useApp();
  const threshold = useLoad(async () => {
    const { data } = await supabase().from("settings").select("value").eq("key", "invoice_required_above").maybeSingle();
    return Number(data?.value ?? 100);
  }, []);
  const wallets = lookups.wallets.filter((w) => w.active && (profile?.role === "admin" || w.custodian_id === profile?.id));
  const [f, setF] = useState({
    wallet_id: wallets[0]?.id ?? "",
    project_id: "",
    category_id: "",
    expense_date: today(),
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

  const amountH = parseAmount(f.amount);
  const needsInvoice = amountH !== null && threshold.data !== undefined && amountH > threshold.data * 100;

  async function save() {
    if (!profile) return;
    if (amountH === null || amountH <= 0) return action.setError(t("invalidAmount"));
    const vatH = f.vat_amount ? parseAmount(f.vat_amount) : 0;
    if (vatH === null) return action.setError(`${t("vat")}: ${t("invalidAmount")}`);
    if (!f.wallet_id || !f.project_id || !f.category_id) return action.setError(`${t("wallet")}, ${t("project")}, ${t("category")}: ${t("required")}`);
    if (needsInvoice && !file) return action.setError(t("invoiceRequired", { amount: formatSar(threshold.data ?? 0, { locale }) }));
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
          expense_date: f.expense_date,
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
        <Field label={t("date")}>
          <input type="date" value={f.expense_date} onChange={set("expense_date")} />
        </Field>
        <Field label={t("project")}>
          <select value={f.project_id} onChange={set("project_id")}>
            <option value="" />
            {lookups.projects.filter((p) => p.active).map((p) => (
              <option key={p.id} value={p.id}>{p.code} {p.name}</option>
            ))}
          </select>
        </Field>
        <Field label={t("category")}>
          <select value={f.category_id} onChange={set("category_id")}>
            <option value="" />
            {lookups.categories.filter((c) => c.active).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
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
        <Field label={t("vendorVat")}>
          <input value={f.vendor_vat_number} onChange={set("vendor_vat_number")} maxLength={15} />
        </Field>
        <Field label={t("invoiceNumber")}>
          <input value={f.invoice_number} onChange={set("invoice_number")} />
        </Field>
        <Field label={`${t("invoice")}${needsInvoice ? " *" : ""}`}>
          <input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
        <Field label={t("description")} full>
          <textarea value={f.description} onChange={set("description")} />
        </Field>
      </div>
      <ErrorText error={action.error} />
      <div className="actions">
        <button onClick={onClose}>{t("cancel")}</button>
        <button className="primary" disabled={action.busy} onClick={save}>{t("submit")}</button>
      </div>
    </Modal>
  );
}
