import { describe, expect, it } from 'vitest';
import type { JournalEntry } from '../schema/journal.js';
import { SYSTEM_ACCOUNT_CODES as C } from './chart.js';
import {
  balancesFromJournal,
  contactOpenBalances,
  moneyBalances,
  moneyEffects,
  openBalances,
} from './device.js';
import { postDocument } from './posting.js';
import { balanceSheet, profitAndLoss } from './reports.js';
import { TestBooks } from './test-helpers.js';

/** Net debit of every money account in the posted entries (money only ever posts with basis both). */
function postedMoney(b: TestBooks, doc: Parameters<typeof postDocument>[0]): Map<string, number> {
  const { entries } = postDocument(doc, b.ctx);
  const out = new Map<string, number>();
  for (const e of entries) {
    for (const l of e.lines) {
      const account = b.accounts.find((a) => a.id === l.accountId);
      if (!account?.moneyKind) continue;
      out.set(l.accountId, (out.get(l.accountId) ?? 0) + l.debit - l.credit);
    }
  }
  return out;
}

function effectsMap(b: TestBooks, doc: Parameters<typeof moneyEffects>[0]): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of moneyEffects(doc)) {
    if (!b.accounts.find((a) => a.id === e.accountId)?.moneyKind) continue;
    out.set(e.accountId, (out.get(e.accountId) ?? 0) + e.delta);
  }
  return out;
}

describe('moneyEffects agrees with the posting rules', () => {
  const b = new TestBooks();
  const item = b.item('stocked');
  const customer = 'c1';

  const cases = () => {
    const saleLine = b.line({ itemId: item, quantityMilli: 2000, unitPrice: 5000, amount: 10_000 });
    b.lineCosts.set(saleLine.id, 6000);
    const creditSale = b.doc({
      type: 'sale',
      contactId: customer,
      lines: [saleLine],
      total: 10_000,
    });
    b.target(creditSale, postDocument(creditSale, b.ctx).entries, 'receivable');
    return [
      b.doc({
        type: 'sale',
        moneyAccountId: b.id('1020'),
        lines: [b.line({ amount: 20_000 })],
        total: 20_000,
        feeAmount: 300,
      }),
      creditSale,
      b.doc({
        type: 'expense',
        moneyAccountId: b.id(C.CASH),
        lines: [b.line({ accountId: b.id('6000'), amount: 150_000 })],
        total: 150_000,
      }),
      b.doc({
        type: 'purchase',
        contactId: 's1',
        lines: [b.line({ itemId: item, quantityMilli: 10_000, amount: 50_000 })],
        total: 50_000,
      }),
      b.doc({
        type: 'payment_in',
        contactId: customer,
        moneyAccountId: b.id('1020'),
        total: 12_000,
        feeAmount: 200,
        allocations: [{ documentId: creditSale.id, amount: 10_000 }],
      }),
      b.doc({
        type: 'payment_out',
        contactId: 's1',
        moneyAccountId: b.id('1010'),
        total: 30_000,
        feeAmount: 500,
      }),
      b.doc({ type: 'owner_in', moneyAccountId: b.id(C.CASH), total: 500_000 }),
      b.doc({ type: 'owner_out', moneyAccountId: b.id(C.CASH), total: 20_000 }),
      b.doc({
        type: 'transfer',
        moneyAccountId: b.id('1020'),
        toMoneyAccountId: b.id(C.CASH),
        total: 100_000,
        feeAmount: 1500,
      }),
      b.doc({
        type: 'opening_balance',
        lines: [
          b.line({ accountId: b.id(C.CASH), amount: 300_000 }),
          b.line({ accountId: b.id('1010'), amount: 1_000_000 }),
          b.line({ accountId: b.id('2200'), amount: 500_000 }),
          b.line({ itemId: item, quantityMilli: 50_000, unitPrice: 2000, amount: 100_000 }),
        ],
        total: 1_900_000,
      }),
    ];
  };

  it('matches every document type that moves money', () => {
    for (const doc of cases()) {
      expect(effectsMap(b, doc), doc.type).toEqual(postedMoney(b, doc));
    }
  });

  it('moves nothing for a void document', () => {
    const doc = b.doc({
      type: 'owner_in',
      moneyAccountId: b.id(C.CASH),
      total: 1000,
      status: 'void',
    });
    expect(moneyEffects(doc)).toEqual([]);
  });

  it('sums balances per money account and ignores non-money accounts', () => {
    const docs = cases();
    const balances = moneyBalances(docs, b.accounts);
    expect(balances.get(b.id(C.CASH))).toBe(-150_000 + 500_000 - 20_000 + 98_500 + 300_000);
    expect(balances.get(b.id('1020'))).toBe(19_700 + 11_800 - 100_000);
    expect(balances.get(b.id('1010'))).toBe(-30_500 + 1_000_000);
    expect(balances.has(b.id('2200'))).toBe(false);
  });
});

