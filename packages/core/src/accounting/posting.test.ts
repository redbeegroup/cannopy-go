import { describe, expect, it } from 'vitest';
import { SYSTEM_ACCOUNT_CODES as C } from './chart.js';
import { PostingError, postDocument, recogniseProRata } from './posting.js';
import { ACCRUAL, balance, CASH, findLine, TestBooks } from './test-helpers.js';

describe('sale', () => {
  it('posts a cash sale once with basis both, including cost of goods sold', () => {
    const b = new TestBooks();
    const item = b.item('stocked');
    const l = b.line({ itemId: item, quantityMilli: 2000, unitPrice: 5000, amount: 10_000 });
    b.lineCosts.set(l.id, 6000);
    const doc = b.doc({ type: 'sale', moneyAccountId: b.id(C.CASH), lines: [l], total: 10_000 });
    const { entries, movements } = postDocument(doc, b.ctx);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.basis).toBe('both');
    expect(balance(entries, b.id(C.CASH), CASH)).toBe(10_000);
    expect(balance(entries, b.id(C.SALES), CASH)).toBe(-10_000);
    expect(balance(entries, b.id(C.COST_OF_GOODS_SOLD), CASH)).toBe(6000);
    expect(balance(entries, b.id(C.STOCK), CASH)).toBe(-6000);
    expect(movements).toEqual([
      { itemId: item, lineId: l.id, date: doc.date, quantityMilli: -2000, value: 0 },
    ]);
  });

  it('posts a credit sale to the accrual journal only', () => {
    const b = new TestBooks();
    const customer = 'c';
    const doc = b.doc({
      type: 'sale',
      contactId: customer,
      lines: [b.line({ amount: 10_000 })],
      total: 10_000,
    });
    const { entries } = postDocument(doc, b.ctx);
    expect(entries.map((e) => e.basis)).toEqual(['accrual']);
    expect(balance(entries, b.id(C.RECEIVABLE), ACCRUAL)).toBe(10_000);
    expect(balance(entries, b.id(C.SALES), ACCRUAL)).toBe(-10_000);
    expect(balance(entries, b.id(C.SALES), CASH)).toBe(0);
    expect(findLine(entries[0]!, b.id(C.RECEIVABLE))?.contactId).toBe(customer);
  });

  it('collects tax into Tax collected on sales', () => {
    const b = new TestBooks();
    const doc = b.doc({
      type: 'sale',
      moneyAccountId: b.id(C.CASH),
      lines: [b.line({ amount: 10_000, taxAmount: 500 })],
      total: 10_500,
    });
    const { entries } = postDocument(doc, b.ctx);
    expect(balance(entries, b.id(C.TAX_COLLECTED), CASH)).toBe(-500);
    expect(balance(entries, b.id(C.CASH), CASH)).toBe(10_500);
  });

  it('deducts a wallet fee from what reaches the money account', () => {
    const b = new TestBooks();
    const doc = b.doc({
      type: 'sale',
      moneyAccountId: b.id('1020'),
      lines: [b.line({ amount: 10_000 })],
      total: 10_000,
      feeAmount: 150,
    });
    const { entries } = postDocument(doc, b.ctx);
    expect(balance(entries, b.id('1020'), CASH)).toBe(9850);
    expect(balance(entries, b.id(C.PAYMENT_FEES), CASH)).toBe(150);
    expect(balance(entries, b.id(C.SALES), CASH)).toBe(-10_000);
  });

  it('rejects a credit sale without a customer and a total that does not match its lines', () => {
    const b = new TestBooks();
    expect(() =>
      postDocument(b.doc({ type: 'sale', lines: [b.line({ amount: 100 })], total: 100 }), b.ctx),
    ).toThrow(PostingError);
    expect(() =>
      postDocument(
        b.doc({
          type: 'sale',
          moneyAccountId: b.id(C.CASH),
          lines: [b.line({ amount: 100 })],
          total: 99,
        }),
        b.ctx,
      ),
    ).toThrowError(/total/);
  });

  it('posts nothing for a void document', () => {
    const b = new TestBooks();
    const doc = b.doc({
      type: 'sale',
      moneyAccountId: b.id(C.CASH),
      lines: [b.line({ amount: 100 })],
      total: 100,
      status: 'void',
    });
    expect(postDocument(doc, b.ctx)).toEqual({ entries: [], movements: [], warnings: [] });
  });
});

