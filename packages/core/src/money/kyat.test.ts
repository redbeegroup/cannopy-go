import { describe, expect, it } from 'vitest';
import { formatKyat, isKyat, kyat, parseKyat } from './kyat.js';

describe('kyat', () => {
  it('accepts whole non-negative numbers', () => {
    expect(isKyat(0)).toBe(true);
    expect(isKyat(1_250_000)).toBe(true);
    expect(kyat(500)).toBe(500);
  });

  it('rejects decimals, negatives and non-numbers', () => {
    expect(isKyat(10.5)).toBe(false);
    expect(isKyat(-1)).toBe(false);
    expect(isKyat('10')).toBe(false);
    expect(() => kyat(1.5)).toThrow(/whole number/);
  });

  it('formats in English and Myanmar', () => {
    expect(formatKyat(1_250_000)).toBe('1,250,000 Ks');
    expect(formatKyat(1_250_000, { language: 'my' })).toBe('ကျပ် 1,250,000');
    expect(formatKyat(-5000)).toBe('-5,000 Ks');
  });

  it('supports lakh grouping and Myanmar digits', () => {
    expect(formatKyat(1_250_000, { grouping: 'lakh', withUnit: false })).toBe('12,50,000');
    expect(formatKyat(123, { grouping: 'lakh', withUnit: false })).toBe('123');
    expect(formatKyat(1500, { myanmarDigits: true, withUnit: false })).toBe('၁,၅၀၀');
  });

  it('parses typed input in either digit set', () => {
    expect(parseKyat('1,250,000 Ks')).toBe(1_250_000);
    expect(parseKyat('ကျပ် ၁,၅၀၀')).toBe(1500);
    expect(parseKyat('12.5')).toBeNull();
    expect(parseKyat('abc')).toBeNull();
  });
});
