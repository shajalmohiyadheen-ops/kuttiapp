"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { formatSar, parseAmount, toDecimalString, type CashMoveKind, type WalletBalance } from "@expresscash/shared";
import { useApp } from "@/lib/app-context";
import { supabase, must } from "@/lib/supabase";
import { Wordmark, today } from "@/components/ui";

export default function CashPage() {
  return (
    <Suspense>
      <CashMoveForm />
    </Suspense>
  );
}

/**
 * Cash taken out of the card, or cash given back. Withdrawals are entered the same day; the bank
 * statement upload later flags any that were entered late.
 */
function CashMoveForm() {
  const { t, profile } = useApp();
  const router = useRouter();
  const isReturn = useSearchParams().get("kind") === "return";
  const [wallet, setWallet] = useState<WalletBalance | null>(null);
  const [kind, setKind] = useState<CashMoveKind>(isReturn ? "deposit" : "withdrawal");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!profile) return;
    (async () => {
      try {
        const r = await supabase().from("wallet_balances").select("*").eq("custodian_id", profile.id).eq("active", true).maybeSingle();
        setWallet(must(r) as WalletBalance | null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [profile]);

  const inHand = Number(wallet?.cash_in_hand ?? 0);
  const halalas = parseAmount(amount);
  const late = date < today();
  const tooMuch = kind !== "withdrawal" && halalas !== null && halalas > Math.round(inHand * 100);

  async function save() {
    setError(null);
    if (!wallet) return setError("No wallet is assigned to you.");
    if (!halalas || halalas <= 0) return setError(t("invalidAmount"));
    if (kind !== "withdrawal" && !notes.trim() && kind === "handover") return setError("Say who you handed the cash to.");
    if (!navigator.onLine) return setError("You are offline. Cash entries need a connection; try again when you are back online.");
    setBusy(true);
    try {
      must(await supabase().from("cash_moves").insert({
        client_id: crypto.randomUUID(),
        wallet_id: wallet.wallet_id,
        kind,
        amount: toDecimalString(halalas),
        move_date: date,
        notes: notes.trim() || null,
      }));
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="phone">
        <header><Wordmark /></header>
        <div className="card" style={{ textAlign: "center", display: "grid", gap: 8 }}>
          <div style={{ fontSize: 48 }}>✓</div>
          <strong>{kind === "withdrawal" ? "Withdrawal saved" : "Return saved"}</strong>
          <div className="muted">{formatSar(halalas ?? 0, { halalas: true })}</div>
        </div>
        <button className="bigbtn" onClick={() => router.push("/app")}>Done</button>
      </div>
    );
  }

  return (
    <div className="phone">
      <header>
        <Wordmark />
        <button className="linkbtn" onClick={() => router.push("/app")}>✕</button>
      </header>
      <h1>{isReturn ? `↩ ${t("returnCash")}` : `🏧 ${t("cashWithdrawal")}`}</h1>
      <div className="muted">
        {t("cashInHand")}: <b>{wallet ? formatSar(inHand) : "…"}</b>
      </div>

      {isReturn && (
        <div className="choices">
          <button className={`choice${kind === "deposit" ? " on" : ""}`} onClick={() => setKind("deposit")}>
            💳 Put back on the card
            <div className="small">Deposited at an ATM or branch. Your wallet total stays the same.</div>
          </button>
          <button className={`choice${kind === "handover" ? " on" : ""}`} onClick={() => setKind("handover")}>
            🏢 Handed to the office
            <div className="small">Given to accounts in person. Your wallet total goes down.</div>
          </button>
        </div>
      )}

      <label className="field">
        {t("amount")}
        <input className="amount" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      {isReturn && inHand > 0 && (
        <button className="linkbtn" style={{ justifySelf: "start" }} onClick={() => setAmount(inHand.toFixed(2))}>All of it ({formatSar(inHand)})</button>
      )}
      {tooMuch && <div className="banner">That is more than the cash in hand the app shows. Check the amount.</div>}

      <label className="field">
        {t("date")}
        <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
      </label>
      {kind === "withdrawal" && (
        late ? (
          <div className="banner warn">⚠ Withdrawals should be entered the same day. This one will be marked as entered late.</div>
        ) : (
          <div className="muted small">Enter every withdrawal on the day you take it out. Spend cash within 4 days or return it.</div>
        )
      )}

      <label className="field">
        {kind === "handover" ? "Handed to (name)" : t("notes")}
        <input value={notes} placeholder={kind === "handover" ? "e.g. Rafeeq, accounts" : "Optional"} onChange={(e) => setNotes(e.target.value)} />
      </label>

      {error && <div className="banner" style={{ color: "var(--danger)" }}>{error}</div>}
      <button className="bigbtn" disabled={busy || !wallet} onClick={save}>{busy ? "Saving…" : t("save")}</button>
    </div>
  );
}