describe('payment received against a credit sale', () => {
  function creditSale(b: TestBooks, customer: string) {
    const item = b.item('stocked');
    const l = b.line({ itemId: item, quantityMilli: 1000, amount: 10_000 });
    b.lineCosts.set(l.id, 6000);
    const sale = b.doc({ type: 'sale', contactId: customer, lines: [l], total: 10_000 });
    const posted = postDocument(sale, b.ctx);
    b.target(sale, posted.entries, 'receivable');
    return { sale, posted };
  }

  it('recognises income and cost of goods sold pro rata in the cash journal', () => {
    const b = new TestBooks();
    const customer = 'cust';
    const { sale } = creditSale(b, customer);
    const payment = b.doc({
      type: 'payment_in',
      date: '2026-10-25',
      contactId: customer,
      moneyAccountId: b.id(C.CASH),
      allocations: [{ documentId: sale.id, amount: 4000 }],
      total: 4000,
    });
    const { entries } = postDocument(payment, b.ctx);

    expect(entries.map((e) => e.basis)).toEqual(['both', 'cash']);
    // Both journals: money in, customer owes less.
    expect(balance(entries, b.id(C.CASH), CASH)).toBe(4000);
    expect(balance(entries, b.id(C.RECEIVABLE), ACCRUAL)).toBe(-4000);
    // Cash journal: 40% of the sale, and the receivable nets to zero.
    expect(balance(entries, b.id(C.SALES), CASH)).toBe(-4000);
    expect(balance(entries, b.id(C.COST_OF_GOODS_SOLD), CASH)).toBe(2400);
    expect(balance(entries, b.id(C.STOCK), CASH)).toBe(-2400);
    expect(balance(entries, b.id(C.RECEIVABLE), CASH)).toBe(0);
    // Accrual journal sees no income from the payment: it was recognised on the sale.
    expect(balance(entries, b.id(C.SALES), ['accrual'])).toBe(0);
  });

  it('never recognises more than the accrual income and matches it exactly once fully paid', () => {
    const b = new TestBooks();
    const customer = 'cust';
    const { sale, posted } = creditSale(b, customer);
    const splits = [3333, 1, 2222, 4444];
    let paid = 0;
    let cashIncome = 0;
    let cashCogs = 0;
    for (const amount of splits) {
      b.target(sale, posted.entries, 'receivable', paid);
      const payment = b.doc({
        type: 'payment_in',
        contactId: customer,
        moneyAccountId: b.id(C.CASH),
        allocations: [{ documentId: sale.id, amount }],
        total: amount,
      });
      const { entries } = postDocument(payment, b.ctx);
      paid += amount;
      cashIncome += -balance(entries, b.id(C.SALES), CASH);
      cashCogs += balance(entries, b.id(C.COST_OF_GOODS_SOLD), CASH);
      expect(cashIncome).toBeLessThanOrEqual(10_000);
      expect(cashCogs).toBeLessThanOrEqual(6000);
      expect(balance(entries, b.id(C.RECEIVABLE), CASH)).toBe(0);
    }
    expect(paid).toBe(10_000);
    expect(cashIncome).toBe(10_000);
    expect(cashCogs).toBe(6000);
  });

  it('turns an overpayment into a customer advance and recognises it as cash-basis income', () => {
    const b = new TestBooks();
    const customer = 'cust';
    const { sale } = creditSale(b, customer);
    const payment = b.doc({
      type: 'payment_in',
      contactId: customer,
      moneyAccountId: b.id(C.CASH),
      allocations: [{ documentId: sale.id, amount: 10_000 }],
      total: 12_000,
    });
    const { entries } = postDocument(payment, b.ctx);
    expect(balance(entries, b.id(C.CUSTOMER_ADVANCE), ACCRUAL)).toBe(-2000);
    expect(balance(entries, b.id(C.CUSTOMER_ADVANCE), CASH)).toBe(0);
    expect(balance(entries, b.id(C.SALES), CASH)).toBe(-12_000);
    expect(balance(entries, b.id(C.SALES), ['accrual'])).toBe(0);
  });

  it('rejects paying more than a document still owes', () => {
    const b = new TestBooks();
    const customer = 'cust';
    const { sale, posted } = creditSale(b, customer);
    b.target(sale, posted.entries, 'receivable', 8000);
    const payment = b.doc({
      type: 'payment_in',
      contactId: customer,
      moneyAccountId: b.id(C.CASH),
      allocations: [{ documentId: sale.id, amount: 3000 }],
      total: 3000,
    });
    expect(() => postDocument(payment, b.ctx)).toThrowError(/exceeds/);
  });

  it('rejects allocating a payment in to a bill', () => {
    const b = new TestBooks();
    const supplier = 'sup';
    const bill = b.doc({
      type: 'expense',
      contactId: supplier,
      lines: [b.line({ accountId: b.id('6000'), amount: 5000 })],
      total: 5000,
    });
    b.target(bill, postDocument(bill, b.ctx).entries, 'payable');
    const payment = b.doc({
      type: 'payment_in',
      contactId: supplier,
      moneyAccountId: b.id(C.CASH),
      allocations: [{ documentId: bill.id, amount: 5000 }],
      total: 5000,
    });
    expect(() => postDocument(payment, b.ctx)).toThrowError(/not a receivable/);
  });
});

