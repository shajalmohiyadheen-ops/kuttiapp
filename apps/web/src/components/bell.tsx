"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { AttentionFlag } from "@expresscash/shared";
import { supabase, must } from "@/lib/supabase";
import { useLive } from "./ui";

export interface BellItem {
  id: string;
  icon: string;
  text: string;
  href?: string;
  tone?: "warn" | "bad";
}

const ICON: Record<AttentionFlag["kind"], string> = { cash_held: "💵", late_entry: "⏰", bank_only: "🏦", negative: "⏳" };

/** Turns the database's warnings into bell items; `staff` points links at the phone screens. */
export function flagItems(flags: AttentionFlag[], staff = false): BellItem[] {
  return flags.map((f, i) => ({
    id: `${f.kind}-${f.wallet_id}-${i}`,
    icon: ICON[f.kind],
    text: f.message,
    tone: f.kind === "cash_held" || f.kind === "negative" ? "warn" : "bad",
    href: staff
      ? f.kind === "cash_held" ? "/app/cash?kind=return" : undefined
      : f.kind === "cash_held" ? "/cash" : f.kind === "negative" ? "/topups" : `/bank?wallet=${f.wallet_id}`,
  }));
}

/** The warnings for whoever is signed in (all wallets for finance, own wallet for staff), kept live. */
export function useFlags(): AttentionFlag[] {
  const [flags, setFlags] = useState<AttentionFlag[]>([]);
  const load = async () => {
    try {
      setFlags(must(await supabase().rpc("attention_flags")) as AttentionFlag[]);
    } catch {
      /* offline: keep the last list */
    }
  };
  useEffect(() => void load(), []);
  useLive(load);
  return flags;
}

/** Bell with a count; tapping it drops down the list. */
export function Bell({ items, empty = "Nothing needs attention" }: { items: BellItem[]; empty?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => (document.removeEventListener("mousedown", close), document.removeEventListener("keydown", esc));
  }, [open]);
  return (
    <div className="bell" ref={ref}>
      <button className="bell-btn" aria-label={`Notifications: ${items.length}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path fill="currentColor" d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z" />
        </svg>
        {items.length > 0 && <span className="bell-count">{items.length > 99 ? "99+" : items.length}</span>}
      </button>
      {open && (
        <div className="bell-menu" role="menu">
          <div className="bell-head">Notifications</div>
          {items.length === 0 && <div className="bell-empty">{empty}</div>}
          {items.map((it) => {
            const body = (
              <>
                <span className="bell-icon">{it.icon}</span>
                <span>{it.text}</span>
              </>
            );
            return it.href ? (
              <Link key={it.id} href={it.href} className={`bell-item ${it.tone ?? ""}`} onClick={() => setOpen(false)}>{body}</Link>
            ) : (
              <div key={it.id} className={`bell-item ${it.tone ?? ""}`}>{body}</div>
            );
          })}
        </div>
      )}
    </div>
  );
}
