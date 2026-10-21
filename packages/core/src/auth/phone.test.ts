import { describe, expect, it } from 'vitest';
import { formatPhone, normalizePhone } from './phone.js';

describe('phone numbers', () => {
  it('normalises the ways a Myanmar owner types a number', () => {
    expect(normalizePhone('09 123 456 789')).toBe('+959123456789');
    expect(normalizePhone('09-123456789')).toBe('+959123456789');
    expect(normalizePhone('+95 9123456789')).toBe('+959123456789');
    expect(normalizePhone('959123456789')).toBe('+959123456789');
    expect(normalizePhone('0095 9123456789')).toBe('+959123456789');
    expect(normalizePhone('၀၉၁၂၃၄၅၆၇၈၉')).toBe('+959123456789');
    expect(normalizePhone('9123456789')).toBe('+959123456789');
  });

  it('keeps foreign numbers with their country code', () => {
    expect(normalizePhone('+66 81 234 5678')).toBe('+66812345678');
    expect(normalizePhone('+1 (415) 555-0100')).toBe('+14155550100');
  });

  it('rejects what is not a phone number', () => {
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('abc')).toBeNull();
    expect(normalizePhone('12')).toBeNull();
    expect(normalizePhone('+0123456789')).toBeNull();
    expect(normalizePhone('09 12')).toBeNull();
  });

  it('shows Myanmar numbers the local way', () => {
    expect(formatPhone('+959123456789')).toBe('09 123 456 789');
    expect(formatPhone('+66812345678')).toBe('+66812345678');
  });
});