describe('open balances from documents', () => {
  const b = new TestBooks();
  const code = (id: string) => b.accounts.find((a) => a.id === id)?.code;

  it('settles credit documents from payment allocations, oldest first', () => {
    const older = b.doc({
      type: 'sale',
      date: '2026-10-01',
      contactId: 'c1',
      lines: [b.line({ amount: 10_000 })],
      total: 10_000,
    });
    const newer = b.doc({
      type: 'sale',
      date: '2026-10-05',
      contactId: 'c1',
      lines: [b.line({ amount: 5000 })],
      total: 5000,
    });
    const cashSale = b.doc({
      type: 'sale',
      moneyAccountId: b.id(C.CASH),
      lines: [b.line({ amount: 7000 })],
      total: 7000,
    });
    const bill = b.doc({
      type: 'expense',
      date: '2026-10-02',
      contactId: 's1',
      lines: [b.line({ accountId: b.id('6000'), amount: 40_000 })],
      total: 40_000,
    });
    const openingOwed = b.doc({
      type: 'opening_balance',
      date: '2026-09-30',
      contactId: 'c2',
      lines: [b.line({ accountId: b.id(C.RECEIVABLE), amount: 3000 })],
      total: 3000,
    });
    const payment = b.doc({
      type: 'payment_in',
      contactId: 'c1',
      moneyAccountId: b.id(C.CASH),
      total: 12_000,
      allocations: [
        { documentId: older.id, amount: 10_000 },
        { documentId: newer.id, amount: 2000 },
      ],
    });
    const voided = b.doc({
      type: 'payment_in',
      contactId: 'c1',
      moneyAccountId: b.id(C.CASH),
      total: 3000,
      status: 'void',
      allocations: [{ documentId: newer.id, amount: 3000 }],
    });

    const open = openBalances([newer, payment, cashSale, bill, older, openingOwed, voided], code);
    expect(open.map((o) => [o.documentId, o.kind, o.balance])).toEqual([
      [openingOwed.id, 'receivable', 3000],
      [older.id, 'receivable', 0],
      [bill.id, 'payable', 40_000],
      [newer.id, 'receivable', 3000],
    ]);

    const owedToMe = contactOpenBalances(open, 'receivable');
    expect(owedToMe).toEqual([
      { contactId: 'c2', balance: 3000, oldestOpenDate: '2026-09-30', openDocuments: 1 },
      { contactId: 'c1', balance: 3000, oldestOpenDate: '2026-10-05', openDocuments: 1 },
    ]);
    expect(contactOpenBalances(open, 'payable')).toEqual([
      { contactId: 's1', balance: 40_000, oldestOpenDate: '2026-10-02', openDocuments: 1 },
    ]);
  });
});

describe('reports from the pulled journal', () => {
  it('reads one basis per mode and respects the period', () => {
    const b = new TestBooks();
    const entry = (
      date: string,
      basis: JournalEntry['basis'],
      lines: { code: string; debit?: number; credit?: number }[],
    ): JournalEntry => ({
      id: `${date}-${basis}-${Math.random()}`,
      businessId: b.businessId,
      documentId: 'd',
      date,
      basis,
      createdAt: b.now,
      updatedAt: b.now,
      deletedAt: null,
      lines: lines.map((l) => ({
        accountId: b.id(l.code),
        debit: l.debit ?? 0,
        credit: l.credit ?? 0,
        contactId: null,
        itemId: null,
      })),
    });
    const entries = [
      entry('2026-10-01', 'both', [
        { code: C.CASH, debit: 10_000 },
        { code: C.SALES, credit: 10_000 },
      ]),
      entry('2026-10-02', 'accrual', [
        { code: C.RECEIVABLE, debit: 5000 },
        { code: C.SALES, credit: 5000 },
      ]),
      entry('2026-10-10', 'cash', [
        { code: C.RECEIVABLE, debit: 2000 },
        { code: C.SALES, credit: 2000 },
      ]),
      entry('2026-09-15', 'both', [
        { code: '6000', debit: 1000 },
        { code: C.CASH, credit: 1000 },
      ]),
    ];
    const october = { from: '2026-10-01', to: '2026-10-31' };
    const cash = profitAndLoss(balancesFromJournal(entries, b.accounts, 'cash', october));
    const accrual = profitAndLoss(balancesFromJournal(entries, b.accounts, 'accrual', october));
    expect(cash.totals.income).toBe(12_000);
    expect(accrual.totals.income).toBe(15_000);
    expect(cash.totals.expenses).toBe(0);

    const sheet = balanceSheet(balancesFromJournal(entries, b.accounts, 'accrual'));
    expect(sheet.totals.difference).toBe(0);
    expect(sheet.groups.find((g) => g.group === 'owed_to_me')?.total).toBe(5000);
    expect(sheet.profitToDate).toBe(14_000);
  });
});
