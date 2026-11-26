"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  formatSar,
  matchProjects,
  monthLabel,
  monthOf,
  parseAmount,
  parseSpokenAmount,
  toDecimalString,
  vatFromInclusive,
  type PaymentMethod,
  type Project,
  type ZatcaInvoice,
} from "@expresscash/shared";
import { useApp } from "@/lib/app-context";
import { compressPhoto, readInvoiceQr } from "@/lib/photo";
import { recentChoices, rememberChoices, saveAndSend, type Draft } from "@/lib/drafts";
import { useVoice, voiceAvailable } from "@/lib/voice";
import { MonthSelect, today } from "@/components/ui";

type Step = "photo" | "project" | "amount" | "category" | "paid" | "confirm" | "done";

export default function AddExpense() {
  const { t, lookups, profile, setting } = useApp();
  const router = useRouter();
  const wallet = lookups.wallets.find((w) => w.active && w.custodian_id === profile?.id);
  const projects = lookups.projects.filter((p) => p.active);
  const categories = lookups.categories.filter((c) => c.active);
  const recent = useMemo(() => recentChoices(), []);
  const threshold = setting("invoice_required_above", 100);

  const [step, setStep] = useState<Step>("photo");
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [qr, setQr] = useState<ZatcaInvoice | null>(null);
  const [reading, setReading] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [amount, setAmount] = useState("");
  const [withVat, setWithVat] = useState(true);
  const [categoryId, setCategoryId] = useState("");
  const [paidBy, setPaidBy] = useState<PaymentMethod | "">("");
  const [date, setDate] = useState(today());
  const [month, setMonth] = useState(monthOf(today()));
  const [remarks, setRemarks] = useState("");
  const [vendor, setVendor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<"sent" | "queued" | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const category = categories.find((c) => c.id === categoryId);
  const amountH = parseAmount(amount);
  const vatH = qr ? parseAmount(qr.vat) : withVat && amountH ? vatFromInclusive(amountH) : 0;

  useEffect(() => () => void (photoUrl && URL.revokeObjectURL(photoUrl)), [photoUrl]);

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setReading(true);
    setError(null);
    try {
      const inv = await readInvoiceQr(file);
      const small = await compressPhoto(file);
      setPhoto(small);
      setPhotoUrl(URL.createObjectURL(small));
      setQr(inv);
      if (inv) {
        setAmount(inv.total);
        setVendor(inv.sellerName);
        if (inv.date) {
          setDate(inv.date);
          setMonth(monthOf(inv.date));
        }
      }
      setStep("project");
    } finally {
      setReading(false);
    }
  }

  const back: Partial<Record<Step, Step>> = { project: "photo", amount: "project", category: qr ? "project" : "amount", paid: "category", confirm: "paid" };

  async function submit() {
    if (!profile || !wallet) return;
    setError(null);
    if (!projectId || !categoryId || !paidBy) return setError("Choose project, what it was for, and card or cash.");
    if (amountH === null || amountH <= 0) return setError(t("invalidAmount"));
    if (category?.receipt_required && amountH > threshold * 100 && !photo) return setError(t("invoiceRequired", { amount: formatSar(threshold) }));
    if (category && !category.receipt_required && !remarks.trim()) return setError(t("remarksRequired"));
    const d: Draft = {
      client_id: crypto.randomUUID(),
      saved_at: new Date().toISOString(),
      wallet_id: wallet.id,
      project_id: projectId,
      category_id: categoryId,
      paid_by: paidBy,
      expense_date: date,
      period_month: month,
      amount: toDecimalString(amountH),
      vat_amount: toDecimalString(vatH ?? 0),
      vendor,
      vendor_vat_number: qr?.vatNumber ?? "",
      invoice_number: "",
      description: remarks,
      photo,
    };
    setBusy(true);
    try {
      const r = await saveAndSend(d, profile.id);
      rememberChoices(projectId, categoryId, paidBy);
      setResult(r);
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!wallet) {
    return (
      <div className="phone">
        <div className="card">No wallet is assigned to you yet. Ask your admin.</div>
        <button className="btn" onClick={() => router.push("/app")}>{t("back")}</button>
      </div>
    );
  }

  return (
    <div className="phone">
      {step !== "done" && (
        <div className="row">
          <button className="linkbtn" onClick={() => (back[step] ? setStep(back[step]!) : router.push("/app"))}>← {back[step] ? t("back") : t("cancel")}</button>
          <span className="step">{["photo", "project", "amount", "category", "paid", "confirm"].indexOf(step) + 1} / 6</span>
        </div>
      )}

      {step === "photo" && (
        <>
          <h1>{t("takeBillPhoto")}</h1>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => onPhoto(e.target.files?.[0])} />
          <button className="bigbtn" disabled={reading} onClick={() => fileRef.current?.click()}>{reading ? "Reading the bill…" : `📷 ${t("takePhoto")}`}</button>
          <button className="btn" onClick={() => setStep("project")}>{t("noBillPhoto")}</button>
          <p className="muted small">If the bill has a Saudi e-invoice QR code, the amount, VAT and shop name are filled in for you.</p>
        </>
      )}

      {step === "project" && (
        <ProjectStep projects={projects} recent={recent.projects} value={projectId} onPick={(id) => (setProjectId(id), setStep(qr ? "category" : "amount"))} />
      )}

      {step === "amount" && <AmountStep value={amount} onDone={(v) => (setAmount(v), setStep("category"))} />}

      {step === "category" && (
        <>
          <h1>{t("whichCategory")}</h1>
          <div className="choices">
            {[...categories].sort((a, b) => rank(recent.categories, a.id) - rank(recent.categories, b.id)).map((c) => (
              <button key={c.id} className={`choice${c.id === categoryId ? " on" : ""}`} onClick={() => (setCategoryId(c.id), setStep("paid"))}>
                {c.name}
                {!c.receipt_required && <span className="small muted"> · no bill</span>}
              </button>
            ))}
          </div>
        </>
      )}

      {step === "paid" && (
        <>
          <h1>{t("cardOrCash")}</h1>
          <div className="twin">
            <button className={`choice${paidBy === "card" ? " on" : ""}`} onClick={() => (setPaidBy("card"), setStep("confirm"))}>💳<br />{t("card")}</button>
            <button className={`choice${paidBy === "cash" ? " on" : ""}`} onClick={() => (setPaidBy("cash"), setStep("confirm"))}>💵<br />{t("cash")}</button>
          </div>
          <p className="muted small">Cash means cash you withdrew from the card.</p>
        </>
      )}

      {step === "confirm" && (
        <>
          <h1>{t("confirmExpense")}</h1>
          <div className="card" style={{ display: "grid", gap: 12 }}>
            <label className="field">
              {t("amount")} (SAR)
              <input className="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
            {qr ? (
              <div className="small ok">✓ {t("fromInvoice")}: VAT {qr.vat}{qr.sellerName ? ` · ${qr.sellerName}` : ""}</div>
            ) : (
              <label className="row small">
                <span>{t("vatIncluded")}</span>
                <input type="checkbox" checked={withVat} onChange={(e) => setWithVat(e.target.checked)} style={{ width: 24, height: 24 }} />
              </label>
            )}
            <Tap label={t("project")} value={projects.find((p) => p.id === projectId)?.name ?? "—"} onClick={() => setStep("project")} />
            <Tap label={t("category")} value={category?.name ?? "—"} onClick={() => setStep("category")} />
            <Tap label={t("paidBy")} value={paidBy === "card" ? `💳 ${t("card")}` : paidBy === "cash" ? `💵 ${t("cash")}` : "—"} onClick={() => setStep("paid")} />
            <label className="field">
              {category && !category.receipt_required ? `${t("remarks")} *` : t("remarksOptional")}
              <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder={t("remarksHint")} rows={2} />
            </label>
            <div className="twin dates">
              <label className="field">
                {t("date")}
                <input type="date" value={date} onChange={(e) => (setDate(e.target.value), setMonth(monthOf(e.target.value || today())))} />
              </label>
              <label className="field">
                {t("month")}
                <MonthSelect value={month} onChange={setMonth} />
              </label>
            </div>
            {photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="photo" src={photoUrl} alt={t("invoice")} onClick={() => setStep("photo")} />
            ) : (
              <button className="btn" onClick={() => setStep("photo")}>📷 Add bill photo</button>
            )}
          </div>
          {error && <div className="banner" style={{ color: "var(--danger)" }}>{error}</div>}
          <button className="bigbtn" disabled={busy} onClick={submit}>{busy ? "Saving…" : `✓ ${t("save")}`}</button>
        </>
      )}

      {step === "done" && (
        <>
          <div className="card" style={{ textAlign: "center", padding: 28 }}>
            <div style={{ fontSize: 56 }}>✅</div>
            <h1>{result === "sent" ? t("saved") : "Saved on this phone"}</h1>
            <p className="muted">
              {formatSar(amount)} · {monthLabel(month)}
              <br />
              {result === "queued" ? t("offlineSaved") : "Accounts can see it now."}
            </p>
          </div>
          <button className="bigbtn" onClick={() => window.location.reload()}>📷 Add another</button>
          <button className="btn" onClick={() => router.push("/app")}>Done</button>
        </>
      )}
    </div>
  );
}

