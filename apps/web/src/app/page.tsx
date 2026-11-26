"use client";

import { useState } from "react";
import { fromDb, monthLabel, type DashboardSummary, type Expense, type SpendRow, type StorageUsage, type Topup, type WalletBalance } from "@kuttiapp/shared";
import { useApp } from "@/lib/app-context";
import { supabase, must } from "@/lib/supabase";
import { downloadXlsx } from "@/lib/export";
import { standardSheets } from "@/lib/workbook";
import { RequireRole } from "@/components/shell";
import { invoiceFileName } from "@/components/expenses";
import { ErrorText, Field, Money, MonthSelect, monthStart, useAction, useLive, useLoad } from "@/components/ui";

type Group = "project" | "category" | "custodian" | "wallet" | "month";

export default function DashboardPage() {
  return (
    <RequireRole roles={["admin", "accounts"]}>
      <Dashboard />
    </RequireRole>
  );
}

function Dashboard() {
  const { t, lookups } = useApp();
  const [month, setMonth] = useState(monthStart());
  const [walletId, setWalletId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [group, setGroup] = useState<Group>("project");
  const action = useAction();

  const filters = { p_month: month || null, p_wallet_id: walletId || null, p_project_id: projectId || null };
  const summary = useLoad(async () => must(await supabase().rpc("dashboard_summary", filters)) as DashboardSummary, [month, walletId, projectId]);
  const breakdown = useLoad(async () => must(await supabase().rpc("spend_breakdown", { p_group: group, ...filters })) as SpendRow[], [group, month, walletId, projectId]);
  const balances = useLoad(async () => {
    let q = supabase().from("wallet_balances").select("*").order("name");
    if (walletId) q = q.eq("wallet_id", walletId);
    return must(await q) as WalletBalance[];
  }, [walletId]);
  const storage = useLoad(async () => must(await supabase().rpc("storage_usage")) as StorageUsage | null, []);
  useLive(() => {
    summary.reload();
    breakdown.reload();
    balances.reload();
  });

  const s = summary.data;
  const maxSpend = Math.max(1, ...(breakdown.data ?? []).map((r) => fromDb(r.spent)));

  async function exportAll() {
    await action.run(async () => {
      const sb = supabase();
      let e = sb.from("expenses").select("*").order("expense_date");
      let tp = sb.from("topups").select("*").order("transfer_date");
      if (month) (e = e.eq("period_month", month)), (tp = tp.eq("period_month", month));
      if (walletId) (e = e.eq("wallet_id", walletId)), (tp = tp.eq("wallet_id", walletId));
      if (projectId) e = e.eq("project_id", projectId);
      const [ex, tx] = await Promise.all([e, tp]);
      await downloadXlsx(`kuttiapp-${month ? month.slice(0, 7) : "all-open-months"}`, standardSheets({
        title: month ? `Month ${monthLabel(month)}` : "All open months",
        expenses: must(ex) as Expense[] as unknown as Array<Record<string, unknown>>,
        topups: must(tx) as Topup[] as unknown as Array<Record<string, unknown>>,
        balances: (balances.data ?? []) as unknown as Array<Record<string, unknown>>,
        ...lookups,
        invoiceName: (r) => invoiceFileName(r as unknown as Expense),
      }));
    });
  }

  const used = storage.data ? storage.data.used_bytes / Math.max(1, storage.data.limit_bytes) : 0;

  return (
    <>
      <h1>{t("dashboard")}</h1>
      <div className="toolbar">
        <Field label={t("month")}>
          <MonthSelect value={month} onChange={setMonth} allowAll />
        </Field>
        <Field label={t("wallet")}>
          <select value={walletId} onChange={(e) => setWalletId(e.target.value)}>
            <option value="">{t("all")}</option>
            {lookups.wallets.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </Field>
        <Field label={t("project")}>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">{t("all")}</option>
            {lookups.projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </Field>
        <div className="grow" />
        <button disabled={action.busy} onClick={exportAll}>{t("exportExcel")}</button>
        <button onClick={() => window.print()}>{t("exportPdf")}</button>
      </div>
      <ErrorText error={summary.error || breakdown.error || balances.error || action.error} />

      {used >= 0.8 && (
        <div className="notice warn">
          Invoice storage is {Math.round(used * 100)}% full. Close the oldest month (download, then erase) to free space.
        </div>
      )}

      <div className="tiles">
        <Tile hero label="All wallets now" value={balances.data ? sumOf(balances.data, "available_balance") : undefined} sub="What staff should be holding (card + cash)" />
        <Tile direction="in" label={`${t("moneyIn")} · ${t("topups")}`} value={s?.topups_total} sub={projectId ? "Not split by project" : `${s?.topups_count ?? 0} transfers`} />
        <Tile direction="out" label={`${t("moneyOut")} · ${t("spent")}`} value={s?.spent_total} sub={`${s?.spent_count ?? 0} expenses`} />
        <Tile direction="out" label={`💳 ${t("card")}`} value={s?.spent_card} />
        <Tile direction="out" label={`💵 ${t("cash")}`} value={s?.spent_cash} />
        <Tile label={t("unchecked")} value={s?.unchecked_total} sub={`${s?.unchecked_count ?? 0} entries for accounts to check`} />
        <Tile label={t("vat")} value={s?.spent_vat} />
      </div>

      <h2>{t("wallets")}</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("wallet")}</th>
              <th>Holder</th>
              <th className="num">Brought forward</th>
              <th className="num">{t("topups")}</th>
              <th className="num">💳 {t("card")}</th>
              <th className="num">💵 {t("cash")}</th>
              <th className="num">{t("balance")}</th>
              <th className="num">{t("unchecked")}</th>
            </tr>
          </thead>
          <tbody>
            {(balances.data ?? []).map((b) => (
              <tr key={b.wallet_id} className={b.active ? undefined : "muted"}>
                <td>
                  {b.name} {b.card_last4 && <span className="muted small">•••• {b.card_last4}</span>}
                </td>
                <td>{b.custodian_name}</td>
                <td className="num"><Money value={b.opening_balance} /></td>
                <td className="num"><Money value={b.topups_total} direction="in" /></td>
                <td className="num"><Money value={b.spent_card} direction="out" /></td>
                <td className="num"><Money value={b.spent_cash} direction="out" /></td>
                <td className="num"><strong><Money value={b.available_balance} /></strong></td>
                <td className="num">{b.unchecked_count || <span className="muted">0</span>}</td>
              </tr>
            ))}
            {balances.data?.length === 0 && (
              <tr><td colSpan={8} className="muted">No wallets yet. Add one under Wallets.</td></tr>
            )}
          </tbody>
          {(balances.data?.length ?? 0) > 1 && (
            <tfoot>
              <tr>
                <th colSpan={2}>Total</th>
                <th className="num"><Money value={sumOf(balances.data, "opening_balance")} /></th>
                <th className="num"><Money value={sumOf(balances.data, "topups_total")} direction="in" /></th>
                <th className="num"><Money value={sumOf(balances.data, "spent_card")} direction="out" /></th>
                <th className="num"><Money value={sumOf(balances.data, "spent_cash")} direction="out" /></th>
                <th className="num"><Money value={sumOf(balances.data, "available_balance")} /></th>
                <th />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="muted small">Wallet balances cover all open months plus what was brought forward from closed months. Updates live as staff save.</p>

      <h2>Spend by</h2>
      <div className="toolbar">
        <select value={group} onChange={(e) => setGroup(e.target.value as Group)}>
          <option value="project">{t("project")}</option>
          <option value="category">{t("category")}</option>
          <option value="custodian">{t("custodian")}</option>
          <option value="wallet">{t("wallet")}</option>
          <option value="month">{t("month")}</option>
        </select>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t(group)}</th>
              <th className="num">{t("spent")}</th>
              <th className="num">#</th>
              <th style={{ width: "40%" }} />
            </tr>
          </thead>
          <tbody>
            {(breakdown.data ?? []).map((r) => (
              <tr key={r.key}>
                <td>{r.label}</td>
                <td className="num"><Money value={r.spent} direction="out" /></td>
                <td className="num">{r.expense_count}</td>
                <td>
                  <div className="bar" style={{ width: `${(fromDb(r.spent) / maxSpend) * 100}%` }} />
                </td>
              </tr>
            ))}
            {breakdown.data?.length === 0 && (
              <tr><td colSpan={4} className="muted">{t("noData")}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {storage.data && (
        <>
          <h2>{t("storage")}</h2>
          <div className="panel" style={{ maxWidth: 520 }}>
            <div className="meter">
              <div className={used >= 0.8 ? "warn" : undefined} style={{ width: `${Math.min(100, used * 100)}%` }} />
            </div>
            <p className="small muted">
              {mb(storage.data.used_bytes)} of {mb(storage.data.limit_bytes)} used · {storage.data.file_count} files
            </p>
          </div>
        </>
      )}
    </>
  );
}

function mb(bytes: number): string {
  return bytes >= 1024 * 1024 * 1024 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

function sumOf(rows: WalletBalance[] | undefined, key: keyof WalletBalance): string {
  const h = (rows ?? []).reduce((acc, r) => acc + fromDb(r[key] as string), 0);
  return (h / 100).toFixed(2);
}

function Tile({ label, value, sub, direction, hero }: { label: string; value: number | string | undefined; sub?: string; direction?: "in" | "out"; hero?: boolean }) {
  return (
    <div className={`tile${direction ? ` ${direction}` : ""}${hero ? " hero" : ""}`}>
      <div className="label">{label}</div>
      <div className="value">{value === undefined ? "…" : <Money value={value} direction={direction} />}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}
