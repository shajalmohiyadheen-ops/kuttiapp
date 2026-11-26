"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { invoicePath, monthLabel, monthOf, parseAmount, toDecimalString, vatFromInclusive, type Expense, type PaymentMethod } from "@expresscash/shared";
import { useApp } from "@/lib/app-context";
import { supabase, must, signedUrl } from "@/lib/supabase";
import { compressPhoto } from "@/lib/photo";
import { Money, MonthSelect, Wordmark, today } from "@/components/ui";

export default function ExpensePage() {
  return (
    <Suspense>
      <ExpenseView />
    </Suspense>
  );
}

/** One expense on the phone: the details and bill, and a correction form until accounts tick it as checked. */
function ExpenseView() {
  const { t, name, profile, lookups } = useApp();
  const router = useRouter();
  const id = useSearchParams().get("id");
  const [e, setE] = useState<Expense | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const row = must(await supabase().from("expenses").select("*").eq("id", id).maybeSingle()) as Expense | null;
        setE(row);
        if (row?.invoice_path && !row.invoice_path.endsWith(".pdf")) setPhoto(await signedUrl("invoices", row.invoice_path));
      } catch (x) {
        setError(x instanceof Error ? x.message : String(x));
      }
    })();
  }, [id]);

  const canEdit = !!e && e.submitted_by === profile?.id && e.status === "recorded" && !e.checked_by;

  return (
    <div className="phone">
      <header>
        <Wordmark />
        <button className="linkbtn" aria-label="Close" onClick={() => router.push("/app")}>✕</button>
      </header>
      {error && <div className="banner" style={{ color: "var(--danger)" }}>{error}</div>}
      {!e && !error && <div className="muted">…</div>}
      {e && !editing && (
        <>
          <div className="card" style={{ display: "grid", gap: 6 }}>
            <div className="row">
              <strong>{e.paid_by === "card" ? "💳" : "💵"} {name("projects", e.project_id)}</strong>
              <Money value={e.amount} direction="out" />
            </div>
            <div className="muted small">{e.expense_date} · {name("categories", e.category_id)}{e.vendor ? ` · ${e.vendor}` : ""}</div>
            {Number(e.vat_amount) > 0 && <div className="small">{t("vat")}: <Money value={e.vat_amount} /></div>}
            {e.description && <div>{e.description}</div>}
            {monthOf(e.expense_date) !== e.period_month && <div className="small muted">Counted in {monthLabel(e.period_month)}</div>}
            <div className="small">
              {e.status === "reversed" ? (
                <span className="money-out">Reversed by finance{e.reversal_reason ? `: ${e.reversal_reason}` : ""}</span>
              ) : e.checked_by ? (
                <span className="money-in">✓ Checked by accounts{e.check_note ? `: ${e.check_note}` : ""}</span>
              ) : (
                <span className="muted">Not checked yet. You can still correct it.</span>
              )}
            </div>
            <div className="small muted">{e.external_id}</div>
          </div>
          {photo && <img className="photo" src={photo} alt="Bill" />}
          {e.invoice_path?.endsWith(".pdf") && <div className="muted">PDF bill attached</div>}
          {canEdit && <button className="bigbtn" onClick={() => setEditing(true)}>✏️ Correct this expense</button>}
          {!canEdit && e.status === "recorded" && e.checked_by && (
            <div className="muted small">This was checked by accounts, so it can no longer be changed here. Message accounts on WhatsApp if something is wrong.</div>
          )}
        </>
      )}
      {e && editing && (
        <EditForm
          e={e}
          projects={lookups.projects.filter((p) => p.active || p.id === e.project_id)}
          categories={lookups.categories.filter((c) => c.active || c.id === e.category_id)}
          onCancel={() => setEditing(false)}
          onSaved={(row) => (setE(row), setEditing(false))}
        />
      )}
    </div>
  );
}