function rank(list: string[], id: string) {
  const i = list.indexOf(id);
  return i < 0 ? 99 : i;
}

function Tap({ label, value, onClick }: { label: string; value: string; onClick: () => void }) {
  return (
    <button className="item" onClick={onClick}>
      <span className="sub">{label}</span>
      <span>{value} ›</span>
    </button>
  );
}

function ProjectStep({ projects, recent, value, onPick }: { projects: Project[]; recent: string[]; value: string; onPick: (id: string) => void }) {
  const { t } = useApp();
  const voice = useVoice();
  const [typing, setTyping] = useState(false);
  const [q, setQ] = useState("");
  const hasVoice = typeof window !== "undefined" && voiceAvailable();
  const heard = voice.done && voice.alternatives.length ? voice.alternatives : [];
  const matches = useMemo(() => {
    const seen = new Map<string, { project: Project; score: number }>();
    for (const alt of heard) for (const m of matchProjects(alt, projects)) if (!seen.has(m.project.id) || seen.get(m.project.id)!.score < m.score) seen.set(m.project.id, m);
    return [...seen.values()].sort((a, b) => b.score - a.score).slice(0, 3);
  }, [heard, projects]);
  const filtered = q.trim() ? projects.filter((p) => `${p.name} ${p.code ?? ""}`.toLowerCase().includes(q.trim().toLowerCase())) : projects;
  const ordered = [...filtered].sort((a, b) => rank(recent, a.id) - rank(recent, b.id) || a.name.localeCompare(b.name));

  return (
    <>
      <h1>{t("whichProject")}</h1>
      {hasVoice && !typing && (
        <>
          <button className={`mic${voice.listening ? " on" : ""}`} aria-label={t("holdToTalk")} onPointerDown={voice.start} onPointerUp={voice.stop} onPointerLeave={() => voice.listening && voice.stop()} onContextMenu={(e) => e.preventDefault()}>
            🎤
          </button>
          <div className="muted" style={{ textAlign: "center" }}>{voice.listening ? t("listening") : t("holdToTalk")}</div>
          {voice.done && heard.length > 0 && <div className="small muted" style={{ textAlign: "center" }}>{t("heard")}: “{heard[0]}”</div>}
          {voice.done && heard.length > 0 && matches.length === 0 && <div className="banner">{t("notHeard")}</div>}
          {matches.length > 0 && (
            <div className="choices">
              {matches.map((m, i) => (
                <button key={m.project.id} className={`choice${i === 0 ? " on" : ""}`} onClick={() => onPick(m.project.id)}>{m.project.name}</button>
              ))}
            </div>
          )}
        </>
      )}
      {(!hasVoice || typing) && projects.length > 6 && <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} autoFocus />}
      {(!hasVoice || typing || matches.length === 0) && (
        <div className="choices">
          {ordered.map((p) => (
            <button key={p.id} className={`choice${p.id === value ? " on" : ""}`} onClick={() => onPick(p.id)}>{p.name}</button>
          ))}
        </div>
      )}
      {hasVoice && !typing && <button className="linkbtn" onClick={() => setTyping(true)}>⌨️ {t("typeInstead")}</button>}
    </>
  );
}