describe('bills and payments out', () => {
  it('posts an unpaid expense to the accrual journal and recognises it when paid', () => {
    const b = new TestBooks();
    const supplier = 'sup';
    const bill = b.doc({
      type: 'expense',
      contactId: supplier,
      lines: [b.line({ accountId: b.id('6000'), amount: 50_000 })],
      total: 50_000,
    });
    const posted = postDocument(bill, b.ctx);
    expect(posted.entries.map((e) => e.basis)).toEqual(['accrual']);
    expect(balance(posted.entries, b.id('6000'), ACCRUAL)).toBe(50_000);
    expect(balance(posted.entries, b.id(C.PAYABLE), ACCRUAL)).toBe(-50_000);

    b.target(bill, posted.entries, 'payable');
    const pay = b.doc({
      type: 'payment_out',
      contactId: supplier,
      moneyAccountId: b.id('1010'),
      allocations: [{ documentId: bill.id, amount: 50_000 }],
      total: 50_000,
    });
    const { entries } = postDocument(pay, b.ctx);
    expect(balance(entries, b.id('1010'), CASH)).toBe(-50_000);
    expect(balance(entries, b.id(C.PAYABLE), ACCRUAL)).toBe(50_000);
    expect(balance(entries, b.id(C.PAYABLE), CASH)).toBe(0);
    expect(balance(entries, b.id('6000'), CASH)).toBe(50_000);
    expect(balance(entries, b.id('6000'), ['accrual'])).toBe(0);
  });

  it('posts a stock purchase on credit to Stock on hand and reaches the cash journal when paid', () => {
    const b = new TestBooks();
    const supplier = 'sup';
    const item = b.item('stocked');
    const l = b.line({ itemId: item, quantityMilli: 10_000, unitPrice: 800, amount: 8000 });
    const purchase = b.doc({ type: 'purchase', contactId: supplier, lines: [l], total: 8000 });
    const posted = postDocument(purchase, b.ctx);
    expect(posted.movements).toEqual([
      { itemId: item, lineId: l.id, date: purchase.date, quantityMilli: 10_000, value: 8000 },
    ]);
    expect(balance(posted.entries, b.id(C.STOCK), ACCRUAL)).toBe(8000);
    expect(balance(posted.entries, b.id(C.STOCK), CASH)).toBe(0);

    b.target(purchase, posted.entries, 'payable');
    const pay = b.doc({
      type: 'payment_out',
      contactId: supplier,
      moneyAccountId: b.id(C.CASH),
      allocations: [{ documentId: purchase.id, amount: 8000 }],
      total: 8000,
    });
    const { entries } = postDocument(pay, b.ctx);
    expect(balance(entries, b.id(C.STOCK), CASH)).toBe(8000);
    expect(balance(entries, b.id(C.CASH), CASH)).toBe(-8000);
  });

  it('expenses a purchase of an item that is not tracked as stock', () => {
    const b = new TestBooks();
    const item = b.item('not_tracked');
    const purchase = b.doc({
      type: 'purchase',
      moneyAccountId: b.id(C.CASH),
      lines: [b.line({ itemId: item, quantityMilli: 1000, amount: 3000 })],
      total: 3000,
    });
    const { entries, movements } = postDocument(purchase, b.ctx);
    expect(movements).toEqual([]);
    expect(balance(entries, b.id(C.PURCHASES), CASH)).toBe(3000);
    expect(balance(entries, b.id(C.STOCK), CASH)).toBe(0);
  });

  it('charges a fee on top of a payment out and books a supplier advance for the excess', () => {
    const b = new TestBooks();
    const pay = b.doc({
      type: 'payment_out',
      contactId: 'sup',
      moneyAccountId: b.id('1020'),
      allocations: [],
      total: 20_000,
      feeAmount: 300,
    });
    const { entries } = postDocument(pay, b.ctx);
    expect(balance(entries, b.id('1020'), CASH)).toBe(-20_300);
    expect(balance(entries, b.id(C.PAYMENT_FEES), CASH)).toBe(300);
    expect(balance(entries, b.id(C.SUPPLIER_ADVANCE), ACCRUAL)).toBe(20_000);
    expect(balance(entries, b.id(C.SUPPLIER_ADVANCE), CASH)).toBe(0);
    expect(balance(entries, b.id(C.PURCHASES), CASH)).toBe(20_000);
  });
});

