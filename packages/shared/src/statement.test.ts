import { describe, expect, it } from "vitest";
import { detectStatement, parseStatementAmount, parseDate, parseStatement, type Cell } from "./statement";

// Synthetic statements laid out like the real exports (made-up values).
const alinma: Cell[][] = [
  ["Account Statement", null, null, null, null, null, null, null, null, null, "كشف الحساب"],
  ["2026-11-01  -  2026-11-23", null, null, null, "تاريخ كشف الحساب"],
  ["SAR 10000.00", null, null, null, "رصيد الإقفال", null, null, "SAR 9000.00", null, null, null, null, null, "الرصيد الإفتتاحي"],
  [null, null, null, null, "Total Debit Amount"],
  [
    "الرصيد\nBalance", null, "دائن\nCredit", "مدين\nDebit", "تفاصيل العملية\nTransaction Description", null, null, null,
    "الرقم المرجعي\n# Reference", null, null, null, "تاريخ العملية\nTransaction Date", null, "وقت المعاملة\nTransaction Time",
  ],
  ["9,500.00", null, null, "-500.00", "سحب نقدي صراف آلي", null, null, null, "FT0001", null, null, null, "22/11/2026", null, "10:15:00"],
  ["10,000.00", null, "5,000.00", null, "حوالة داخلية واردة", null, null, null, "FT0002", null, null, null, "20/11/2026", null, "09:00:00"],
  ["5,000.00", null, null, "-1,234.56", "POS Purchase HARDWARE CO", null, null, null, "FT0003", null, null, null, "19/11/2026", null, "18:40:00"],
];

const snb: Cell[][] = [
  ["Account Statement"],
  ["Short Name", "SBA"],
  ["Total Debit Amount", "-1,000.00"],
  ["Date From", "01/11/2026"],
  [],
  ["Processing Date", "Transaction Description", "Description", "Description Extra", "Reference", "Remarks", "Debit", "Credit", "Balance"],
  [new Date(Date.UTC(2026, 10, 23)), "VAT Charge", "CITY:Digital Channel", "", "100000001", "", "-1.15", "", "8,000.00"],
  [new Date(Date.UTC(2026, 10, 22)), "Cash withdrawal - Local ATM", "CITY: RIYADH ATM", "", "100000002", "", "-1,000.00", "", "8,001.15"],
  [new Date(Date.UTC(2026, 10, 21)), "Incoming Local transfer", "SA CHNL: RIYADH", "", "100000003", "EF", "", "9,001.15", "9,001.15"],
];

describe("bank statements", () => {
  it("finds the Alinma table under the report header", () => {
    const d = detectStatement(alinma)!;
    expect(d.headerRow).toBe(4);
    expect(d.mapping.date).toContain("Transaction Date");
    expect(d.mapping.debit).toContain("Debit");
    expect(d.mapping.credit).toContain("Credit");
    expect(d.mapping.description.some((h) => h.includes("Transaction Description"))).toBe(true);
    const p = parseStatement(alinma, d.mapping)!;
    expect(p.lines).toEqual([
      { date: "2026-11-22", amount: -500, description: "سحب نقدي صراف آلي" },
      { date: "2026-11-20", amount: 5000, description: "حوالة داخلية واردة" },
      { date: "2026-11-19", amount: -1234.56, description: "POS Purchase HARDWARE CO" },
    ]);
  });

  it("finds the SNB table with real date cells and several description columns", () => {
    const d = detectStatement(snb)!;
    expect(d.mapping.date).toBe("Processing Date");
    expect(d.mapping.description).toEqual(["Transaction Description", "Description", "Description Extra", "Remarks"]);
    const p = parseStatement(snb, d.mapping)!;
    expect(p.lines.map((l) => [l.date, l.amount])).toEqual([
      ["2026-11-23", -1.15],
      ["2026-11-22", -1000],
      ["2026-11-21", 9001.15],
    ]);
    expect(p.lines[1].description).toBe("Cash withdrawal - Local ATM · CITY: RIYADH ATM");
  });

  it("reuses a saved mapping even when the header row moves", () => {
    const d = detectStatement(snb)!;
    const moved = [[], [], ...snb];
    expect(parseStatement(moved, d.mapping)!.lines).toHaveLength(3);
  });

  it("parses amounts and day-first dates", () => {
    expect(parseStatementAmount("-1,234.50")).toBe(-1234.5);
    expect(parseStatementAmount("SAR 12")).toBe(12);
    expect(parseStatementAmount("(5.00)")).toBe(-5);
    expect(parseStatementAmount("")).toBeNull();
    expect(parseDate("05/11/2026")).toBe("2026-11-05");
    expect(parseDate("2026-11-05")).toBe("2026-11-05");
    expect(parseDate("22/11/2026 10:00")).toBe("2026-11-22");
    expect(parseDate("31/02/2026")).toBeNull();
    expect(parseDate("13/13/2026")).toBeNull();
  });
});