function EditForm({ e, projects, categories, onCancel, onSaved }: {
  e: Expense;
  projects: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string; receipt_required: boolean }>;
  onCancel: () => void;
  onSaved: (row: Expense) => void;
}) {
  const { t, profile } = useApp();
  const [projectId, setProjectId] = useState(e.project_id);
  const [categoryId, setCategoryId] = useState(e.category_id);
  const [amount, setAmount] = useState(String(e.amount));
  const [vat, setVat] = useState(String(e.vat_amount));
  const [paidBy, setPaidBy] = useState<PaymentMethod>(e.paid_by);
  const [date, setDate] = useState(e.expense_date);
  const [month, setMonth] = useState(e.period_month);
  const [vendor, setVendor] = useState(e.vendor ?? "");
  const [remarks, setRemarks] = useState(e.description ?? "");
  const [newPhoto, setNewPhoto] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    const a = parseAmount(amount);
    const v = parseAmount(vat || "0");
    if (!a || a <= 0) return setError(t("invalidAmount"));
    if (v === null || v < 0 || v >= a) return setError("VAT must be less than the amount");
    setBusy(true);
    try {
      const sb = supabase();
      let invoice_path = e.invoice_path;
      if (newPhoto && profile) {
        // a new file each time: staff may add bills but never overwrite one
        invoice_path = invoicePath(profile.id, crypto.randomUUID(), new Date(date), "jpg");
        const up = await sb.storage.from("invoices").upload(invoice_path, newPhoto, { contentType: "image/jpeg" });
        if (up.error) throw new Error(up.error.message);
      }
      const row = must(
        await sb.from("expenses").update({
          project_id: projectId,
          category_id: categoryId,
          amount: toDecimalString(a),
          vat_amount: toDecimalString(v),
          paid_by: paidBy,
          expense_date: date,
          period_month: month,
          vendor: vendor.trim(),
          description: remarks.trim() || null,
          invoice_path,
        }).eq("id", e.id).select().single(),
      ) as Expense;
      onSaved(row);
    } catch (x) {
      setError(x instanceof Error ? x.message : String(x));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>✏️ Correct expense</h1>
      <label className="field">{t("project")}
        <select value={projectId} onChange={(x) => setProjectId(x.target.value)}>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <label className="field">{t("category")}
        <select value={categoryId} onChange={(x) => setCategoryId(x.target.value)}>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <div className="twin">
        <label className="field">{t("amount")}
          <input inputMode="decimal" value={amount} onChange={(x) => setAmount(x.target.value)} />
        </label>
        <label className="field">{t("vat")}
          <input inputMode="decimal" value={vat} onChange={(x) => setVat(x.target.value)} />
        </label>
      </div>
      <button className="linkbtn" style={{ justifySelf: "start" }} onClick={() => { const a = parseAmount(amount); if (a) setVat(toDecimalString(vatFromInclusive(a))); }}>
        Work out 15% VAT from the amount
      </button>
      <div className="twin">
        <button className={`choice${paidBy === "card" ? " on" : ""}`} onClick={() => setPaidBy("card")}>💳 {t("card")}</button>
        <button className={`choice${paidBy === "cash" ? " on" : ""}`} onClick={() => setPaidBy("cash")}>💵 {t("cash")}</button>
      </div>
      <div className="twin dates">
        <label className="field">{t("date")}
          <input type="date" value={date} max={today()} onChange={(x) => setDate(x.target.value)} />
        </label>
        <label className="field">{t("month")}
          <MonthSelect value={month} onChange={setMonth} />
        </label>
      </div>
      <label className="field">{t("vendor")}
        <input value={vendor} onChange={(x) => setVendor(x.target.value)} />
      </label>
      <label className="field">{t("remarks")}
        <textarea rows={3} value={remarks} placeholder={t("remarksHint")} onChange={(x) => setRemarks(x.target.value)} />
      </label>
      <label className="btn" style={{ textAlign: "center", cursor: "pointer" }}>
        📷 {newPhoto ? "New bill photo added ✓" : e.invoice_path ? "Replace bill photo" : "Add bill photo"}
        <input type="file" accept="image/*" capture="environment" hidden onChange={async (x) => { const f = x.target.files?.[0]; if (f) setNewPhoto(await compressPhoto(f)); }} />
      </label>
      {error && <div className="banner" style={{ color: "var(--danger)" }}>{error}</div>}
      <button className="bigbtn" disabled={busy} onClick={save}>{busy ? "Saving…" : t("save")}</button>
      <button className="btn" onClick={onCancel}>{t("cancel")}</button>
    </>
  );
}
