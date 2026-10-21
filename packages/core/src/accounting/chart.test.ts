import { describe, expect, it } from 'vitest';
import { newId } from '../ids/id.js';
import { nextAccountCode, STANDARD_CHART, SYSTEM_ACCOUNT_CODES, standardChart } from './chart.js';

describe('standard chart of accounts', () => {
  it('has unique codes and one account for every system code', () => {
    const codes = STANDARD_CHART.map((a) => a.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of Object.values(SYSTEM_ACCOUNT_CODES)) {
      const account = STANDARD_CHART.find((a) => a.code === code);
      expect(account, code).toBeDefined();
      expect(account?.isSystem, code).toBe(true);
    }
  });

  it('names every account in both languages', () => {
    for (const a of STANDARD_CHART) {
      expect(a.nameEn.length).toBeGreaterThan(0);
      expect(a.nameMy.length).toBeGreaterThan(0);
    }
  });

  it('builds account rows for a business with fresh ids', () => {
    const rows = standardChart(newId(), '2026-10-21T00:00:00Z');
    expect(rows).toHaveLength(STANDARD_CHART.length);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    expect(rows.find((r) => r.code === '1000')?.moneyKind).toBe('cash');
  });

  it('hands out the next free code in a group', () => {
    const used = STANDARD_CHART.map((a) => a.code);
    expect(nextAccountCode('money_out', used)).toBe('6120');
    expect(nextAccountCode('money_out', [...used, '6120'])).toBe('6130');
    expect(nextAccountCode('my_money', used)).toBe('1030');
  });
});
