"use client";

import { useMemo, useState } from "react";
import {
  detectStatement,
  findHeaderRow,
  parseStatement,
  type BankReportRow,
  type BankSection,
  type Cell,
  type ParsedStatement,
  type StatementMapping,
} from "@expresscash/shared";
import { useApp } from "@/lib/app-context";
import { supabase, must } from "@/lib/supabase";
import { readStatementFile } from "@/lib/statement-file";
import { RequireRole } from "@/components/shell";
import { ErrorText, Field, Money, useAction, useLoad } from "@/components/ui";

export default function BankPage() {
  return (
    <RequireRole roles={["admin", "accounts"]}>
      <Bank />
    </RequireRole>
  );
}

const SECTIONS: Array<{ key: BankSection; title: string; help: string; open?: boolean }> = [
  { key: "late", title: "Entered late", help: "In the bank and in the app, but the app entry was made after the bank date.", open: true },
  { key: "bank_only", title: "In the bank, not in the app", help: "Money moved on the card with no matching entry. Ask the card holder.", open: true },
  { key: "app_only", title: "In the app, not in the bank", help: "Card entries with no bank line yet. Usually wrong amount, wrong wallet, or not yet on the statement.", open: true },
  { key: "fee", title: "Bank fees and VAT on fees", help: "Charged by the bank. Not expected in the app." },
  { key: "matched", title: "Matched", help: "Same amount, within the date window, entered on time." },
];

interface Loaded {
  file: string;
  rows: Cell[][];
  mapping: StatementMapping;
  headerRow: number;
  fromSaved: boolean;
}

