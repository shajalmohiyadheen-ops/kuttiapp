"use client";

// Expenses saved on the phone before they reach the server (no signal on site).
// Kept in IndexedDB with the photo, sent as soon as the phone is back online.
// client_id makes a resend safe: the server refuses a duplicate.

import { invoicePath, type PaymentMethod } from "@expresscash/shared";
import { supabase } from "./supabase";

export interface Draft {
  client_id: string;
  saved_at: string;
  wallet_id: string;
  project_id: string;
  category_id: string;
  paid_by: PaymentMethod;
  expense_date: string;
  period_month: string;
  amount: string;
  vat_amount: string;
  vendor: string;
  vendor_vat_number: string;
  invoice_number: string;
  description: string;
  photo: Blob | null;
  last_error?: string;
}

const DB = "express-cash";
const STORE = "drafts";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "client_id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(r.result);
    t.onerror = () => reject(t.error);
  });
}

export async function listDrafts(): Promise<Draft[]> {
  try {
    const all = await tx<Draft[]>("readonly", (s) => s.getAll() as IDBRequest<Draft[]>);
    return all.sort((a, b) => a.saved_at.localeCompare(b.saved_at));
  } catch {
    return [];
  }
}

export async function putDraft(d: Draft): Promise<void> {
  await tx("readwrite", (s) => s.put(d));
}

export async function removeDraft(clientId: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(clientId));
}

export function isNetworkError(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /network|fetch|timed? ?out|offline|failed to connect|load failed/i.test(m);
}

/** Uploads the photo (if any) and inserts the expense. */
export async function sendDraft(d: Draft, userId: string): Promise<void> {
  const sb = supabase();
  let path: string | null = null;
  if (d.photo) {
    const ext = d.photo.type === "application/pdf" ? "pdf" : "jpg";
    // deterministic per draft, so a retry overwrites instead of leaving an orphan file
    path = invoicePath(userId, d.client_id, new Date(d.expense_date), ext);
    const up = await sb.storage.from("invoices").upload(path, d.photo, { contentType: d.photo.type || "image/jpeg", upsert: true });
    if (up.error) throw new Error(up.error.message);
  }
  const ins = await sb.from("expenses").insert({
    client_id: d.client_id,
    wallet_id: d.wallet_id,
    project_id: d.project_id,
    category_id: d.category_id,
    paid_by: d.paid_by,
    expense_date: d.expense_date,
    period_month: d.period_month,
    amount: d.amount,
    vat_amount: d.vat_amount || "0",
    vendor: d.vendor.trim(),
    vendor_vat_number: d.vendor_vat_number.trim() || null,
    invoice_number: d.invoice_number.trim() || null,
    description: d.description.trim() || null,
    invoice_path: path,
  });
  if (ins.error) {
    // already sent earlier (the reply was lost): that's a success
    if (ins.error.code === "23505" && ins.error.message.includes("client_id")) return;
    throw new Error(ins.error.message);
  }
}

/** Saves on the phone first, then sends. "queued" means it's safe on the phone and goes later. */
export async function saveAndSend(d: Draft, userId: string): Promise<"sent" | "queued"> {
  await putDraft(d);
  if (typeof navigator !== "undefined" && !navigator.onLine) return "queued";
  try {
    await sendDraft(d, userId);
    await removeDraft(d.client_id);
    return "sent";
  } catch (e) {
    if (isNetworkError(e)) return "queued";
    await putDraft({ ...d, last_error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

/** Sends every waiting draft; keeps failures with their error so the person can fix them. */
export async function syncDrafts(userId: string): Promise<{ sent: number; failed: number }> {
  let sent = 0, failed = 0;
  for (const d of await listDrafts()) {
    try {
      await sendDraft(d, userId);
      await removeDraft(d.client_id);
      sent++;
    } catch (e) {
      failed++;
      if (!isNetworkError(e)) await putDraft({ ...d, last_error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { sent, failed };
}

const RECENT = "xc.recent.v2";
export function recentChoices(): { projects: string[]; categories: string[]; paid_by: PaymentMethod | null } {
  try {
    return { projects: [], categories: [], paid_by: null, ...JSON.parse(localStorage.getItem(RECENT) || "{}") };
  } catch {
    return { projects: [], categories: [], paid_by: null };
  }
}
export function rememberChoices(projectId: string, categoryId: string, paidBy: PaymentMethod) {
  const r = recentChoices();
  const bump = (list: string[], id: string) => [id, ...list.filter((x) => x !== id)].slice(0, 4);
  try {
    localStorage.setItem(RECENT, JSON.stringify({ projects: bump(r.projects, projectId), categories: bump(r.categories, categoryId), paid_by: paidBy }));
  } catch {}
}
