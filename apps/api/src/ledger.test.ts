import {
  type BalanceSheet,
  SYSTEM_ACCOUNT_CODES as C,
  type Document,
  type JournalEntry,
  newId,
  type ProfitAndLoss,
} from '@cannopy/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import type { ContactBalancesReport, MoneyReport, StockReport } from './services/reports.js';
import { closeTestDb, hasTestDb, testDb } from './test/db.js';
import { ApiClient } from './test/fixtures.js';

const config = { NODE_ENV: 'test' as const, LOG_LEVEL: 'error' as const, corsOrigins: [] };

type Posted = {
  document: Document;
  journalEntries: JournalEntry[];
  stockMovements: { value: number; quantityMilli: number }[];
};

describe.skipIf(!hasTestDb)('ledger through the API', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    const { db } = await testDb();
    app = await buildApp({ config, db });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  const bs = (c: ApiClient, basis: 'cash' | 'accrual', asOf = '2026-04-30') =>
    c.report<BalanceSheet & { mode: string }>('balance-sheet', `?basis=${basis}&asOf=${asOf}`);
  const pl = (c: ApiClient, basis: 'cash' | 'accrual') =>
    c.report<ProfitAndLoss>('profit-and-loss', `?basis=${basis}&from=2026-04-01&to=2026-04-30`);
  const groupTotal = (sheet: BalanceSheet, group: string) =>
    sheet.groups.find((g) => g.group === group)?.total ?? 0;

  it('creates a business with the standard chart and seeds the change log', async () => {
    const c = new ApiClient(app);
    const { accounts } = await c.createBusiness();
    expect(accounts).toHaveLength(35);
    expect(accounts.find((a) => a.code === '1000')?.isSystem).toBe(true);
    const pull = await c.ok<{ changes: unknown[] }>(
      'GET',
      `/sync/pull?businessId=${c.businessId}&since=0`,
    );
    expect(pull.changes).toHaveLength(35);
  });

  it('runs a month of trading and keeps both journals, stock and balances consistent', async () => {
    const c = new ApiClient(app);
    await c.createBusiness('cash');
    const customer = await c.contact({ name: { en: 'Ko Aung', my: 'ကိုအောင်' } });
    const supplier = await c.contact({ name: { en: 'Rice mill', my: 'ဆန်စက်' }, isCustomer: false });
    const rice = await c.item({ name: { en: 'Rice bag', my: 'ဆန်အိတ်' }, sellingPrice: 60_000 });

    // Opening: 500 000 cash, a customer who already owes 40 000.
    await c.post({
      type: 'opening_balance',
      date: '2026-03-31',
      lines: [c.line({ accountId: c.cash, amount: 500_000 })],
      total: 500_000,
    });
    const openingAr = await c.post({
      type: 'opening_balance',
      date: '2026-03-31',
      contactId: customer.id,
      lines: [c.line({ accountId: c.account(C.RECEIVABLE), amount: 40_000 })],
      total: 40_000,
    });
    expect(openingAr.document.status).toBe('open');

    // Buy 10 bags on credit at 45 000, then 10 more for cash at 50 000: average 47 500.
    const purchase1 = await c.post({
      type: 'purchase',
      date: '2026-04-02',
      contactId: supplier.id,
      lines: [
        c.line({ itemId: rice.id, quantityMilli: 10_000, unitPrice: 45_000, amount: 450_000 }),
      ],
      total: 450_000,
    });
    expect(purchase1.document.number).toBe(1);
    await c.post({
      type: 'purchase',
      date: '2026-04-03',
      moneyAccountId: c.cash,
      contactId: supplier.id,
      lines: [
        c.line({ itemId: rice.id, quantityMilli: 10_000, unitPrice: 50_000, amount: 500_000 }),
      ],
      total: 500_000,
    });
    let stock = await c.report<StockReport>('stock');
    expect(stock.items[0]).toMatchObject({
      quantityOnHandMilli: 20_000,
      averageCost: 47_500,
      stockValue: 950_000,
    });

    // Sell 4 bags for cash and 6 on credit.
    const cashSale = await c.post({
      type: 'sale',
      date: '2026-04-05',
      moneyAccountId: c.cash,
      lines: [c.line({ itemId: rice.id, quantityMilli: 4000, unitPrice: 60_000, amount: 240_000 })],
      total: 240_000,
    });
    expect(cashSale.document.status).toBe('paid');
    const creditSale = await c.post({
      type: 'sale',
      date: '2026-04-06',
      contactId: customer.id,
      lines: [c.line({ itemId: rice.id, quantityMilli: 6000, unitPrice: 60_000, amount: 360_000 })],
      total: 360_000,
    });
    expect(creditSale.document.status).toBe('open');
    const creditSalePosted = await c.ok<Posted>(
      'GET',
      `/businesses/${c.businessId}/documents/${creditSale.document.id}`,
    );
    expect(creditSalePosted.journalEntries.map((e) => e.basis)).toEqual(['accrual']);
    expect(creditSalePosted.stockMovements[0]?.value).toBe(-285_000);

    // Rent paid in cash, a phone bill still owed.
    await c.post({
      type: 'expense',
      date: '2026-04-07',
      moneyAccountId: c.cash,
      lines: [c.line({ accountId: c.account('6000'), amount: 100_000 })],
      total: 100_000,
    });
    const bill = await c.post({
      type: 'expense',
      date: '2026-04-08',
      contactId: supplier.id,
      lines: [c.line({ accountId: c.account('6030'), amount: 20_000 })],
      total: 20_000,
    });

    // Reports before any payment.
    let accrual = await pl(c, 'accrual');
    let cash = await pl(c, 'cash');
    expect(accrual.totals).toMatchObject({
      income: 600_000,
      costOfSales: 475_000,
      expenses: 120_000,
      netProfit: 5000,
    });
    expect(cash.totals).toMatchObject({
      income: 240_000,
      costOfSales: 190_000,
      expenses: 100_000,
      netProfit: -50_000,
    });

    let receivables = await c.report<ContactBalancesReport>('receivables');
    expect(receivables.total).toBe(400_000);
    expect(receivables.contacts[0]).toMatchObject({
      contactId: customer.id,
      balance: 400_000,
      oldestOpenDate: '2026-03-31',
      openDocuments: 2,
    });
    let payables = await c.report<ContactBalancesReport>('payables');
    expect(payables.total).toBe(470_000);

    // Invariant: Customers owe me in the accrual journal equals the open sale balances.
    let accrualSheet = await bs(c, 'accrual');
    expect(groupTotal(accrualSheet, 'owed_to_me')).toBe(400_000);
    expect(groupTotal(accrualSheet, 'i_owe')).toBe(470_000);
    expect(accrualSheet.totals.difference).toBe(0);
    // Invariant: the cash balance sheet carries no receivables or payables and still balances.
    let cashSheet = await bs(c, 'cash');
    expect(groupTotal(cashSheet, 'owed_to_me')).toBe(0);
    expect(groupTotal(cashSheet, 'i_owe')).toBe(0);
    expect(cashSheet.totals.difference).toBe(0);
    // Invariant: Stock on hand (accrual) equals the sum of item stock values.
    stock = await c.report<StockReport>('stock');
    expect(groupTotal(accrualSheet, 'stock')).toBe(stock.totalValue);
    expect(stock.totalValue).toBe(475_000);

    // The customer pays 100 000, oldest first: 40 000 clears the opening balance, 60 000 goes to the sale.
    const open = await c.ok<{ documents: { documentId: string; balance: number }[] }>(
      'GET',
      `/businesses/${c.businessId}/contacts/${customer.id}/open-documents`,
    );
    expect(open.documents.map((d) => d.balance)).toEqual([40_000, 360_000]);
    const payment = await c.post({
      type: 'payment_in',
      date: '2026-04-12',
      contactId: customer.id,
      moneyAccountId: c.cash,
      allocations: [
        { documentId: openingAr.document.id, amount: 40_000 },
        { documentId: creditSale.document.id, amount: 60_000 },
      ],
      total: 100_000,
    });
    expect(payment.document.status).toBe('paid');
    const sale = await c.ok<Posted>(
      'GET',
      `/businesses/${c.businessId}/documents/${creditSale.document.id}`,
    );
    expect(sale.document).toMatchObject({ paidAmount: 60_000, status: 'partly_paid' });

    cash = await pl(c, 'cash');
    // Cash income: 240 000 + 60 000; cash cost of goods: 190 000 + one sixth of 285 000.
    expect(cash.totals.income).toBe(300_000);
    expect(cash.totals.costOfSales).toBe(237_500);
    receivables = await c.report<ContactBalancesReport>('receivables');
    expect(receivables.total).toBe(300_000);
    accrualSheet = await bs(c, 'accrual');
    expect(groupTotal(accrualSheet, 'owed_to_me')).toBe(300_000);
    cashSheet = await bs(c, 'cash');
    expect(groupTotal(cashSheet, 'owed_to_me')).toBe(0);
    expect(cashSheet.totals.difference).toBe(0);

    // Pay the supplier for the credit purchase and the phone bill from the bank account.
    await c.post({
      type: 'payment_out',
      date: '2026-04-15',
      contactId: supplier.id,
      moneyAccountId: c.cash,
      allocations: [
        { documentId: purchase1.document.id, amount: 450_000 },
        { documentId: bill.document.id, amount: 20_000 },
      ],
      total: 470_000,
    });
    payables = await c.report<ContactBalancesReport>('payables');
    expect(payables.total).toBe(0);
    cash = await pl(c, 'cash');
    expect(cash.totals.expenses).toBe(120_000);
    accrual = await pl(c, 'accrual');
    expect(accrual.totals.expenses).toBe(120_000);

    const money = await c.report<MoneyReport>('money', '?date=2026-04-30');
    expect(money.total).toBe(500_000 - 500_000 + 240_000 - 100_000 + 100_000 - 470_000);

    // The mode switch changes nothing but which journal reports read.
    const switched = await c.ok<{ accountingMode: string }>(
      'PUT',
      `/businesses/${c.businessId}/accounting-mode`,
      { mode: 'accrual' },
    );
    expect(switched.accountingMode).toBe('accrual');
    const defaultReport = await c.report<ProfitAndLoss & { mode: string }>(
      'profit-and-loss',
      '?from=2026-04-01&to=2026-04-30',
    );
    expect(defaultReport.mode).toBe('accrual');
    expect(defaultReport.totals).toEqual(accrual.totals);
    await c.ok('PUT', `/businesses/${c.businessId}/accounting-mode`, { mode: 'cash' });
    expect((await pl(c, 'cash')).totals).toEqual(cash.totals);
  });

  it('reposts sales when a late purchase changes the average cost, and when a sale is edited', async () => {
    const c = new ApiClient(app);
    await c.createBusiness();
    const customer = await c.contact();
    const item = await c.item();

    await c.post({
      type: 'purchase',
      date: '2026-04-01',
      moneyAccountId: c.cash,
      lines: [c.line({ itemId: item.id, quantityMilli: 10_000, amount: 100_000 })],
      total: 100_000,
    });
    const sale = await c.post({
      type: 'sale',
      date: '2026-04-10',
      contactId: customer.id,
      lines: [c.line({ itemId: item.id, quantityMilli: 5000, amount: 100_000 })],
      total: 100_000,
    });
    let posted = await c.ok<Posted>(
      'GET',
      `/businesses/${c.businessId}/documents/${sale.document.id}`,
    );
    expect(posted.stockMovements[0]?.value).toBe(-50_000);

    // A purchase dated before the sale at a higher price raises the average to 15 000.
    await c.post({
      type: 'purchase',
      date: '2026-04-05',
      moneyAccountId: c.cash,
      lines: [c.line({ itemId: item.id, quantityMilli: 10_000, amount: 200_000 })],
      total: 200_000,
    });
    posted = await c.ok<Posted>('GET', `/businesses/${c.businessId}/documents/${sale.document.id}`);
    expect(posted.stockMovements[0]?.value).toBe(-75_000);
    const cogs = posted.journalEntries[0]?.lines.find(
      (l) => l.accountId === c.account(C.COST_OF_GOODS_SOLD),
    );
    expect(cogs?.debit).toBe(75_000);

    // Partial payment, then the sale is edited to a smaller amount: the payment's cash share is reposted.
    await c.post({
      type: 'payment_in',
      date: '2026-04-12',
      contactId: customer.id,
      moneyAccountId: c.cash,
      allocations: [{ documentId: sale.document.id, amount: 50_000 }],
      total: 50_000,
    });
    let cash = await pl(c, 'cash');
    expect(cash.totals.income).toBe(50_000);
    expect(cash.totals.costOfSales).toBe(37_500);

    await c.post({
      ...sale.document,
      id: sale.document.id,
      lines: [c.line({ itemId: item.id, quantityMilli: 4000, amount: 80_000 })],
      total: 80_000,
      updatedAt: '2026-04-13T00:00:00Z',
    });
    posted = await c.ok<Posted>('GET', `/businesses/${c.businessId}/documents/${sale.document.id}`);
    expect(posted.document).toMatchObject({
      paidAmount: 50_000,
      status: 'partly_paid',
      total: 80_000,
    });
    cash = await pl(c, 'cash');
    expect(cash.totals.income).toBe(50_000);
    // 5/8 of the new cost of goods sold (4 units at 15 000).
    expect(cash.totals.costOfSales).toBe(37_500);
    const stock = await c.report<StockReport>('stock');
    expect(stock.items[0]).toMatchObject({ quantityOnHandMilli: 16_000, stockValue: 240_000 });
    const sheet = await bs(c, 'accrual');
    expect(sheet.groups.find((g) => g.group === 'stock')?.total).toBe(240_000);
    expect(sheet.totals.difference).toBe(0);

    // A sale with payments cannot be deleted until the payment is removed.
    const refused = await c.request(
      'DELETE',
      `/businesses/${c.businessId}/documents/${sale.document.id}`,
    );
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toBe('has_payments');
  });

  it('warns on negative stock and rejects what the posting rules refuse', async () => {
    const c = new ApiClient(app);
    await c.createBusiness();
    const item = await c.item();
    const sale = await c.post({
      type: 'sale',
      moneyAccountId: c.cash,
      lines: [c.line({ itemId: item.id, quantityMilli: 1000, amount: 5000 })],
      total: 5000,
    });
    expect(sale.warnings).toEqual([
      expect.objectContaining({ code: 'negative_stock', itemId: item.id }),
    ]);
    const stock = await c.report<StockReport>('stock');
    expect(stock.items[0]?.negative).toBe(true);

    const noCustomer = await c.request(
      'PUT',
      `/businesses/${c.businessId}/documents/${newId()}`,
      c.documentBody({
        type: 'sale',
        lines: [c.line({ amount: 100 })],
        total: 100,
      }),
    );
    expect(noCustomer.statusCode).toBe(422);
    expect(noCustomer.json().error).toBe('contact_required');

    const badTotal = await c.request(
      'PUT',
      `/businesses/${c.businessId}/documents/${newId()}`,
      c.documentBody({
        type: 'sale',
        moneyAccountId: c.cash,
        lines: [c.line({ amount: 100 })],
        total: 101,
      }),
    );
    expect(badTotal.statusCode).toBe(422);
    expect(badTotal.json().error).toBe('total_mismatch');

    const unknownItem = await c.request(
      'PUT',
      `/businesses/${c.businessId}/documents/${newId()}`,
      c.documentBody({
        type: 'sale',
        moneyAccountId: c.cash,
        lines: [c.line({ itemId: newId(), amount: 100 })],
        total: 100,
      }),
    );
    expect(unknownItem.statusCode).toBe(422);
  });

  it('applies pushed document mutations through the posting rules and logs the derived rows', async () => {
    const c = new ApiClient(app);
    await c.createBusiness();
    const since = (
      await c.ok<{ serverSeq: number }>(
        'GET',
        `/sync/pull?businessId=${c.businessId}&since=0&limit=1000`,
      )
    ).serverSeq;
    const docId = newId();
    const mutation = {
      id: newId(),
      entity: 'document',
      entityId: docId,
      op: 'upsert',
      data: c.documentBody({ type: 'owner_in', moneyAccountId: c.cash, total: 50_000 }),
      clientAt: '2026-04-10T06:00:00Z',
      deviceId: 'phone-1',
    };
    const first = await c.ok<{ accepted: string[]; rejected: unknown[] }>('POST', '/sync/push', {
      businessId: c.businessId,
      mutations: [mutation],
    });
    expect(first.accepted).toEqual([mutation.id]);
    expect(first.rejected).toEqual([]);
    // A retried push is accepted again and applied once.
    const again = await c.ok<{ accepted: string[] }>('POST', '/sync/push', {
      businessId: c.businessId,
      mutations: [mutation],
    });
    expect(again.accepted).toEqual([mutation.id]);

    const pull = await c.ok<{
      changes: { entity: string; op: string; data: Record<string, unknown> }[];
    }>('GET', `/sync/pull?businessId=${c.businessId}&since=${since}`);
    expect(pull.changes.map((ch) => ch.entity)).toEqual(['journal_entry', 'document']);
    expect(pull.changes[1]?.data).toMatchObject({ id: docId, number: 1, status: 'paid' });
    const money = await c.report<MoneyReport>('money', '?date=2026-04-30');
    expect(money.total).toBe(50_000);

    const bad = await c.ok<{ rejected: { reason: string }[] }>('POST', '/sync/push', {
      businessId: c.businessId,
      mutations: [{ ...mutation, id: newId(), entity: 'journal_entry' }],
    });
    expect(bad.rejected[0]?.reason).toMatch(/server_owned/);
  });
});
