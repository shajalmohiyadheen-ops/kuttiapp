"use client";

import { useState } from "react";
import { fromDb, type DashboardSummary, type SpendRow, type WalletBalance } from "@kuttiapp/shared";
import { useApp } from "@/lib/app-context";
import { supabase, must } from "@/lib/supabase";
import { downloadXlsx } from "@/lib/export";
import { RequireRole } from "@/components/shell";
import { ErrorText, Field, Money, monthStart, today, useLoad } from "@/components/ui";

type Group = "project" | "category" | "custodian" | "wallet" | "month";

export default function DashboardPage() {
  return (
    <RequireRole roles={["admin", "approver"]}>
      <Dashboard />
    </RequireRole>
  );
}

function Dashboard() {
  const { t, lookups } = useApp();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [walletId, setWalletId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [custodianId, setCustodianId] = useState("");
  const [group, setGroup] = useState<Group>("project");

  const filters = {
    p_from: from || null,
    p_to: to || null,
    p_wallet_id: walletId || null,
    p_project_id: projectId || null,
  };

  const summary = useLoad(
    async () => must(await supabase().rpc("dashboard_summary", { ...filters, p_custodian_id: custodianId || null })) as DashboardSummary,
    [from, to, walletId, projectId, custodianId],
  );
  const breakdown = useLoad(
    async () => must(await supabase().rpc("spend_breakdown", { p_group: group, ...filters })) as SpendRow[],
    [group, from, to, walletId, projectId],
  );
  const balances = useLoad(async () => {
    let q = supabase().from("wallet_balances").select("*").order("name");
    if (walletId) q = q.eq("wallet_id", walletId);
    if (custodianId) q = q.eq("custodian_id", custodianId);
    return must(await q) as WalletBalance[];
  }, [walletId, custodianId]);

  const s = summary.data;
  const maxSpend = Math.max(1, ...(breakdown.data ?? []).map((r) => fromDb(r.approved) + fromDb(r.pending)));
  const custodians = lookups.profiles.filter((p) => lookups.wallets.some((w) => w.custodian_id === p.id));

  async function exportAll() {
    const sb = supabase();
    let q = sb.from("ledger").select("*").order("entry_date").order("created_at");
    if (from) q = q.gte("entry_date", from);
    if (to) q = q.lte("entry_date", to);
    if (walletId) q = q.eq("wallet_id", walletId);
    if (projectId) q = q.eq("project_id", projectId);
    const ledger = must(await q) as Array<Record<string, unknown>>;
    const wallets = new Map(lookups.wallets.map((w) => [w.id, w.name]));
    const projects = new Map(lookups.projects.map((p) => [p.id, `${p.code} ${p.name}`]));
    const categories = new Map(lookups.categories.map((c) => [c.id, c.name]));
    const people = new Map(lookups.profiles.map((p) => [p.id, p.full_name]));
    await downloadXlsx(`kuttiapp-${from}-to-${to}`, [
      {
        name: "Summary",
        columns: [
          { header: "Metric", key: "k", width: 28 },
          { header: "SAR", key: "v", money: true },
        ],
        rows: [
          { k: `Period ${from} to ${to}`, v: null },
          { k: "Total top-ups", v: s?.topups_total },
          { k: "Approved expenses", v: s?.approved_total },
          { k: "Pending expenses", v: s?.pending_total },
          { k: "Total disbursed (approved + pending)", v: s?.disbursed_total },
          { k: "VAT on approved", v: s?.approved_vat },
        ],
      },
      {
        name: "Wallet balances",
        columns: [
          { header: "Wallet", key: "name", width: 24 },
          { header: "ID", key: "external_id" },
          { header: "Type", key: "kind", width: 8 },
          { header: "Custodian", key: "custodian_name", width: 22 },
          { header: "Top-ups", key: "topups_total", money: true },
          { header: "Approved", key: "approved_total", money: true },
          { header: "Pending", key: "pending_total", money: true },
          { header: "Balance", key: "available_balance", money: true },
        ],
        rows: (balances.data ?? []) as unknown as Array<Record<string, unknown>>,
      },
      {
        name: "Ledger",
        columns: [
          { header: "Date", key: "entry_date", width: 12 },
          { header: "Type", key: "entry_type", width: 9 },
          { header: "ID", key: "external_id", width: 16 },
          { header: "Wallet", key: "wallet", width: 22 },
          { header: "Project", key: "project", width: 24 },
          { header: "Category", key: "category" },
          { header: "Person", key: "person" },
          { header: "Description", key: "description", width: 32 },
          { header: "In", key: "amount_in", money: true },
          { header: "Out", key: "amount_out", money: true },
          { header: "VAT", key: "vat_amount", money: true },
          { header: "Status", key: "status", width: 12 },
        ],
        rows: ledger.map((r) => ({
          ...r,
          wallet: wallets.get(r.wallet_id as string),
          project: projects.get(r.project_id as string) ?? "",
          category: categories.get(r.category_id as string) ?? "",
          person: people.get(r.person_id as string) ?? "",
        })),
      },
    ]);
  }

  return (
    <>
      <h1>{t("dashboard")}</h1>
      <div className="toolbar">
        <Field label={t("from")}>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label={t("to")}>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
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
              <option key={p.id} value={p.id}>{p.code} {p.name}</option>
            ))}
          </select>
        </Field>
        <Field label={t("custodian")}>
          <select value={custodianId} onChange={(e) => setCustodianId(e.target.value)}>
            <option value="">{t("all")}</option>
            {custodians.map((p) => (
              <option key={p.id} value={p.id}>{p.full_name}</option>
            ))}
          </select>
        </Field>
        <div className="grow" />
        <button onClick={exportAll}>{t("exportExcel")}</button>
        <button onClick={() => window.print()}>{t("exportPdf")}</button>
      </div>
      <ErrorText error={summary.error || breakdown.error || balances.error} />

      <div className="tiles">
        <Tile label={t("totalTopups")} value={s?.topups_total} sub={projectId ? "Not split by project" : `${s?.topups_count ?? 0} transfers`} />
        <Tile label={t("totalDisbursed")} value={s?.disbursed_total} sub="Approved + pending" />
        <Tile label={t("approved")} value={s?.approved_total} sub={`${s?.approved_count ?? 0} expenses`} />
        <Tile label={t("pending")} value={s?.pending_total} sub={`${s?.pending_count ?? 0} awaiting review`} />
        <Tile label={t("vat")} value={s?.approved_vat} sub="On approved expenses" />
      </div>

      <h2>{t("wallets")}</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("wallet")}</th>
              <th>{t("custodian")}</th>
              <th className="num">{t("topups")}</th>
              <th className="num">{t("approved")}</th>
              <th className="num">{t("pending")}</th>
              <th className="num">{t("balance")}</th>
            </tr>
          </thead>
          <tbody>
            {(balances.data ?? []).map((b) => (
              <tr key={b.wallet_id}>
                <td>
                  {b.name} <span className="muted small">{b.kind === "card" ? `•••• ${b.card_last4}` : t("cash")}</span>
                </td>
                <td>{b.custodian_name}</td>
                <td className="num"><Money value={b.topups_total} /></td>
                <td className="num"><Money value={b.approved_total} /></td>
                <td className="num"><Money value={b.pending_total} /></td>
                <td className="num"><strong><Money value={b.available_balance} /></strong></td>
              </tr>
            ))}
            {balances.data?.length === 0 && (
              <tr><td colSpan={6} className="muted">{t("noData")}</td></tr>
            )}
          </tbody>
          {(balances.data?.length ?? 0) > 1 && (
            <tfoot>
              <tr>
                <th colSpan={2}>Total</th>
                <th className="num"><Money value={sumOf(balances.data, "topups_total")} /></th>
                <th className="num"><Money value={sumOf(balances.data, "approved_total")} /></th>
                <th className="num"><Money value={sumOf(balances.data, "pending_total")} /></th>
                <th className="num"><Money value={sumOf(balances.data, "available_balance")} /></th>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="muted small">Wallet balances are all-time (top-ups minus approved and pending expenses), not limited to the period above.</p>

      <h2>Spend by</h2>
      <div className="toolbar">
        <select value={group} onChange={(e) => setGroup(e.target.value as Group)}>
          <option value="project">{t("project")}</option>
          <option value="category">{t("category")}</option>
          <option value="custodian">{t("custodian")}</option>
          <option value="wallet">{t("wallet")}</option>
          <option value="month">Month</option>
        </select>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t(group === "month" ? "date" : group)}</th>
              <th className="num">{t("approved")}</th>
              <th className="num">{t("pending")}</th>
              <th className="num">#</th>
              <th style={{ width: "30%" }} />
            </tr>
          </thead>
          <tbody>
            {(breakdown.data ?? []).map((r) => {
              const total = fromDb(r.approved) + fromDb(r.pending);
              return (
                <tr key={r.key}>
                  <td>{r.label}</td>
                  <td className="num"><Money value={r.approved} /></td>
                  <td className="num"><Money value={r.pending} /></td>
                  <td className="num">{r.expense_count}</td>
                  <td>
                    <div className="bar" style={{ width: `${(total / maxSpend) * 100}%` }} />
                  </td>
                </tr>
              );
            })}
            {breakdown.data?.length === 0 && (
              <tr><td colSpan={5} className="muted">{t("noData")}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function sumOf(rows: WalletBalance[] | undefined, key: keyof WalletBalance): string {
  const h = (rows ?? []).reduce((acc, r) => acc + fromDb(r[key] as string), 0);
  return (h / 100).toFixed(2);
}

function Tile({ label, value, sub }: { label: string; value: number | string | undefined; sub?: string }) {
  return (
    <div className="tile">
      <div className="label">{label}</div>
      <div className="value">{value === undefined ? "…" : <Money value={value} />}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}
