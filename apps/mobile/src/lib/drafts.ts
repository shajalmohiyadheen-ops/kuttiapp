// Offline drafts. An expense is saved on the phone first (with its photo copied
// into the app's document folder), then sent when there is a connection.
// Each draft carries a client_id; the database has a unique index on it, so a
// draft that was sent but whose response was lost is never recorded twice.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Directory, File, Paths } from "expo-file-system";
import { randomUUID } from "expo-crypto";
import { invoicePath } from "@kuttiapp/shared";
import { supabase } from "./supabase";

const KEY = "kutti.drafts.v1";

export interface Draft {
  client_id: string;
  wallet_id: string;
  project_id: string;
  category_id: string;
  expense_date: string;
  amount: string; // decimal string "123.45"
  vat_amount: string;
  vendor: string;
  vendor_vat_number: string;
  invoice_number: string;
  description: string;
  photo_uri: string | null; // local file in the drafts folder
  saved_at: string;
  last_error?: string;
}

function draftsDir(): Directory {
  const dir = new Directory(Paths.document, "drafts");
  if (!dir.exists) dir.create({ idempotent: true, intermediates: true });
  return dir;
}

export async function listDrafts(): Promise<Draft[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Draft[]) : [];
  } catch {
    return [];
  }
}

async function writeDrafts(drafts: Draft[]) {
  await AsyncStorage.setItem(KEY, JSON.stringify(drafts));
}

/** Copies a picked/captured photo into permanent app storage so it survives until the draft is sent. */
export async function keepPhoto(uri: string): Promise<string> {
  const src = new File(uri);
  const ext = (src.extension || ".jpg").replace(/^\./, "") || "jpg";
  const dest = new File(draftsDir(), `${randomUUID()}.${ext}`);
  await src.copy(dest);
  return dest.uri;
}

export async function saveDraft(d: Omit<Draft, "client_id" | "saved_at"> & { client_id?: string }): Promise<Draft> {
  const drafts = await listDrafts();
  const draft: Draft = { ...d, client_id: d.client_id ?? randomUUID(), saved_at: new Date().toISOString() };
  const i = drafts.findIndex((x) => x.client_id === draft.client_id);
  if (i >= 0) drafts[i] = draft;
  else drafts.push(draft);
  await writeDrafts(drafts);
  return draft;
}

export async function removeDraft(clientId: string, deletePhoto = true) {
  const drafts = await listDrafts();
  const d = drafts.find((x) => x.client_id === clientId);
  if (d?.photo_uri && deletePhoto) {
    try {
      const f = new File(d.photo_uri);
      if (f.exists) f.delete();
    } catch {}
  }
  await writeDrafts(drafts.filter((x) => x.client_id !== clientId));
}

function contentType(uri: string): string {
  const ext = uri.split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "heic") return "image/heic";
  if (ext === "pdf") return "application/pdf";
  return "image/jpeg";
}

/** Uploads the photo (if any) and inserts the expense. Returns the new expense id. */
export async function sendDraft(d: Draft, userId: string): Promise<string> {
  let path: string | null = null;
  if (d.photo_uri) {
    const ext = d.photo_uri.split(".").pop()?.toLowerCase() || "jpg";
    // Deterministic per draft so a retry overwrites instead of leaving orphans.
    path = invoicePath(userId, d.client_id, new Date(d.expense_date), ext);
    const body = await new File(d.photo_uri).arrayBuffer();
    const up = await supabase.storage.from("invoices").upload(path, body, { contentType: contentType(d.photo_uri), upsert: true });
    if (up.error) throw new Error(up.error.message);
  }
  const row = {
    client_id: d.client_id,
    wallet_id: d.wallet_id,
    project_id: d.project_id,
    category_id: d.category_id,
    expense_date: d.expense_date,
    amount: d.amount,
    vat_amount: d.vat_amount || "0",
    vendor: d.vendor.trim(),
    vendor_vat_number: d.vendor_vat_number.trim() || null,
    invoice_number: d.invoice_number.trim() || null,
    description: d.description.trim() || null,
    invoice_path: path,
  };
  const ins = await supabase.from("expenses").insert(row).select("id").single();
  if (ins.error) {
    // Already sent earlier (response lost): treat as success.
    if (ins.error.code === "23505" && ins.error.message.includes("client_id")) {
      const existing = await supabase.from("expenses").select("id").eq("client_id", d.client_id).single();
      if (existing.data) return existing.data.id as string;
    }
    throw new Error(ins.error.message);
  }
  return ins.data.id as string;
}

/** Sends every queued draft. Keeps the ones that fail, with the error, so the user can fix them. */
export async function syncDrafts(userId: string): Promise<{ sent: number; failed: number }> {
  const drafts = await listDrafts();
  let sent = 0;
  let failed = 0;
  for (const d of drafts) {
    try {
      await sendDraft(d, userId);
      await removeDraft(d.client_id);
      sent++;
    } catch (e) {
      failed++;
      await saveDraft({ ...d, last_error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { sent, failed };
}

export function isNetworkError(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /network|fetch|timed? ?out|offline|failed to connect/i.test(m);
}

/**
 * Saves the expense on the phone, then tries to send it straight away.
 * "sent": recorded on the server. "queued": kept as a draft (offline), sent later.
 * Throws for errors the person must fix (e.g. missing invoice); the draft is kept.
 */
export async function saveAndSend(form: Omit<Draft, "client_id" | "saved_at">, userId: string, online: boolean, clientId?: string): Promise<{ result: "sent" | "queued"; draft: Draft }> {
  const draft = await saveDraft({ ...form, client_id: clientId });
  if (!online) return { result: "queued", draft };
  try {
    await sendDraft(draft, userId);
    await removeDraft(draft.client_id);
    return { result: "sent", draft };
  } catch (e) {
    if (isNetworkError(e)) return { result: "queued", draft };
    await saveDraft({ ...draft, last_error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

const RECENT_KEY = "kutti.recent.v1";
export interface RecentChoices {
  projects: string[];
  category: string | null;
  wallet: string | null;
}
export async function getRecent(): Promise<RecentChoices> {
  try {
    const raw = await AsyncStorage.getItem(RECENT_KEY);
    if (raw) return JSON.parse(raw) as RecentChoices;
  } catch {}
  return { projects: [], category: null, wallet: null };
}
export async function rememberChoices(projectId: string, categoryId: string, walletId: string) {
  const r = await getRecent();
  const projects = [projectId, ...r.projects.filter((p) => p !== projectId)].slice(0, 4);
  await AsyncStorage.setItem(RECENT_KEY, JSON.stringify({ projects, category: categoryId, wallet: walletId })).catch(() => {});
}
