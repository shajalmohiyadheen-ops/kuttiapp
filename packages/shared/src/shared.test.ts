import { describe, expect, it } from 'vitest';
import { buildZatcaQr, formatSar, parseAmount, parseZatcaQr, toDecimalString, vatFromInclusive, sum, t } from './index';

describe('money', () => {
  it('parses common inputs to halalas', () => {
    expect(parseAmount('1,234.5')).toBe(123450);
    expect(parseAmount('١٢٣٫٤٥')).toBe(12345);
    expect(parseAmount('SAR 10')).toBe(1000);
    expect(parseAmount('0.1')).toBe(10);
    expect(parseAmount('1.234')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('')).toBeNull();
  });
  it('sums without float drift', () => {
    expect(sum(['0.10', '0.20', 0.3])).toBe(60);
    expect(toDecimalString(sum(['1150.00', '280.00']))).toBe('1430.00');
  });
  it('formats', () => {
    expect(formatSar('1234567.5')).toBe('SAR 1,234,567.50');
    expect(formatSar(-5)).toBe('-SAR 5.00');
  });
  it('extracts VAT from an inclusive total', () => {
    expect(vatFromInclusive(11500)).toBe(1500);
    expect(vatFromInclusive(30000)).toBe(3913);
  });
});

describe('ZATCA QR', () => {
  it('round-trips, including Arabic seller names', () => {
    const qr = buildZatcaQr({ sellerName: 'شركة ساسكو', vatNumber: '300000000000003', timestamp: '2026-11-20T10:15:00Z', total: '115.00', vat: '15.00' });
    expect(parseZatcaQr(qr)).toEqual({
      sellerName: 'شركة ساسكو', vatNumber: '300000000000003', timestamp: '2026-11-20T10:15:00Z', date: '2026-11-20', total: '115.00', vat: '15.00',
    });
  });
  it('decodes the ZATCA spec sample', () => {
    // Sample from the ZATCA QR code guideline (seller "Bobs Records").
    const qr = 'AQxCb2JzIFJlY29yZHMCDzMxMDEyMjM5MzUwMDAwMwMUMjAyMi0wNC0yNVQxNTozMDowMFoEBzEwMDAuMDAFBjE1MC4wMA==';
    const inv = parseZatcaQr(qr);
    expect(inv?.sellerName).toBe('Bobs Records');
    expect(inv?.vatNumber).toBe('310122393500003');
    expect(inv?.date).toBe('2022-04-25');
    expect(inv?.total).toBe('1000.00');
    expect(inv?.vat).toBe('150.00');
  });
  it('rejects non-ZATCA codes', () => {
    expect(parseZatcaQr('https://example.com')).toBeNull();
    expect(parseZatcaQr('hello world')).toBeNull();
  });
});

describe('i18n', () => {
  it('fills variables', () => {
    expect(t('invoiceRequired', { amount: 'SAR 100.00' })).toBe('A bill photo is required above SAR 100.00');
  });
});
