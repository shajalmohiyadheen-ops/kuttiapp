// All money in Express Cash is SAR with 2 decimals. We do arithmetic in halalas
// (integer cents) so 0.1 + 0.2 style float errors never reach a total.

export const CURRENCY = 'SAR';

/** Parse user input like "1,234.5" or "١٢٣٫٤٥" (Arabic-Indic digits) into halalas. Returns null if invalid. */
export function parseAmount(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    return Math.round(input * 100);
  }
  const normalized = toLatinDigits(input)
    .replace(/[\s,،]/g, '')
    .replace('٫', '.')
    .replace(/^SAR/i, '')
    .replace(/ر\.?س\.?$/, '');
  if (!/^-?\d+(\.\d{0,2})?$/.test(normalized)) return null;
  const [whole, frac = ''] = normalized.replace('-', '').split('.');
  const halalas = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  return normalized.startsWith('-') ? -halalas : halalas;
}

export function toLatinDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/** halalas -> "1234.50" (what the database expects) */
export function toDecimalString(halalas: number): string {
  const sign = halalas < 0 ? '-' : '';
  const abs = Math.abs(Math.round(halalas));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Database numeric (string or number) -> halalas */
export function fromDb(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  return parseAmount(String(value)) ?? 0;
}

/** Format for display: "SAR 1,234.50" / "1,234.50 ر.س" */
export function formatSar(value: number | string | null | undefined, opts: { halalas?: boolean } = {}): string {
  const halalas = opts.halalas ? Number(value ?? 0) : fromDb(value as string | number | null | undefined);
  const sign = halalas < 0 ? '-' : '';
  const abs = Math.abs(halalas);
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = `${whole}.${String(abs % 100).padStart(2, '0')}`;
  return `${sign}SAR ${body}`;
}

/** VAT contained in a VAT-inclusive total, in halalas. Default KSA rate 15%. */
export function vatFromInclusive(totalHalalas: number, rate = 0.15): number {
  return Math.round((totalHalalas * rate) / (1 + rate));
}

export function sum(values: Array<number | string | null | undefined>): number {
  return values.reduce<number>((acc, v) => acc + fromDb(v), 0);
}
