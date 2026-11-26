"use client";

import { buildWorkbook, type Sheet } from "./workbook";

export type { Sheet };

function saveBlob(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

/** Builds an .xlsx in the browser and downloads it. */
export async function downloadXlsx(filename: string, sheets: Sheet[]) {
  const buf = await buildWorkbook(sheets);
  saveBlob(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}

/**
 * Zips stored files and downloads the zip. Returns how many files made it in.
 * Throws if any file can't be fetched, so an export is never silently incomplete.
 */
export async function downloadZip(
  filename: string,
  files: Array<{ bucket: "invoices" | "attachments"; path: string; name: string }>,
  extra: Array<{ name: string; data: ArrayBuffer | Uint8Array | string }>,
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const { supabase } = await import("./supabase");
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  for (const x of extra) zip.file(x.name, x.data);
  let done = 0;
  const failed: string[] = [];
  // a few at a time keeps memory and the connection reasonable on a phone
  const queue = [...files];
  async function worker() {
    for (let f = queue.shift(); f; f = queue.shift()) {
      const { data, error } = await supabase().storage.from(f.bucket).download(f.path);
      if (error || !data) failed.push(f.name);
      else zip.file(f.name, await data.arrayBuffer());
      onProgress?.(++done, files.length);
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  if (failed.length) throw new Error(`${failed.length} file(s) could not be downloaded, e.g. ${failed[0]}. Try again.`);
  const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
  saveBlob(blob, filename.endsWith(".zip") ? filename : `${filename}.zip`);
  return files.length;
}