describe('owner money, transfers, stock adjustments, opening balances', () => {
  it('posts owner money in and out against capital and drawings', () => {
    const b = new TestBooks();
    const inn = postDocument(
      b.doc({ type: 'owner_in', moneyAccountId: b.id(C.CASH), total: 500_000 }),
      b.ctx,
    );
    const out = postDocument(
      b.doc({ type: 'owner_out', moneyAccountId: b.id(C.CASH), total: 20_000 }),
      b.ctx,
    );
    expect(balance(inn.entries, b.id(C.OWNER_CAPITAL), CASH)).toBe(-500_000);
    expect(balance(out.entries, b.id(C.OWNER_DRAWINGS), CASH)).toBe(20_000);
    expect(balance([...inn.entries, ...out.entries], b.id(C.CASH), ACCRUAL)).toBe(480_000);
  });

  it('moves money between accounts with the cash-out fee as an expense', () => {
    const b = new TestBooks();
    const { entries } = postDocument(
      b.doc({
        type: 'transfer',
        moneyAccountId: b.id('1020'),
        toMoneyAccountId: b.id(C.CASH),
        total: 100_000,
        feeAmount: 1500,
      }),
      b.ctx,
    );
    expect(balance(entries, b.id('1020'), CASH)).toBe(-100_000);
    expect(balance(entries, b.id(C.CASH), CASH)).toBe(98_500);
    expect(balance(entries, b.id(C.PAYMENT_FEES), CASH)).toBe(1500);
  });

  it('posts a stock count difference to Stock loss or gain at cost', () => {
    const b = new TestBooks();
    const item = b.item('stocked');
    const loss = b.line({ itemId: item, quantityMilli: -2000, amount: 0 });
    b.lineCosts.set(loss.id, 1300);
    const gain = b.line({ itemId: item, quantityMilli: 1000, unitPrice: 700, amount: 700 });
    const { entries, movements } = postDocument(
      b.doc({ type: 'stock_adjustment', lines: [loss, gain], total: 0 }),
      b.ctx,
    );
    expect(balance(entries, b.id(C.STOCK), CASH)).toBe(-600);
    expect(balance(entries, b.id(C.STOCK_ADJUSTMENT), CASH)).toBe(600);
    expect(movements.map((m) => [m.quantityMilli, m.value])).toEqual([
      [-2000, 0],
      [1000, 700],
    ]);
  });

  it('posts opening balances against Opening balance adjustment', () => {
    const b = new TestBooks();
    const item = b.item('stocked');
    const { entries, movements } = postDocument(
      b.doc({
        type: 'opening_balance',
        date: '2026-03-31',
        lines: [
          b.line({ accountId: b.id(C.CASH), amount: 300_000 }),
          b.line({ accountId: b.id('1010'), amount: 1_000_000 }),
          b.line({ accountId: b.id('2200'), amount: 500_000 }),
          b.line({ itemId: item, quantityMilli: 50_000, unitPrice: 2000, amount: 100_000 }),
        ],
        total: 1_900_000,
      }),
      b.ctx,
    );
    expect(entries.map((e) => e.basis)).toEqual(['both']);
    expect(balance(entries, b.id(C.OPENING_BALANCE), CASH)).toBe(-900_000);
    expect(balance(entries, b.id('2200'), CASH)).toBe(-500_000);
    expect(movements).toHaveLength(1);
  });

  it('keeps an opening receivable out of the cash journal until it is collected', () => {
    const b = new TestBooks();
    const customer = 'cust';
    const opening = b.doc({
      type: 'opening_balance',
      date: '2026-03-31',
      contactId: customer,
      lines: [b.line({ accountId: b.id(C.RECEIVABLE), amount: 40_000 })],
      total: 40_000,
    });
    const posted = postDocument(opening, b.ctx);
    expect(posted.entries.map((e) => e.basis)).toEqual(['accrual']);
    expect(balance(posted.entries, b.id(C.RECEIVABLE), ACCRUAL)).toBe(40_000);

    b.target(opening, posted.entries, 'receivable');
    const { entries } = postDocument(
      b.doc({
        type: 'payment_in',
        contactId: customer,
        moneyAccountId: b.id(C.CASH),
        allocations: [{ documentId: opening.id, amount: 40_000 }],
        total: 40_000,
      }),
      b.ctx,
    );
    // Collecting a pre-start receivable is not income: the cash journal credits opening balance equity.
    expect(balance(entries, b.id(C.SALES), CASH)).toBe(0);
    expect(balance(entries, b.id(C.OPENING_BALANCE), CASH)).toBe(-40_000);
    expect(balance(entries, b.id(C.RECEIVABLE), CASH)).toBe(0);
  });
});

