// Excel building shared by the browser downloads and the weekly email job.

export interface Sheet {
  name: string;
  columns: Array<{ header: string; key: string; width?: number; money?: boolean }>;
  rows: Array<Record<string, unknown>>;
}

/** Money columns are real numbers with 2 decimals so totals work in Excel. */
export async function buildWorkbook(sheets: Sheet[]): Promise<ArrayBuffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "KuttiApp";
  wb.created = new Date();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31));
    ws.columns = s.columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? (c.money ? 14 : 18) }));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    for (const r of s.rows) {
      const row: Record<string, unknown> = {};
      for (const c of s.columns) {
        const v = r[c.key];
        row[c.key] = c.money ? (v === null || v === undefined || v === "" ? null : Number(v)) : v;
      }
      ws.addRow(row);
    }
    s.columns.forEach((c, i) => {
      if (c.money) ws.getColumn(i + 1).numFmt = "#,##0.00";
    });
  }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

interface Named {
  id: string;
  name?: string;
  full_name?: string;
  email?: string | null;
}

/** The standard sheets for a set of expenses and transfers: Summary, Wallets, Expenses, Transfers in. */
export function standardSheets(input: {
  title: string;
  expenses: Array<Record<string, unknown>>;
  topups: Array<Record<string, unknown>>;
  balances: Array<Record<string, unknown>>;
  profiles: Named[];
  projects: Named[];
  categories: Named[];
  wallets: Named[];
  invoiceName?: (e: Record<string, unknown>) => string;
}): Sheet[] {
  const nm = (list: Named[]) => new Map(list.map((x) => [x.id, x.full_name || x.name || x.email || ""]));
  const people = nm(input.profiles), projects = nm(input.projects), categories = nm(input.categories), wallets = nm(input.wallets);
  const live = input.expenses.filter((e) => e.status !== "reversed");
  const total = (rows: Array<Record<string, unknown>>, key = "amount") => rows.reduce((a, r) => a + Math.round(Number(r[key] ?? 0) * 100), 0) / 100;
  return [
    {
      name: "Summary",
      columns: [
        { header: "Item", key: "k", width: 34 },
        { header: "SAR", key: "v", money: true },
        { header: "Count", key: "n", width: 10 },
      ],
      rows: [
        { k: input.title },
        { k: "Transfers in", v: total(input.topups.filter((t) => t.status === "posted")), n: input.topups.filter((t) => t.status === "posted").length },
        { k: "Spent (card)", v: total(live.filter((e) => e.paid_by === "card")), n: live.filter((e) => e.paid_by === "card").length },
        { k: "Spent (cash)", v: total(live.filter((e) => e.paid_by === "cash")), n: live.filter((e) => e.paid_by === "cash").length },
        { k: "Spent (total)", v: total(live), n: live.length },
        { k: "VAT", v: total(live, "vat_amount") },
        { k: "Not checked yet", v: total(live.filter((e) => !e.checked_by)), n: live.filter((e) => !e.checked_by).length },
        { k: "Reversed (not counted)", v: total(input.expenses.filter((e) => e.status === "reversed")), n: input.expenses.filter((e) => e.status === "reversed").length },
      ],
    },
    {
      name: "Wallets",
      columns: [
        { header: "Wallet", key: "name", width: 24 },
        { header: "Holder", key: "custodian_name", width: 22 },
        { header: "ID", key: "external_id", width: 16 },
        { header: "Brought forward", key: "opening_balance", money: true },
        { header: "Transfers in", key: "topups_total", money: true },
        { header: "Spent card", key: "spent_card", money: true },
        { header: "Spent cash", key: "spent_cash", money: true },
        { header: "Balance now", key: "available_balance", money: true },
      ],
      rows: input.balances,
    },
    {
      name: "Expenses",
      columns: [
        { header: "Date", key: "expense_date", width: 12 },
        { header: "Month", key: "month", width: 9 },
        { header: "ID", key: "external_id", width: 16 },
        { header: "Staff", key: "person" },
        { header: "Wallet", key: "wallet" },
        { header: "Paid by", key: "paid_by", width: 8 },
        { header: "Project", key: "project", width: 24 },
        { header: "Category", key: "category" },
        { header: "Vendor", key: "vendor" },
        { header: "Vendor VAT no.", key: "vendor_vat_number" },
        { header: "Invoice no.", key: "invoice_number" },
        { header: "Remarks", key: "description", width: 34 },
        { header: "Amount", key: "amount", money: true },
        { header: "VAT", key: "vat_amount", money: true },
        { header: "Status", key: "status", width: 10 },
        { header: "Checked by", key: "checker" },
        { header: "Check note", key: "check_note", width: 24 },
        { header: "Bill file", key: "bill", width: 30 },
      ],
      rows: input.expenses.map((e) => ({
        ...e,
        month: String(e.period_month ?? "").slice(0, 7),
        person: people.get(e.submitted_by as string),
        wallet: wallets.get(e.wallet_id as string),
        project: projects.get(e.project_id as string),
        category: categories.get(e.category_id as string),
        checker: e.checked_by ? people.get(e.checked_by as string) : "",
        status: e.status === "reversed" ? `reversed: ${e.reversal_reason ?? ""}` : "saved",
        bill: e.invoice_path && input.invoiceName ? input.invoiceName(e) : e.invoice_path ? "yes" : "",
      })),
    },
    {
      name: "Transfers in",
      columns: [
        { header: "Date", key: "transfer_date", width: 12 },
        { header: "Month", key: "month", width: 9 },
        { header: "ID", key: "external_id", width: 16 },
        { header: "Wallet", key: "wallet", width: 22 },
        { header: "Method", key: "method" },
        { header: "Reference", key: "reference" },
        { header: "Notes", key: "notes", width: 28 },
        { header: "Amount", key: "amount", money: true },
        { header: "Status", key: "status", width: 10 },
      ],
      rows: input.topups.map((t) => ({ ...t, month: String(t.period_month ?? "").slice(0, 7), wallet: wallets.get(t.wallet_id as string) })),
    },
  ];
}
