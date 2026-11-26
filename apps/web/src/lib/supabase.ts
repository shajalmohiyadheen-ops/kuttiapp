"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/** Browser Supabase client. Every query runs as the signed-in user, so row level security decides what they see. */
export function supabase(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (see apps/web/.env.example)");
    client = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });
  }
  return client;
}

/** Throws the PostgREST error message so callers can show it. */
export function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export async function signedUrl(bucket: "invoices" | "attachments", path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const { data } = await supabase().storage.from(bucket).createSignedUrl(path, 60 * 10);
  return data?.signedUrl ?? null;
}

/**
 * Calls `onChange` whenever an expense or transfer the user can see is added or
 * changed by anyone (Supabase Realtime), so lists update without a refresh.
 */
export function subscribeLive(onChange: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const debounced = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(onChange, 400);
  };
  const channel = supabase()
    .channel(`live-${Math.random().toString(36).slice(2)}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "expenses" }, debounced)
    .on("postgres_changes", { event: "*", schema: "public", table: "topups" }, debounced)
    .on("postgres_changes", { event: "*", schema: "public", table: "cash_moves" }, debounced)
    .subscribe();
  return () => {
    if (timer) clearTimeout(timer);
    supabase().removeChannel(channel);
  };
}
