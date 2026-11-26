"use client";

import { parseZatcaQr, type ZatcaInvoice } from "@expresscash/shared";

/** Shrinks a phone photo to at most 1600 px on the long side as JPEG (~200-400 KB), so storage lasts. */
export async function compressPhoto(file: Blob, maxSide = 1600, quality = 0.8): Promise<Blob> {
  if (!file.type.startsWith("image/")) return file;
  const bmp = await loadBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
  const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
  return out && out.size < file.size ? out : file;
}

async function loadBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    } catch {}
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** Looks for a Saudi e-invoice (ZATCA) QR code in the photo. Uses the phone's own detector when there is one. */
export async function readInvoiceQr(file: Blob): Promise<ZatcaInvoice | null> {
  try {
    const bmp = await loadBitmap(file);
    const texts: string[] = [];
    const BD = (globalThis as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (s: CanvasImageSource) => Promise<Array<{ rawValue: string }>> } }).BarcodeDetector;
    if (BD) {
      try {
        const found = await new BD({ formats: ["qr_code"] }).detect(bmp);
        texts.push(...found.map((f) => f.rawValue));
      } catch {}
    }
    if (!texts.length) {
      const jsQR = (await import("jsqr")).default;
      // try a couple of sizes: receipts photographed from afar have small codes
      for (const side of [1200, 2000, 800]) {
        const scale = Math.min(1, side / Math.max(bmp.width, bmp.height));
        const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(bmp, 0, 0, w, h);
        const hit = jsQR(ctx.getImageData(0, 0, w, h).data, w, h);
        if (hit?.data) {
          texts.push(hit.data);
          break;
        }
      }
    }
    for (const t of texts) {
      const inv = parseZatcaQr(t);
      if (inv) return inv;
    }
  } catch {}
  return null;
}