describe('recogniseProRata', () => {
  it('balances every step for awkward line mixes', () => {
    const ar = 'ar';
    const lines = [
      { accountId: ar, debit: 1001, credit: 0, contactId: null, itemId: null },
      { accountId: 'sales', debit: 0, credit: 953, contactId: null, itemId: null },
      { accountId: 'tax', debit: 0, credit: 48, contactId: null, itemId: null },
      { accountId: 'cogs', debit: 601, credit: 0, contactId: null, itemId: null },
      { accountId: 'stock', debit: 0, credit: 601, contactId: null, itemId: null },
    ];
    let paid = 0;
    const totals = new Map<string, number>();
    for (const step of [1, 2, 3, 5, 7, 11, 13, 17, 19, 923]) {
      const out = recogniseProRata(lines, ar, 1001, paid, paid + step);
      const debit = out.reduce((s, l) => s + l.debit, 0);
      const credit = out.reduce((s, l) => s + l.credit, 0);
      expect(debit).toBe(credit);
      for (const l of out)
        totals.set(l.accountId, (totals.get(l.accountId) ?? 0) + l.debit - l.credit);
      paid += step;
    }
    expect(paid).toBe(1001);
    expect(totals.get(ar)).toBe(1001);
    expect(totals.get('sales')).toBe(-953);
    expect(totals.get('tax')).toBe(-48);
    expect(totals.get('cogs')).toBe(601);
    expect(totals.get('stock')).toBe(-601);
  });
});
