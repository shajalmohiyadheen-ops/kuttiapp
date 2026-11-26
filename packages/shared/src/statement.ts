// Reads a bank statement exported to Excel (Alinma, SNB, or another bank) into plain lines.
// The web app turns the sheet into rows of cell values; this finds the table inside the
// report header block, works out which column is which, and parses dates and amounts.

export type Cell = string | number | boolean | Date | null | undefined;

/** Which column holds what, by the column's header text (so a saved mapping survives column moves). */
export interface StatementMapping {
  date: string;
  /** Separate money-out / money-in columns (Alinma, SNB) ... */
  debit?: string;
  credit?: string;
  /** ... or one signed amount column. */
  amount?: string;
  /** Joined with " · " into the line's description. */
  description: string[];
}

export interface StatementLine {
  date: string; // YYYY-MM-DD
  amount: number; // negative = out of the card, positive = into it
  description: string;
}

export interface ParsedStatement {
  headerRow: number; // 0-based index into rows
  headers: string[];
  lines: StatementLine[];
  skipped: number; // rows inside the table that had no date or no amount
}

const norm = (v: Cell) => String(v ?? "").replace(/\s+/g, " ").trim();

const DATE_HEADERS = [/transaction date/i, /value date/i, /posting date/i, /processing date/i, /^date$/i, /تاريخ العملية/, /التاريخ/, /تاريخ/];
const DEBIT = [/debit/i, /withdrawal/i, /مدين/];
const CREDIT = [/credit/i, /deposit/i, /دائن/];
const AMOUNT = [/^amount$/i, /amount/i, /المبلغ/];
const DESCRIPTION = [/description/i, /details/i, /narrative/i, /particulars/i, /remarks/i, /تفاصيل/, /البيان/];

function pick(headers: string[], patterns: RegExp[], skip: Set<string> = new Set()): string | undefined {
  for (const p of patterns) {
    const h = headers.find((x) => x && !skip.has(x) && p.test(x) && !/total|balance|رصيد|مجموع/i.test(x));
    if (h) return h;
  }
  return undefined;
}

/** Finds the header row of the transactions table and guesses the mapping. */
export function detectStatement(rows: Cell[][]): { headerRow: number; headers: string[]; mapping: StatementMapping } | null {
  for (let i = 0; i < Math.min(rows.length, 80); i++) {
    const headers = rows[i].map(norm);
    const date = pick(headers, DATE_HEADERS);
    if (!date) continue;
    const used = new Set([date]);
    const debit = pick(headers, DEBIT, used);
    const credit = pick(headers, CREDIT, new Set([...used, ...(debit ? [debit] : [])]));
    const amount = debit || credit ? undefined : pick(headers, AMOUNT, used);
    if (!debit && !credit && !amount) continue;
    const taken = new Set([date, debit, credit, amount].filter(Boolean) as string[]);
    // merged header cells repeat the same text across columns; keep each header once
    const description = [...new Set(headers.filter((h) => h && !taken.has(h) && DESCRIPTION.some((p) => p.test(h))))];
    return { headerRow: i, headers, mapping: { date, debit, credit, amount, description } };
  }
  return null;
}

/** Header row for a saved mapping: the first row that has all of its columns. */
export function findHeaderRow(rows: Cell[][], m: StatementMapping): number {
  const need = [m.date, m.debit, m.credit, m.amount].filter(Boolean) as string[];
  return rows.findIndex((r) => {
    const h = r.map(norm);
    return need.every((n) => h.includes(n));
  });
}

/** "1,234.50", "-1,234.50", "SAR 12", "(12.00)", 12 -> number; "" -> null. */
export function parseStatementAmount(v: Cell): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = norm(v).replace(/SAR|ر\.س|,|\s/gi, "");
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) (neg = true), (s = s.slice(1, -1));
  if (s.endsWith("-")) (neg = true), (s = s.slice(0, -1));
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -Math.abs(n) : n;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Date cell or "dd/mm/yyyy", "dd-mm-yyyy", "yyyy-mm-dd" (Saudi banks write day first) -> "YYYY-MM-DD". */
export function parseDate(v: Cell): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    // Excel dates come in as UTC midnight
    return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  }
  const s = norm(v);
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) return valid(+m[3], +m[2], +m[1]);
  return null;
}

function valid(y: number, mo: number, d: number): string | null {
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null; // e.g. 31/02
  return `${y}-${pad(mo)}-${pad(d)}`;
}

export function parseStatement(rows: Cell[][], mapping: StatementMapping, headerRow?: number): ParsedStatement | null {
  const hr = headerRow ?? findHeaderRow(rows, mapping);
  if (hr < 0) return null;
  const headers = rows[hr].map(norm);
  const col = (name?: string) => (name ? headers.indexOf(name) : -1);
  const iDate = col(mapping.date);
  const iDebit = col(mapping.debit);
  const iCredit = col(mapping.credit);
  const iAmount = col(mapping.amount);
  const iDesc = mapping.description.map(col).filter((i) => i >= 0);
  const lines: StatementLine[] = [];
  let skipped = 0;
  for (const r of rows.slice(hr + 1)) {
    if (!r.some((c) => norm(c))) continue;
    const date = parseDate(r[iDate]);
    let amount: number | null = null;
    if (iAmount >= 0) amount = parseStatementAmount(r[iAmount]);
    else {
      const out = iDebit >= 0 ? parseStatementAmount(r[iDebit]) : null;
      const inn = iCredit >= 0 ? parseStatementAmount(r[iCredit]) : null;
      if (out) amount = -Math.abs(out);
      else if (inn) amount = Math.abs(inn);
    }
    if (!date || !amount) {
      skipped++;
      continue;
    }
    const description = iDesc.map((i) => norm(r[i])).filter(Boolean).join(" · ");
    lines.push({ date, amount: Math.round(amount * 100) / 100, description });
  }
  return { headerRow: hr, headers, lines, skipped };
}
