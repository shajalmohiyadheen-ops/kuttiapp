import type { Cell } from "@expresscash/shared";

/** Every sheet of an Excel statement as rows of plain cell values (dates stay Date objects). */
export async function readStatementFile(file: Blob): Promise<Array<{ sheet: string; rows: Cell[][] }>> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  return wb.worksheets.map((ws) => {
    const rows: Cell[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const out: Cell[] = [];
      row.eachCell({ includeEmpty: true }, (cell, c) => {
        out[c - 1] = plain(cell.value);
      });
      rows[n - 1] = out;
    });
    return { sheet: ws.name, rows: Array.from(rows, (r) => r ?? []) };
  });
}

function plain(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date || typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "object") {
    const o = v as { richText?: Array<{ text: string }>; result?: unknown; text?: unknown; error?: unknown };
    if (o.richText) return o.richText.map((t) => t.text).join("");
    if ("result" in o) return plain(o.result);
    if (typeof o.text === "string") return o.text;
  }
  return null;
}
