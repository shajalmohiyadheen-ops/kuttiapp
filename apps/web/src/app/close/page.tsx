"use client";

import { useState } from "react";
import { monthLabel, type ClosedMonth, type Expense, type MonthOverview, type Topup, type WalletBalance } from "@kuttiapp/shared";
import { useApp } from "@/lib/app-context";
import { supabase, must } from "@/lib/supabase";
import { downloadZip } from "@/lib/export";
import { buildWorkbook, standardSheets } from "@/lib/workbook";
import { RequireRole } from "@/components/shell";
import { invoiceFileName } from "@/components/expenses";
import { ErrorText, Field, Modal, Money, fmtDateTime, useAction, useLive, useLoad } from "@/components/ui";

export default function ClosePage() {
  return (
    <RequireRole roles={["admin", "accounts"]}>
      <Close />
    </RequireRole>
  );
}

/** Builds the month's Excel + every bill and transfer proof into one zip, downloads it, and records the export. */
async function exportMonth(month: string, lookups: ReturnType<typeof useApp>["lookups"], onProgress: (s: string) => void): Promise<void> {
  const sb = supabase();
  const [ex, tx, bal] = await Promise.all([
    sb.from("expenses").select("*").eq("period_month", month).order("expense_date"),
    sb.from("topups").select("*").eq("period_month", month).order("transfer_date"),
    sb.from("wallet_balances").select("*").order("name"),
  ]);
  const expenses = must(ex) as Expense[];
  const topups = must(tx) as Topup[];
  const tag = month.slice(0, 7);
  const xlsx = await buildWorkbook(
    standardSheets({
      title: `Month ${monthLabel(month)} · exported ${new Date().toLocaleString("en-GB")}`,
      expenses: expenses as unknown as Array<Record<string, unknown>>,
      topups: topups as unknown as Array<Record<string, unknown>>,
      balances: must(bal) as WalletBalance[] as unknown as Array<Record<string, unknown>>,
      ...lookups,
      invoiceName: (e) => `bills/${invoiceFileName(e as unknown as Expense)}`,
    }),
  );
  const files = [
    ...expenses.filter((e) => e.invoice_path).map((e) => ({ bucket: "invoices" as const, path: e.invoice_path!, name: `bills/${invoiceFileName(e)}` })),
    ...topups
      .filter((t) => t.attachment_path)
      .map((t) => ({ bucket: "attachments" as const, path: t.attachment_path!, name: `transfers/${t.transfer_date}_${t.external_id}.${t.attachment_path!.split(".").pop()}` })),
  ];
  const count = await downloadZip(`kuttiapp-${tag}`, files, [{ name: `kuttiapp-${tag}.xlsx`, data: xlsx }], (d, n) => onProgress(`Downloading files ${d} of ${n}…`));
  must(await sb.rpc("record_month_export", { p_month: month, p_file_count: count }));
}

