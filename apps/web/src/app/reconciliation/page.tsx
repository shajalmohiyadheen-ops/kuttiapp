"use client";

import { useState } from "react";
import { fromDb, parseAmount, toDecimalString, type StatementCheck, type WalletBalance } from "@expresscash/shared";
import { useApp } from "@/lib/app-context";
import { supabase, must } from "@/lib/supabase";
import { RequireRole } from "@/components/shell";
import { ErrorText, Field, Money, fmtDateTime, today, useAction, useLoad } from "@/components/ui";

export default function ReconciliationPage() {
  return (
    <RequireRole roles={["admin"]}>
      <Reconciliation />
    </RequireRole>
  );
}

function Reconciliation() {
  const { t, name } = useApp();
  const balances = useLoad(async () => must(await supabase().from("wallet_balances").select("*").eq("active", true).order("name")) as WalletBalance[], []);
  const checks = useLoad(
    async () => must(await supabase().from("statement_checks").select("*").order("statement_date", { ascending: false }).order("created_at", { ascending: false }).limit(200)) as StatementCheck[],
    [],
  );
  const [walletId, setWalletId] = useState("");
  const [date, setDate] = useState(today());
  const [stmt, setStmt] = useState("");
  const [notes, setNotes] = useState("");
  const action = useAction();
  const latest = new Map<string, StatementCheck>();
  for (const c of checks.data ?? []) if (!latest.has(c.wallet_id)) latest.set(c.wallet_id, c);

  async function record() {
    const h = parseAmount(stmt);
    if (!walletId) return action.setError(`${t("wallet")}: ${t("required")}`);
    if (h === null) return action.setError(t("invalidAmount"));
    const ok = await action.run(async () =>
      must(await supabase().rpc("record_statement_check", { p_wallet_id: walletId, p_statement_date: date, p_statement_balance: toDecimalString(h), p_notes: notes || null })),
    );
    if (ok) {
      setStmt("");
      setNotes("");
      checks.reload();
    }
  }

  return (
    <>
      <h1>{t("reconciliation")}</h1>
      <div className="notice">
        Optional. Express Cash calculates each wallet: brought forward + transfers in − every saved expense (card and cash). When you get a card statement,
        you can note its balance here. The wallet includes cash the holder has withdrawn but not spent yet, so a difference is normal while cash is in hand;
        anything beyond that is a missing or mistyped entry.
      </div>

      <div className="panel">
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <Field label={t("wallet")}>
            <select value={walletId} onChange={(e) => setWalletId(e.target.value)}>
              <option value="" />
              {(balances.data ?? []).map((b) => (
                <option key={b.wallet_id} value={b.wallet_id}>{b.name}</option>
              ))}
            </select>
          </Field>
          <Field label={`Statement ${t("date")}`}>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={`${t("statementBalance")} (SAR)`}>
            <input inputMode="decimal" value={stmt} onChange={(e) => setStmt(e.target.value)} />
          </Field>
          <Field label={t("notes")}>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <button className="primary" disabled={action.busy} onClick={record}>{t("recordCheck")}</button>
        </div>
        <ErrorText error={action.error} />
      </div>

      <h2>{t("wallets")}</h2>
      <ErrorText error={balances.error || checks.error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("wallet")}</th>
              <th className="num">{t("calculatedBalance")} (now)</th>
              <th>Last check</th>
              <th className="num">{t("statementBalance")}</th>
              <th className="num">{t("difference")}</th>
            </tr>
          </thead>
          <tbody>
            {(balances.data ?? []).map((b) => {
              const c = latest.get(b.wallet_id);
              return (
                <tr key={b.wallet_id}>
                  <td>{b.name}</td>
                  <td className="num"><Money value={b.available_balance} /></td>
                  <td>{c ? c.statement_date : <span className="muted">Never</span>}</td>
                  <td className="num">{c ? <Money value={c.statement_balance} /> : "—"}</td>
                  <td className="num">{c ? <Diff value={c.difference} /> : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2>{t("history")}</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Statement {t("date")}</th>
              <th>{t("wallet")}</th>
              <th className="num">{t("statementBalance")}</th>
              <th className="num">{t("calculatedBalance")}</th>
              <th className="num">{t("difference")}</th>
              <th>{t("notes")}</th>
              <th>Recorded</th>
            </tr>
          </thead>
          <tbody>
            {(checks.data ?? []).map((c) => (
              <tr key={c.id}>
                <td>{c.statement_date}</td>
                <td>{name("wallets", c.wallet_id)}</td>
                <td className="num"><Money value={c.statement_balance} /></td>
                <td className="num"><Money value={c.calculated_balance} /></td>
                <td className="num"><Diff value={c.difference} /></td>
                <td>{c.notes}</td>
                <td className="small muted">{fmtDateTime(c.created_at)}</td>
              </tr>
            ))}
            {checks.data?.length === 0 && (
              <tr><td colSpan={7} className="muted">{t("noData")}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Diff({ value }: { value: string | number }) {
  const { t } = useApp();
  const zero = fromDb(value) === 0;
  return zero ? <span className="badge checked">{t("matched")}</span> : <strong className="neg"><Money value={value} /></strong>;
}