function AmountStep({ value, onDone }: { value: string; onDone: (v: string) => void }) {
  const { t } = useApp();
  const voice = useVoice();
  const hasVoice = typeof window !== "undefined" && voiceAvailable();
  const [typed, setTyped] = useState(value);
  const spoken = voice.done ? voice.alternatives.map((a) => parseSpokenAmount(a)).find((n) => n !== null) ?? null : null;

  useEffect(() => {
    if (spoken !== null) setTyped((spoken / 100).toFixed(2));
  }, [spoken]);

  const h = parseAmount(typed);
  return (
    <>
      <h1>{t("howMuch")}</h1>
      <input className="amount" inputMode="decimal" placeholder="0.00" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus={!hasVoice} />
      {hasVoice && (
        <>
          <button className={`mic${voice.listening ? " on" : ""}`} aria-label={t("holdToTalk")} onPointerDown={voice.start} onPointerUp={voice.stop} onPointerLeave={() => voice.listening && voice.stop()} onContextMenu={(e) => e.preventDefault()}>
            🎤
          </button>
          <div className="muted" style={{ textAlign: "center" }}>{voice.listening ? t("listening") : `${t("holdToTalk")} (e.g. “two thousand three hundred”)`}</div>
          {voice.done && voice.transcript && spoken === null && <div className="banner">{t("notHeard")}</div>}
        </>
      )}
      <button className="bigbtn" disabled={h === null || h <= 0} onClick={() => onDone(typed)}>{t("next")} →</button>
    </>
  );
}