function Close() {
  const { t, lookups, profile, name } = useApp();
  const months = useLoad(async () => must(await supabase().rpc("month_overview")) as MonthOverview[], []);
  const closed = useLoad(async () => must(await supabase().from("closed_months").select("*").order("month", { ascending: false })) as ClosedMonth[], []);
  useLive(months.reload);
  const [progress, setProgress] = useState("");
  const [closing, setClosing] = useState<MonthOverview | null>(null);
  const action = useAction();
  const isAdmin = profile?.role === "admin";
  const thisMonth = new Date().toISOString().slice(0, 7);
  const rows = months.data ?? [];
  const oldest = [...rows].reverse().find((m) => m.month.slice(0, 7) < thisMonth);

  async function doExport(m: MonthOverview) {
    await action.run(() => exportMonth(m.month, lookups, setProgress));
    setProgress("");
    months.reload();
  }

  return (
    <>
      <h1>{t("closeMonth")}</h1>
      <div className="notice">
        <strong>How it works.</strong> At the end of a month, after accounts has tallied it: 1) <strong>Download</strong> the month, one zip with the Excel and every
        bill photo, ready to upload to Odoo. Keep that zip safe; it is the only copy after the month is erased. 2) An admin <strong>closes</strong> the month: its
        entries and photos are erased, and each wallet&apos;s balance is carried forward so nothing changes for staff. Months are closed oldest first, and the
        current month can&apos;t be closed. Staff can enter expenses for the last {lookups.settings.retention_months as number ?? 5} months.
      </div>
      <ErrorText error={months.error || action.error} />
      {progress && <p className="muted">{progress}</p>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("month")}</th>
              <th className="num">{t("expenses")}</th>
              <th className="num">{t("spent")}</th>
              <th className="num">{t("topups")}</th>
              <th className="num">Files</th>
              <th className="num">{t("unchecked")}</th>
              <th>Downloaded</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const isCurrent = m.month.slice(0, 7) === thisMonth;
              return (
                <tr key={m.month}>
                  <td>
                    <strong>{monthLabel(m.month)}</strong>
                    {isCurrent && <div className="small muted">This month</div>}
                    {!m.accepts_entries && <div className="small warn-text">Outside the open months: close it</div>}
                  </td>
                  <td className="num">{m.expense_count}</td>
                  <td className="num"><Money value={m.expense_total} direction="out" /></td>
                  <td className="num"><Money value={m.topup_total} direction="in" /></td>
                  <td className="num">{m.file_count}</td>
                  <td className="num">{m.unchecked_count || <span className="muted">0</span>}</td>
                  <td>
                    {m.exported_at ? (
                      <>
                        {fmtDateTime(m.exported_at)}
                        {!m.export_current && <div className="small warn-text">Changed since: download again</div>}
                      </>
                    ) : (
                      <span className="muted">Not yet</span>
                    )}
                  </td>
                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "stretch" }}>
                    <button disabled={action.busy || m.expense_count + m.topup_count === 0} onClick={() => doExport(m)}>⬇ {t("downloadExport")}</button>
                    {isAdmin && !isCurrent && (
                      <button
                        className="danger"
                        disabled={action.busy || !m.export_current || m.month !== oldest?.month}
                        title={m.month !== oldest?.month ? "Close the older months first" : !m.export_current ? "Download the month first" : ""}
                        onClick={() => setClosing(m)}
                      >
                        {t("closeMonth")}
                      </button>
                    )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2>{t("closedMonths")}</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("month")}</th>
              <th className="num">{t("expenses")}</th>
              <th className="num">{t("spent")}</th>
              <th className="num">{t("topups")}</th>
              <th>Carried forward</th>
              <th>Closed</th>
            </tr>
          </thead>
          <tbody>
            {(closed.data ?? []).map((c) => (
              <tr key={c.month}>
                <td>{monthLabel(c.month)}</td>
                <td className="num">{c.expense_count}</td>
                <td className="num"><Money value={c.expense_total} direction="out" /></td>
                <td className="num"><Money value={c.topup_total} direction="in" /></td>
                <td className="small">
                  {c.carried.map((x) => (
                    <div key={x.wallet_id}>
                      {x.name}: <Money value={x.net} />
                    </div>
                  ))}
                </td>
                <td className="small">
                  {fmtDateTime(c.closed_at)} · {name("profiles", c.closed_by)}
                  {c.files_pending.length > 0 && isAdmin && (
                    <div>
                      <span className="warn-text">{c.files_pending.length} files still to remove</span>{" "}
                      <button disabled={action.busy} onClick={() => action.run(() => removeFiles(c)).then(() => closed.reload())}>Retry</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {closed.data?.length === 0 && (
              <tr><td colSpan={6} className="muted">No months closed yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {closing && (
        <CloseDialog
          month={closing}
          onClose={() => setClosing(null)}
          onDone={() => {
            setClosing(null);
            months.reload();
            closed.reload();
          }}
        />
      )}
    </>
  );
}

async function removeFiles(c: ClosedMonth): Promise<void> {
  const sb = supabase();
  const removed: string[] = [];
  for (const bucket of ["invoices", "attachments"] as const) {
    const paths = c.files_pending.filter((f) => f.startsWith(`${bucket}/`)).map((f) => f.slice(bucket.length + 1));
    for (let i = 0; i < paths.length; i += 100) {
      const batch = paths.slice(i, i + 100);
      const { error } = await sb.storage.from(bucket).remove(batch);
      if (!error) removed.push(...batch.map((p) => `${bucket}/${p}`));
    }
  }
  must(await sb.rpc("mark_files_removed", { p_month: c.month, p_files: removed }));
  if (removed.length < c.files_pending.length) throw new Error(`${c.files_pending.length - removed.length} files could not be removed. Press Retry.`);
}

function CloseDialog({ month, onClose, onDone }: { month: MonthOverview; onClose: () => void; onDone: () => void }) {
  const { t } = useApp();
  const [typed, setTyped] = useState("");
  const action = useAction();
  const tag = month.month.slice(0, 7);
  return (
    <Modal title={`${t("closeMonth")}: ${monthLabel(month.month)}`} onClose={onClose}>
      <p>
        This permanently erases <strong>{month.expense_count} expenses</strong>, <strong>{month.topup_count} transfers</strong> and <strong>{month.file_count} files</strong> for{" "}
        {monthLabel(month.month)}. Wallet balances don&apos;t change: each wallet&apos;s net for the month is carried forward.
      </p>
      <p>The downloaded zip will be the only copy. Check it opens and has the bills before you continue.</p>
      {month.unchecked_count > 0 && <p className="warn-text">{month.unchecked_count} entries were never ticked as checked.</p>}
      <Field label={`Type ${tag} to confirm`}>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={tag} autoFocus />
      </Field>
      <ErrorText error={action.error} />
      <div className="actions">
        <button onClick={onClose}>{t("cancel")}</button>
        <button
          className="danger"
          disabled={action.busy || typed.trim() !== tag}
          onClick={async () => {
            const ok = await action.run(async () => {
              const c = must(await supabase().rpc("close_month", { p_month: month.month, p_confirm: typed.trim() })) as ClosedMonth;
              if (c.files_pending.length) await removeFiles(c);
              return true;
            });
            if (ok) onDone();
          }}
        >
          Erase {tag}
        </button>
      </div>
    </Modal>
  );
}
