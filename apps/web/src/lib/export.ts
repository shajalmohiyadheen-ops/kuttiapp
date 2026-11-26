"use client";

export interface Sheet {
  name: string;
  columns: Array<{ header: string; key: string; width?: number; money?: boolean }>;
  rows: Array<Record<string, unknown>>;
}

/** Builds an .xlsx in the browser and downloads it. Money columns are real numbers with 2 decimals so totals work in Excel. */
export async function downloadXlsx(filename: string, sheets: Sheet[]) {
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
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
