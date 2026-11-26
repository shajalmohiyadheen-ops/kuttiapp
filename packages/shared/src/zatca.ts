// Saudi e-invoices (ZATCA / FATOORAH) carry a QR code holding a base64 TLV blob:
//   1 seller name, 2 seller VAT number, 3 invoice timestamp, 4 total incl. VAT, 5 VAT total
// (tags 6-9 hold the Phase 2 cryptographic stamp and are ignored here).
// Scanning it gives exact vendor, VAT number, date, total and VAT with no OCR.

export interface ZatcaInvoice {
  sellerName: string;
  vatNumber: string;
  timestamp: string;     // as printed in the QR, usually ISO 8601
  date: string | null;   // YYYY-MM-DD if the timestamp could be read
  total: string;         // decimal string, e.g. "115.00"
  vat: string;           // decimal string
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64ToBytes(input: string): Uint8Array {
  const clean = input.trim().replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '');
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of clean) {
    buffer = (buffer << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

function utf8Decode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i++];
    let cp: number;
    if (b < 0x80) cp = b;
    else if (b >= 0xf0) cp = ((b & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
    else if (b >= 0xe0) cp = ((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
    else cp = ((b & 0x1f) << 6) | (bytes[i++] & 0x3f);
    out += String.fromCodePoint(cp);
  }
  return out;
}

function utf8Encode(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  }
  return out;
}

/** Returns null when the text is not a ZATCA QR payload. */
export function parseZatcaQr(payload: string): ZatcaInvoice | null {
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(payload);
  } catch {
    return null;
  }
  const fields: Record<number, string> = {};
  let i = 0;
  while (i + 2 <= bytes.length) {
    const tag = bytes[i];
    const len = bytes[i + 1];
    if (tag < 1 || tag > 9 || i + 2 + len > bytes.length) return null;
    if (tag <= 5) fields[tag] = utf8Decode(bytes.slice(i + 2, i + 2 + len));
    i += 2 + len;
  }
  if (i !== bytes.length) return null;
  if (!fields[1] || !fields[2] || !fields[4]) return null;
  const total = Number(fields[4]);
  const vat = Number(fields[5] ?? '0');
  if (!Number.isFinite(total) || !Number.isFinite(vat)) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fields[3] ?? '');
  return {
    sellerName: fields[1].trim(),
    vatNumber: fields[2].trim(),
    timestamp: fields[3] ?? '',
    date: m ? `${m[1]}-${m[2]}-${m[3]}` : null,
    total: total.toFixed(2),
    vat: vat.toFixed(2),
  };
}

/** Builds a ZATCA QR payload. Used for tests and the seed script. */
export function buildZatcaQr(inv: { sellerName: string; vatNumber: string; timestamp: string; total: string; vat: string }): string {
  const bytes: number[] = [];
  [inv.sellerName, inv.vatNumber, inv.timestamp, inv.total, inv.vat].forEach((value, idx) => {
    const enc = utf8Encode(value);
    bytes.push(idx + 1, enc.length, ...enc);
  });
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? B64[n & 63] : '=';
  }
  return out;
}