function Bank() {
  const { lookups, profile, reloadLookups } = useApp();
  const wallets = lookups.wallets;
  const [walletId, setWalletId] = useState(wallets[0]?.id ?? "");
  const wallet = wallets.find((w) => w.id === walletId);
  const bank = wallet?.bank_name || "Other";
  const saved = (lookups.settings.bank_mapping as Record<string, StatementMapping> | undefined)?.[bank];
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const action = useAction();

  const report = useLoad(async () => (walletId ? (must(await supabase().rpc("bank_report", { p_wallet_id: walletId })) as BankReportRow[]) : []), [walletId]);

  const parsed: ParsedStatement | null = useMemo(
    () => (loaded ? parseStatement(loaded.rows, loaded.mapping, loaded.headerRow) : null),
    [loaded],
  );

  async function onFile(f: File | undefined) {
    if (!f) return;
    setResult(null);
    await action.run(async () => {
      const sheets = await readStatementFile(f);
      for (const s of sheets) {
        if (saved) {
          const hr = findHeaderRow(s.rows, saved);
          if (hr >= 0) return setLoaded({ file: f.name, rows: s.rows, mapping: saved, headerRow: hr, fromSaved: true });
        }
        const d = detectStatement(s.rows);
        if (d) return setLoaded({ file: f.name, rows: s.rows, mapping: d.mapping, headerRow: d.headerRow, fromSaved: false });
      }
      throw new Error("Couldn't find the transactions table in this file. Is it the Excel export from the bank?");
    });
  }

  async function upload() {
    if (!loaded || !parsed || !wallet) return;
    const r = await action.run(async () => {
      const res = must(await supabase().rpc("import_bank_lines", { p_wallet_id: wallet.id, p_file_name: loaded.file, p_lines: parsed.lines })) as {
        lines: number; new_lines: number; matched: number;
      };
      if (profile?.role === "admin" && !loaded.fromSaved) {
        const all = { ...((lookups.settings.bank_mapping as object) ?? {}), [bank]: loaded.mapping };
        must(await supabase().from("settings").upsert({ key: "bank_mapping", value: all, updated_at: new Date().toISOString() }).select());
        reloadLookups();
      }
      return res;
    });
    if (r) {
      setResult(`${r.lines} lines read, ${r.new_lines} new (the rest were already uploaded), ${r.matched} matched to app entries.`);
      setLoaded(null);
      report.reload();
    }
  }

  const setMap = (patch: Partial<StatementMapping>) => loaded && setLoaded({ ...loaded, mapping: { ...loaded.mapping, ...patch }, fromSaved: false });
  const headers = loaded ? loaded.rows[loaded.headerRow].map((c) => String(c ?? "").replace(/\s+/g, " ").trim()).filter(Boolean) : [];
  const uniq = [...new Set(headers)];
  const rows = report.data ?? [];
  const by = (k: BankSection) => rows.filter((r) => r.section === k);

  return (
    <>
      <h1>Bank statements</h1>
      <p className="muted">Upload the card&apos;s Excel statement from Alinma or SNB. Each bank line is matched to the app: same amount, close date.</p>
      <div className="toolbar">
        <Field label="Wallet">
          <select value={walletId} onChange={(e) => (setWalletId(e.target.value), setLoaded(null), setResult(null))}>
            {wallets.map((w) => (
              <option key={w.id} value={w.id}>{w.name}{w.card_last4 ? ` •••• ${w.card_last4}` : ""} · {w.bank_name || "Other"}</option>
            ))}
          </select>
        </Field>
        <Field label="Statement file (.xlsx)">
          <input type="file" accept=".xlsx" onChange={(e) => onFile(e.target.files?.[0])} />
        </Field>
      </div>
      <ErrorText error={action.error || report.error} />
      {result && <div className="notice">✓ {result}</div>}

      {loaded && parsed && (
        <div className="panel" style={{ marginBottom: 18 }}>
          <h2 style={{ marginTop: 0 }}>Check the columns</h2>
          <p className="muted small">
            {loaded.fromSaved ? `Using the saved ${bank} layout.` : `Detected automatically.${profile?.role === "admin" ? ` It will be saved as the ${bank} layout on upload.` : ""}`}
          </p>
          <div className="form-grid">
            <Field label="Date">
              <ColSelect value={loaded.mapping.date} options={uniq} onChange={(v) => setMap({ date: v ?? "" })} />
            </Field>
            <Field label="Money out (debit)">
              <ColSelect value={loaded.mapping.debit} options={uniq} none onChange={(v) => setMap({ debit: v, amount: undefined })} />
            </Field>
            <Field label="Money in (credit)">
              <ColSelect value={loaded.mapping.credit} options={uniq} none onChange={(v) => setMap({ credit: v, amount: undefined })} />
            </Field>
            <Field label="Description">
              <ColSelect value={loaded.mapping.description[0]} options={uniq} none onChange={(v) => setMap({ description: v ? [v] : [] })} />
            </Field>
          </div>
          <p>
            <strong>{parsed.lines.length}</strong> transactions
            {parsed.lines.length > 0 && <> from {parsed.lines[0].date} to {parsed.lines[parsed.lines.length - 1].date}</>}
            {parsed.skipped > 0 && <span className="muted"> · {parsed.skipped} rows without a date or amount skipped</span>}
          </p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Description</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {parsed.lines.slice(0, 5).map((l, i) => (
                  <tr key={i}><td>{l.date}</td><td>{l.description}</td><td className="num"><Money value={l.amount} direction={l.amount < 0 ? "out" : "in"} /></td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="toolbar" style={{ marginTop: 12 }}>
            <button className="primary" disabled={action.busy || parsed.lines.length === 0} onClick={upload}>Upload and match {parsed.lines.length} lines</button>
            <button onClick={() => setLoaded(null)}>Cancel</button>
          </div>
        </div>
      )}

      {SECTIONS.map((s) => {
        const list = by(s.key);
        if (s.key !== "matched" && s.key !== "fee" && list.length === 0) return null;
        return (
          <details key={s.key} open={s.open && list.length > 0} className="bank-section">
            <summary>
              <h2 style={{ display: "inline" }}>{s.title} <span className="section-count">{list.length}</span></h2>
            </summary>
            <p className="muted small">{s.help}</p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{s.key === "app_only" ? "Entry date" : "Bank date"}</th>
                    <th>Description</th>
                    <th className="num">Amount</th>
                    {(s.key === "late" || s.key === "matched") && <th>Entered in app</th>}
                    {(s.key === "late" || s.key === "bank_only") && <th>Explained</th>}
                  </tr>
                </thead>
                <tbody>
                  {list.map((r, i) => (
                    <tr key={r.line_id ?? `${r.ref_id}-${i}`} className={r.resolved ? "muted" : undefined}>
                      <td>{r.entry_date}</td>
                      <td>{r.description}</td>
                      <td className="num"><Money value={r.amount} direction={Number(r.amount) < 0 ? "out" : "in"} /></td>
                      {(s.key === "late" || s.key === "matched") && (
                        <td>
                          {r.entered_on}
                          {r.days_late ? <span className="chip red">{r.days_late} day{r.days_late === 1 ? "" : "s"} late</span> : null}
                        </td>
                      )}
                      {(s.key === "late" || s.key === "bank_only") && r.line_id && (
                        <td><Resolve row={r} onDone={report.reload} /></td>
                      )}
                    </tr>
                  ))}
                  {list.length === 0 && <tr><td colSpan={5} className="muted">None.</td></tr>}
                </tbody>
              </table>
            </div>
          </details>
        );
      })}
      {report.data && rows.length === 0 && <p className="muted">No statement uploaded for this wallet yet.</p>}
    </>
  );
}

function ColSelect({ value, options, onChange, none }: { value?: string; options: string[]; onChange: (v: string | undefined) => void; none?: boolean }) {
  return (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)}>
      {none && <option value="">(none)</option>}
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function Resolve({ row, onDone }: { row: BankReportRow; onDone: () => void }) {
  const [note, setNote] = useState(row.note ?? "");
  const action = useAction();
  async function set(resolved: boolean) {
    const ok = await action.run(async () => must(await supabase().rpc("resolve_bank_line", { p_id: row.line_id, p_resolved: resolved, p_note: note })));
    if (ok) onDone();
  }
  if (row.resolved) {
    return (
      <span className="small">
        ✓ {row.note || "Explained"} <button className="linkbtn small" onClick={() => set(false)}>Undo</button>
      </span>
    );
  }
  return (
    <span style={{ display: "flex", gap: 6 }}>
      <input placeholder="What happened?" value={note} onChange={(e) => setNote(e.target.value)} style={{ minWidth: 140 }} />
      <button disabled={action.busy || !note.trim()} onClick={() => set(true)}>Explained</button>
    </span>
  );
}
