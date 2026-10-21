import { describe, expect, it } from 'vitest';
import { bilingual } from '../i18n/label.js';
import { allocateOldestFirst } from './allocation.js';
import { fiscalYearRange, monthRange } from './fiscal.js';
import { type AccountBalance, balanceSheet, profitAndLoss } from './reports.js';

const bal = (
  code: string,
  type: AccountBalance['type'],
  ownerGroup: AccountBalance['ownerGroup'],
  debit: number,
  credit: number,
): AccountBalance => ({
  accountId: code,
  code,
  type,
  ownerGroup,
  name: bilingual(code),
  isHidden: false,
  debit,
  credit,
});

const books = [
  bal('1000', 'asset', 'my_money', 120_000, 30_000),
  bal('1100', 'asset', 'owed_to_me', 50_000, 20_000),
  bal('1200', 'asset', 'stock', 40_000, 15_000),
  bal('2000', 'liability', 'i_owe', 5000, 25_000),
  bal('3000', 'equity', 'owner', 0, 100_000),
  bal('4000', 'income', 'money_in', 0, 60_000),
  bal('5000', 'cost_of_sales', 'money_out', 15_000, 0),
  bal('6000', 'expense', 'money_out', 20_000, 0),
];

describe('reports', () => {
  it('profit and loss sums income, cost of sales and expenses', () => {
    const pl = profitAndLoss(books);
    expect(pl.totals).toEqual({
      income: 60_000,
      costOfSales: 15_000,
      grossProfit: 45_000,
      expenses: 20_000,
      netProfit: 25_000,
    });
    expect(pl.income[0]?.amount).toBe(60_000);
  });

  it('balance sheet groups by owner group and balances with profit to date', () => {
    const bs = balanceSheet(books);
    expect(bs.totals.own).toBe(90_000 + 30_000 + 25_000);
    expect(bs.totals.owe).toBe(20_000);
    expect(bs.profitToDate).toBe(25_000);
    expect(bs.totals.owner).toBe(125_000);
    expect(bs.totals.difference).toBe(0);
  });
});

describe('allocation', () => {
  it('settles the oldest open document first and reports the leftover', () => {
    const open = [
      { documentId: 'b', date: '2026-10-05', total: 5000, paidAmount: 0 },
      { documentId: 'a', date: '2026-10-01', total: 3000, paidAmount: 1000 },
      { documentId: 'c', date: '2026-10-09', total: 1000, paidAmount: 1000 },
    ];
    expect(allocateOldestFirst(6000, open)).toEqual({
      allocations: [
        { documentId: 'a', amount: 2000 },
        { documentId: 'b', amount: 4000 },
      ],
      unallocated: 0,
    });
    expect(allocateOldestFirst(8000, open).unallocated).toBe(1000);
  });
});

describe('fiscal periods', () => {
  it('finds the April to March year', () => {
    expect(fiscalYearRange('2026-10-21', 4)).toEqual({
      from: '2026-04-01',
      to: '2027-03-31',
      label: '2026-27',
    });
    expect(fiscalYearRange('2026-02-10', 4)).toEqual({
      from: '2025-04-01',
      to: '2026-03-31',
      label: '2025-26',
    });
    expect(fiscalYearRange('2026-02-10', 1)).toEqual({
      from: '2026-01-01',
      to: '2026-12-31',
      label: '2026',
    });
  });
  it('finds the month', () => {
    expect(monthRange('2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
});
