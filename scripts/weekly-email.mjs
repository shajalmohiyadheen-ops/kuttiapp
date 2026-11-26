#!/usr/bin/env node
// Weekly report to the admin: wallet balances (card and cash in hand), every warning, and an Excel
// file with the last 7 days of expenses, transfers and cash. Run by .github/workflows/weekly-email.yml.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... RESEND_API_KEY=... REPORT_TO=a@x.com,b@x.com \
//   REPORT_FROM="Express Cash <reports@yourdomain.com>" node scripts/weekly-email.mjs [--dry-run]
//
// --dry-run writes weekly-report.xlsx and weekly-report.html instead of sending.

import { writeFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";

const dry = process.argv.includes("--dry-run");
const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const to = (process.env.REPORT_TO ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const from = process.env.REPORT_FROM ?? "Express Cash <onboarding@resend.dev>";
const appUrl = process.env.APP_URL ?? "";
if (!url || !key) fail("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
if (!dry && (!process.env.RESEND_API_KEY || !to.length)) fail("Set RESEND_API_KEY and REPORT_TO (comma separated)");

function fail(msg) {
  console.error(msg);
  process.exit(1);
}
const ok = (res, what) => {
  if (res.error) fail(`${what}: ${res.error.message}`);
  return res.data;
};

const riyadh = (d) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
const today = riyadh(new Date());
const since = riyadh(new Date(Date.now() - 7 * 86400000));
const sar = (v) => `SAR ${Number(v ?? 0).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const [balances, flags, expenses, topups, cash, profiles, projects, categories] = await Promise.all([
  sb.from("wallet_balances").select("*").order("name").then((r) => ok(r, "wallets")),
  sb.rpc("attention_flags").then((r) => ok(r, "warnings")),
  sb.from("expenses").select("*").gte("expense_date", since).order("expense_date").then((r) => ok(r, "expenses")),
  sb.from("topups").select("*").gte("transfer_date", since).order("transfer_date").then((r) => ok(r, "transfers")),
  sb.from("cash_moves").select("*").gte("move_date", since).order("move_date").then((r) => ok(r, "cash")),
  sb.from("profiles").select("id, full_name, email").then((r) => ok(r, "people")),
  sb.from("projects").select("id, name").then((r) => ok(r, "projects")),
  sb.from("categories").select("id, name").then((r) => ok(r, "categories")),
]);
const nameOf = (list) => new Map(list.map((x) => [x.id, x.full_name || x.name || x.email]));
const people = nameOf(profiles), proj = nameOf(projects), cat = nameOf(categories), wal = new Map(balances.map((b) => [b.wallet_id, b.name]));
const live = expenses.filter((e) => e.status === "recorded");
const spent = live.reduce((a, e) => a + Number(e.amount), 0);
const vat = live.reduce((a, e) => a + Number(e.vat_amount), 0);
const transferred = topups.filter((t) => t.status === "posted").reduce((a, t) => a + Number(t.amount), 0);

// ---- Excel
const wb = new ExcelJS.Workbook();
wb.creator = "Express Cash";
const sheet = (name, columns, rows) => {
  const ws = wb.addWorksheet(name);
  ws.columns = columns.map((c) => ({ header: c[0], key: c[1], width: c[2] ?? 16, style: c[3] ? { numFmt: "#,##0.00" } : {} }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  for (const r of rows) ws.addRow(r);
};
sheet("Wallets", [["Wallet", "name", 24], ["Holder", "custodian_name", 20], ["On card", "card_balance", 14, 1], ["Cash in hand", "cash_in_hand", 14, 1], ["Total", "available_balance", 14, 1], ["Not checked", "unchecked_count", 12]],
  balances.map((b) => ({ ...b, card_balance: Number(b.card_balance), cash_in_hand: Number(b.cash_in_hand), available_balance: Number(b.available_balance) })));
sheet("Warnings", [["Wallet", "wallet_name", 24], ["Warning", "message", 90]], flags);
sheet("Expenses", [["Date", "expense_date", 12], ["ID", "external_id"], ["Staff", "person", 18], ["Wallet", "wallet", 20], ["Paid by", "paid_by", 8], ["Project", "project", 24], ["Category", "category", 16], ["Vendor", "vendor", 20], ["Remarks", "description", 34], ["Amount", "amount", 12, 1], ["VAT", "vat_amount", 10, 1], ["Status", "status", 10], ["Checked", "checked", 9]],
  expenses.map((e) => ({ ...e, amount: Number(e.amount), vat_amount: Number(e.vat_amount), person: people.get(e.submitted_by), wallet: wal.get(e.wallet_id), project: proj.get(e.project_id), category: cat.get(e.category_id), checked: e.checked_by ? "yes" : "" })));
sheet("Transfers in", [["Date", "transfer_date", 12], ["ID", "external_id"], ["Wallet", "wallet", 22], ["Reference", "reference", 24], ["Amount", "amount", 12, 1], ["Status", "status", 10]],
  topups.map((t) => ({ ...t, amount: Number(t.amount), wallet: wal.get(t.wallet_id) })));
const KIND = { withdrawal: "Withdrawn from card", deposit: "Put back on card", handover: "Handed to office" };
sheet("Cash", [["Date", "move_date", 12], ["Entered", "entered", 12], ["Wallet", "wallet", 22], ["What", "what", 20], ["Notes", "notes", 28], ["Amount", "amount", 12, 1], ["Status", "status", 10]],
  cash.map((c) => ({ ...c, amount: Number(c.amount), entered: riyadh(new Date(c.created_at)), wallet: wal.get(c.wallet_id), what: KIND[c.kind] })));
const xlsx = Buffer.from(await wb.xlsx.writeBuffer());

// ---- Email body
const td = 'style="padding:6px 10px;border-bottom:1px solid #e3e6ea"';
const tdn = 'style="padding:6px 10px;border-bottom:1px solid #e3e6ea;text-align:right;white-space:nowrap"';
const html = `<div style="font-family:Roboto,Arial,sans-serif;color:#1c1e21;max-width:680px">
<h2 style="margin:0 0 4px">Express Cash weekly report</h2>
<div style="color:#65676b">${since} to ${today}</div>
<p>Transferred <b style="color:#13824a">${sar(transferred)}</b> · Spent <b style="color:#d42a4c">${sar(spent)}</b> (VAT ${sar(vat)}) · ${live.length} expenses, ${cash.length} cash entries.</p>
<h3 style="margin:18px 0 6px">${flags.length ? `⚠ ${flags.length} need${flags.length === 1 ? "s" : ""} attention` : "✓ Nothing needs attention"}</h3>
${flags.length ? `<ul style="padding-left:18px;margin:0">${flags.map((f) => `<li style="margin:4px 0">${esc(f.message)}</li>`).join("")}</ul>` : ""}
<h3 style="margin:18px 0 6px">Wallets now</h3>
<table style="border-collapse:collapse;width:100%"><tr><th ${td} align="left">Wallet</th><th ${tdn}>On card</th><th ${tdn}>Cash in hand</th><th ${tdn}>Total</th></tr>
${balances.filter((b) => b.active).map((b) => `<tr><td ${td}>${esc(b.name)}<div style="color:#65676b;font-size:12px">${esc(b.custodian_name)}</div></td><td ${tdn}>${sar(b.card_balance)}</td><td ${tdn}>${sar(b.cash_in_hand)}</td><td ${tdn}><b style="color:${Number(b.available_balance) < 0 ? "#d42a4c" : "inherit"}">${sar(b.available_balance)}</b></td></tr>`).join("")}
</table>
<p style="color:#65676b;font-size:13px">The attached Excel has every expense, transfer and cash entry from the week.${appUrl ? ` Open the dashboard: <a href="${esc(appUrl)}">${esc(appUrl)}</a>` : ""}</p>
</div>`;

if (dry) {
  writeFileSync("weekly-report.xlsx", xlsx);
  writeFileSync("weekly-report.html", html);
  console.log(`dry run: ${flags.length} warnings, ${expenses.length} expenses; wrote weekly-report.xlsx and weekly-report.html`);
  process.exit(0);
}

const res = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    from,
    to,
    subject: `Express Cash weekly: ${flags.length ? `${flags.length} to check` : "all clear"} (${since} to ${today})`,
    html,
    attachments: [{ filename: `express-cash-week-${today}.xlsx`, content: xlsx.toString("base64") }],
  }),
});
if (!res.ok) fail(`Resend: ${res.status} ${await res.text()}`);
console.log(`sent to ${to.length} recipient(s): ${flags.length} warnings, ${expenses.length} expenses`);
