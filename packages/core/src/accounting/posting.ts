import type { Id } from '../ids/id.js';
import type { AccountType } from '../schema/account.js';
import type { Document, DocumentLine, DocumentStatus, DocumentType } from '../schema/document.js';
import type { ItemType } from '../schema/item.js';
import type { JournalBasis, JournalLine } from '../schema/journal.js';
import { mulDivFloor } from './arith.js';
import { SYSTEM_ACCOUNT_CODES, type SystemAccountCode } from './chart.js';

/**
 * Posting rules: how a document becomes journal entries and stock movements.
 *
 * This module is pure so the device can run it offline and show the same
 * balances the server will compute. The caller supplies the lookups it needs
 * (system account ids, account types, item types, the costed stock movements
 * and, for payments, the documents being settled) through a PostingContext.
 *
 * Two journals (scope doc, "Cash and accrual"):
 *  - every document posts to the accrual journal on its date
 *  - the cash journal is filled when money moves; a document paid on the spot
 *    posts once with basis `both`, a credit sale or unpaid bill posts with
 *    basis `accrual` and reaches the cash journal through payments, which post
 *    the document's accrual lines in proportion to the amount paid with basis
 *    `cash`
 *  - the mode switch only changes which basis the reports read
 */

export type SystemAccounts = Record<SystemAccountCode, Id>;

/** A document a payment settles: what it owes and the lines to recognise pro rata. */
export interface AllocationTarget {
  documentId: Id;
  type: DocumentType;
  /** Which side of the books it sits on: a sale is a receivable, a bill a payable. */
  kind: 'receivable' | 'payable';
  total: number;
  /** Settled by payments ordered before this one. */
  paidBefore: number;
  /** The target's lines with basis `accrual` (empty for a document paid on the spot). */
  accrualLines: JournalLine[];
}

export interface PostingContext {
  systemAccounts: SystemAccounts;
  accountType(accountId: Id): AccountType | undefined;
  itemType(itemId: Id): ItemType | undefined;
  /**
   * Positive cost of the stock leaving on a sale or negative adjustment line,
   * as valued by the costing engine. Undefined when the line moves no stock.
   */
  lineCost(lineId: Id): number | undefined;
  allocationTarget(documentId: Id): AllocationTarget | undefined;
}

export interface PostedEntry {
  basis: JournalBasis;
  date: string;
  lines: JournalLine[];
}

/** A stock movement before costing: outbound value is filled in by the costing engine. */
export interface StockMovementDraft {
  itemId: Id;
  lineId: Id;
  date: string;
  quantityMilli: number;
  /** Cost of an inbound movement in whole kyat; 0 for outbound until costed. */
  value: number;
}

export interface PostingWarning {
  code: 'negative_quantity_ignored' | 'fee_without_money_account';
  message: string;
  lineId?: Id;
}

export interface PostingResult {
  entries: PostedEntry[];
  movements: StockMovementDraft[];
  warnings: PostingWarning[];
}

export type PostingErrorCode =
  | 'contact_required'
  | 'money_account_required'
  | 'account_required'
  | 'unknown_account'
  | 'unknown_item'
  | 'wrong_account_type'
  | 'invalid_quantity'
  | 'invalid_line'
  | 'total_mismatch'
  | 'missing_cost'
  | 'unknown_allocation_target'
  | 'over_allocation'
  | 'wrong_allocation_kind'
  | 'same_account'
  | 'unbalanced';

export class PostingError extends Error {
  constructor(
    public readonly code: PostingErrorCode,
    message: string,
    public readonly lineId?: Id,
  ) {
    super(message);
    this.name = 'PostingError';
  }
}

const C = SYSTEM_ACCOUNT_CODES;

function line(
  accountId: Id,
  debit: number,
  credit: number,
  extra: { contactId?: Id | null; itemId?: Id | null } = {},
): JournalLine {
  return {
    accountId,
    debit,
    credit,
    contactId: extra.contactId ?? null,
    itemId: extra.itemId ?? null,
  };
}

const dr = (accountId: Id, amount: number, extra?: { contactId?: Id | null; itemId?: Id | null }) =>
  line(accountId, amount, 0, extra);
const cr = (accountId: Id, amount: number, extra?: { contactId?: Id | null; itemId?: Id | null }) =>
  line(accountId, 0, amount, extra);

/** True when the document is settled by payments rather than paid on the spot. */
export function isOnCredit(doc: Pick<Document, 'type' | 'moneyAccountId' | 'contactId'>): boolean {
  switch (doc.type) {
    case 'sale':
    case 'purchase':
    case 'expense':
      return doc.moneyAccountId === null;
    case 'opening_balance':
      return doc.contactId !== null;
    default:
      return false;
  }
}

/** Receivable (customers owe me) or payable (I owe suppliers) for a document on credit. */
export function allocationKind(
  doc: Pick<Document, 'type' | 'lines'>,
  accountCode: (accountId: Id) => string | undefined,
): 'receivable' | 'payable' | null {
  switch (doc.type) {
    case 'sale':
      return 'receivable';
    case 'purchase':
    case 'expense':
      return 'payable';
    case 'opening_balance': {
      const codes = new Set(
        doc.lines.map((l) => (l.accountId ? accountCode(l.accountId) : undefined)),
      );
      if (codes.has(C.RECEIVABLE)) return 'receivable';
      if (codes.has(C.PAYABLE)) return 'payable';
      return null;
    }
    default:
      return null;
  }
}

/** Status from what has been paid. Documents not settled by payments are simply paid. */
export function documentStatus(
  doc: Pick<Document, 'type' | 'moneyAccountId' | 'contactId' | 'status' | 'total'>,
  paidAmount: number,
): DocumentStatus {
  if (doc.status === 'void') return 'void';
  if (!isOnCredit(doc)) return 'paid';
  if (doc.total === 0 || paidAmount >= doc.total) return 'paid';
  if (paidAmount > 0) return 'partly_paid';
  return 'open';
}

/**
 * Stock movements a document causes, before costing. Only items of type
 * `stocked` move stock; `not_tracked` items are expensed on purchase and
 * `service` items never touch stock.
 */
export function deriveStockMovements(
  doc: Document,
  ctx: Pick<PostingContext, 'itemType'>,
): StockMovementDraft[] {
  if (doc.status === 'void' || doc.deletedAt) return [];
  const out: StockMovementDraft[] = [];
  for (const l of doc.lines) {
    if (!l.itemId) continue;
    const type = ctx.itemType(l.itemId);
    if (type === undefined)
      throw new PostingError('unknown_item', `Unknown item ${l.itemId}`, l.id);
    if (type !== 'stocked') continue;
    switch (doc.type) {
      case 'sale':
        requirePositiveQuantity(l);
        out.push({
          itemId: l.itemId,
          lineId: l.id,
          date: doc.date,
          quantityMilli: -l.quantityMilli,
          value: 0,
        });
        break;
      case 'purchase':
        requirePositiveQuantity(l);
        out.push({
          itemId: l.itemId,
          lineId: l.id,
          date: doc.date,
          quantityMilli: l.quantityMilli,
          value: l.amount + l.taxAmount,
        });
        break;
      case 'opening_balance':
        requirePositiveQuantity(l);
        out.push({
          itemId: l.itemId,
          lineId: l.id,
          date: doc.date,
          quantityMilli: l.quantityMilli,
          value: l.amount,
        });
        break;
      case 'stock_adjustment':
        if (l.quantityMilli === 0)
          throw new PostingError('invalid_quantity', 'Adjustment quantity must not be zero', l.id);
        out.push({
          itemId: l.itemId,
          lineId: l.id,
          date: doc.date,
          quantityMilli: l.quantityMilli,
          value: l.quantityMilli > 0 ? l.amount : 0,
        });
        break;
      default:
        break;
    }
  }
  return out;
}

function requirePositiveQuantity(l: DocumentLine): void {
  if (l.quantityMilli <= 0) {
    throw new PostingError('invalid_quantity', 'Quantity must be greater than zero', l.id);
  }
}

/** Journal entries and stock movements for one document. Throws PostingError on bad input. */
export function postDocument(doc: Document, ctx: PostingContext): PostingResult {
  const warnings: PostingWarning[] = [];
  if (doc.status === 'void' || doc.deletedAt) return { entries: [], movements: [], warnings };
  const movements = deriveStockMovements(doc, ctx);
  const entries = postEntries(doc, ctx, warnings);
  for (const e of entries) assertBalanced(e);
  return { entries, movements, warnings };
}

function postEntries(
  doc: Document,
  ctx: PostingContext,
  warnings: PostingWarning[],
): PostedEntry[] {
  switch (doc.type) {
    case 'sale':
      return postSale(doc, ctx);
    case 'purchase':
    case 'expense':
      return postBill(doc, ctx);
    case 'payment_in':
      return postPayment(doc, ctx, 'receivable');
    case 'payment_out':
      return postPayment(doc, ctx, 'payable');
    case 'owner_in':
      return [
        entry('both', doc.date, [
          dr(money(doc, ctx), doc.total),
          cr(sys(ctx, C.OWNER_CAPITAL), doc.total),
        ]),
      ];
    case 'owner_out':
      return [
        entry('both', doc.date, [
          dr(sys(ctx, C.OWNER_DRAWINGS), doc.total),
          cr(money(doc, ctx), doc.total),
        ]),
      ];
    case 'transfer':
      return postTransfer(doc, ctx);
    case 'stock_adjustment':
      return postStockAdjustment(doc, ctx, warnings);
    case 'opening_balance':
      return postOpeningBalance(doc, ctx);
  }
}

function sys(ctx: PostingContext, code: SystemAccountCode): Id {
  return ctx.systemAccounts[code];
}

function money(doc: Document, ctx: PostingContext): Id {
  if (!doc.moneyAccountId)
    throw new PostingError('money_account_required', 'A money account is required');
  const type = ctx.accountType(doc.moneyAccountId);
  if (type === undefined)
    throw new PostingError('unknown_account', `Unknown account ${doc.moneyAccountId}`);
  if (type !== 'asset')
    throw new PostingError('wrong_account_type', 'Money account must be an asset');
  return doc.moneyAccountId;
}

function contact(doc: Document): Id {
  if (!doc.contactId)
    throw new PostingError(
      'contact_required',
      'A customer or supplier is required for a document on credit',
    );
  return doc.contactId;
}

function entry(basis: JournalBasis, date: string, lines: JournalLine[]): PostedEntry {
  return { basis, date, lines: lines.filter((l) => l.debit !== 0 || l.credit !== 0) };
}

function assertBalanced(e: PostedEntry): void {
  const debit = e.lines.reduce((s, l) => s + l.debit, 0);
  const credit = e.lines.reduce((s, l) => s + l.credit, 0);
  if (debit !== credit)
    throw new PostingError('unbalanced', `Entry does not balance: ${debit} vs ${credit}`);
}

function lineTotal(doc: Document): number {
  return doc.lines.reduce((s, l) => s + l.amount + l.taxAmount, 0);
}

function requireTotal(doc: Document, expected: number): void {
  if (doc.total !== expected) {
    throw new PostingError(
      'total_mismatch',
      `Document total ${doc.total} does not match its lines ${expected}`,
    );
  }
}

function postSale(doc: Document, ctx: PostingContext): PostedEntry[] {
  const paid = doc.moneyAccountId !== null;
  const basis: JournalBasis = paid ? 'both' : 'accrual';
  requireTotal(doc, lineTotal(doc));
  const lines: JournalLine[] = [];
  let tax = 0;

  for (const l of doc.lines) {
    const incomeAccount = l.accountId ?? sys(ctx, C.SALES);
    const type = ctx.accountType(incomeAccount);
    if (type === undefined)
      throw new PostingError('unknown_account', `Unknown account ${incomeAccount}`, l.id);
    if (type !== 'income')
      throw new PostingError(
        'wrong_account_type',
        'Sale lines must post to an income account',
        l.id,
      );
    if (l.itemId && ctx.itemType(l.itemId) === undefined)
      throw new PostingError('unknown_item', `Unknown item ${l.itemId}`, l.id);
    lines.push(cr(incomeAccount, l.amount, { itemId: l.itemId, contactId: doc.contactId }));
    tax += l.taxAmount;
    if (l.itemId && ctx.itemType(l.itemId) === 'stocked') {
      const cost = ctx.lineCost(l.id);
      if (cost === undefined)
        throw new PostingError('missing_cost', 'Stock line has not been costed', l.id);
      lines.push(dr(sys(ctx, C.COST_OF_GOODS_SOLD), cost, { itemId: l.itemId }));
      lines.push(cr(sys(ctx, C.STOCK), cost, { itemId: l.itemId }));
    }
  }
  if (tax > 0) lines.push(cr(sys(ctx, C.TAX_COLLECTED), tax));

  if (paid) {
    const received = doc.total - doc.feeAmount;
    if (received < 0) throw new PostingError('total_mismatch', 'Fee exceeds the sale total');
    lines.unshift(dr(money(doc, ctx), received));
    if (doc.feeAmount > 0) lines.push(dr(sys(ctx, C.PAYMENT_FEES), doc.feeAmount));
  } else {
    if (doc.feeAmount > 0)
      throw new PostingError('invalid_line', 'A credit sale cannot carry a payment fee');
    lines.unshift(dr(sys(ctx, C.RECEIVABLE), doc.total, { contactId: contact(doc) }));
  }
  return [entry(basis, doc.date, lines)];
}

/** Purchases and expenses: paid now, or owed to the supplier. */
function postBill(doc: Document, ctx: PostingContext): PostedEntry[] {
  const paid = doc.moneyAccountId !== null;
  const basis: JournalBasis = paid ? 'both' : 'accrual';
  requireTotal(doc, lineTotal(doc));
  const lines: JournalLine[] = [];

  for (const l of doc.lines) {
    const amount = l.amount + l.taxAmount;
    if (l.itemId) {
      const itemType = ctx.itemType(l.itemId);
      if (itemType === undefined)
        throw new PostingError('unknown_item', `Unknown item ${l.itemId}`, l.id);
      if (itemType === 'stocked') {
        lines.push(dr(sys(ctx, C.STOCK), amount, { itemId: l.itemId }));
      } else {
        lines.push(
          dr(l.accountId ?? sys(ctx, C.PURCHASES), amount, {
            itemId: l.itemId,
            contactId: doc.contactId,
          }),
        );
      }
      continue;
    }
    const accountId =
      l.accountId ?? sys(ctx, doc.type === 'expense' ? C.OTHER_EXPENSE : C.PURCHASES);
    const type = ctx.accountType(accountId);
    if (type === undefined)
      throw new PostingError('unknown_account', `Unknown account ${accountId}`, l.id);
    if (type === 'income')
      throw new PostingError('wrong_account_type', 'A bill cannot post to an income account', l.id);
    if (accountId === doc.moneyAccountId)
      throw new PostingError(
        'same_account',
        'A bill cannot post to the money account it is paid from',
        l.id,
      );
    lines.push(dr(accountId, amount, { contactId: doc.contactId }));
  }

  if (paid) {
    lines.push(cr(money(doc, ctx), doc.total + doc.feeAmount));
    if (doc.feeAmount > 0) lines.push(dr(sys(ctx, C.PAYMENT_FEES), doc.feeAmount));
  } else {
    if (doc.feeAmount > 0)
      throw new PostingError('invalid_line', 'An unpaid bill cannot carry a payment fee');
    lines.push(cr(sys(ctx, C.PAYABLE), doc.total, { contactId: contact(doc) }));
  }
  return [entry(basis, doc.date, lines)];
}

/**
 * A payment settles open documents (basis both: money against the receivable
 * or payable) and recognises their accrual lines in the cash journal in
 * proportion to the amount paid. Anything beyond what is owed becomes an
 * advance, which the cash journal treats as income (or purchases) on receipt.
 */
function postPayment(
  doc: Document,
  ctx: PostingContext,
  kind: 'receivable' | 'payable',
): PostedEntry[] {
  const contactId = contact(doc);
  const moneyId = money(doc, ctx);
  const settled = doc.allocations.reduce((s, a) => s + a.amount, 0);
  if (settled > doc.total)
    throw new PostingError('over_allocation', 'Allocations exceed the payment amount');
  const remainder = doc.total - settled;

  const contactAccount = sys(ctx, kind === 'receivable' ? C.RECEIVABLE : C.PAYABLE);
  const advanceAccount = sys(ctx, kind === 'receivable' ? C.CUSTOMER_ADVANCE : C.SUPPLIER_ADVANCE);
  const recognitionAccount = sys(ctx, kind === 'receivable' ? C.SALES : C.PURCHASES);

  const both: JournalLine[] = [];
  if (kind === 'receivable') {
    both.push(dr(moneyId, doc.total - doc.feeAmount));
    if (doc.feeAmount > 0) both.push(dr(sys(ctx, C.PAYMENT_FEES), doc.feeAmount));
    both.push(cr(contactAccount, settled, { contactId }));
    both.push(cr(advanceAccount, remainder, { contactId }));
  } else {
    both.push(dr(contactAccount, settled, { contactId }));
    both.push(dr(advanceAccount, remainder, { contactId }));
    if (doc.feeAmount > 0) both.push(dr(sys(ctx, C.PAYMENT_FEES), doc.feeAmount));
    both.push(cr(moneyId, doc.total + doc.feeAmount));
  }
  const entries: PostedEntry[] = [entry('both', doc.date, both)];

  for (const a of doc.allocations) {
    if (a.amount === 0) continue;
    const target = ctx.allocationTarget(a.documentId);
    if (!target)
      throw new PostingError('unknown_allocation_target', `Unknown document ${a.documentId}`);
    if (target.kind !== kind)
      throw new PostingError('wrong_allocation_kind', `Document ${a.documentId} is not a ${kind}`);
    if (target.paidBefore + a.amount > target.total) {
      throw new PostingError(
        'over_allocation',
        `Payment of ${a.amount} exceeds what is owed on document ${a.documentId}`,
      );
    }
    const lines = recogniseProRata(
      target.accrualLines,
      contactAccount,
      target.total,
      target.paidBefore,
      target.paidBefore + a.amount,
    );
    if (lines.length > 0) entries.push(entry('cash', doc.date, lines));
  }

  if (remainder > 0) {
    const cash =
      kind === 'receivable'
        ? [
            dr(advanceAccount, remainder, { contactId }),
            cr(recognitionAccount, remainder, { contactId }),
          ]
        : [
            dr(recognitionAccount, remainder, { contactId }),
            cr(advanceAccount, remainder, { contactId }),
          ];
    entries.push(entry('cash', doc.date, cash));
  }
  return entries;
}

/**
 * The share of a document's accrual lines that a payment brings into the cash
 * journal. Each line's cumulative share is floor(amount x paid / total), so
 * the sum over all payments equals the line exactly once the document is fully
 * paid and never exceeds it before. The receivable (or payable) line tracks
 * the amount paid exactly, and the largest line on the other side absorbs the
 * rounding so every entry balances.
 */
export function recogniseProRata(
  accrualLines: readonly JournalLine[],
  contactAccount: Id,
  total: number,
  paidBefore: number,
  paidAfter: number,
): JournalLine[] {
  if (accrualLines.length === 0 || total <= 0) return [];
  if (paidAfter > total || paidBefore < 0 || paidAfter < paidBefore) {
    throw new PostingError('over_allocation', 'Paid amount is outside the document total');
  }
  const contactIdx = accrualLines.findIndex((l) => l.accountId === contactAccount);
  if (contactIdx < 0)
    throw new PostingError('invalid_line', 'Accrual lines carry no receivable or payable line');
  const contactIsDebit = (accrualLines[contactIdx]?.debit ?? 0) > 0;
  let adjustIdx = -1;
  let adjustAmount = -1;
  accrualLines.forEach((l, i) => {
    if (i === contactIdx) return;
    const amt = l.debit > 0 ? l.debit : l.credit;
    const isDebit = l.debit > 0;
    if (isDebit !== contactIsDebit && amt > adjustAmount) {
      adjustIdx = i;
      adjustAmount = amt;
    }
  });

  const cumulative = (paid: number): number[] => {
    const cum = accrualLines.map((l, i) => {
      if (i === contactIdx) return paid;
      if (i === adjustIdx) return 0;
      return mulDivFloor(l.debit > 0 ? l.debit : l.credit, paid, total);
    });
    if (adjustIdx >= 0) {
      let debits = 0;
      let credits = 0;
      accrualLines.forEach((l, i) => {
        if (i === adjustIdx) return;
        if (l.debit > 0) debits += cum[i] ?? 0;
        else credits += cum[i] ?? 0;
      });
      cum[adjustIdx] =
        (accrualLines[adjustIdx]?.debit ?? 0) > 0 ? credits - debits : debits - credits;
    }
    return cum;
  };

  const before = cumulative(paidBefore);
  const after = cumulative(paidAfter);
  const out: JournalLine[] = [];
  accrualLines.forEach((l, i) => {
    const delta = (after[i] ?? 0) - (before[i] ?? 0);
    if (delta === 0) return;
    const isDebit = l.debit > 0 ? delta > 0 : delta < 0;
    const amount = Math.abs(delta);
    out.push(
      line(l.accountId, isDebit ? amount : 0, isDebit ? 0 : amount, {
        contactId: l.contactId,
        itemId: l.itemId,
      }),
    );
  });
  return out;
}

function postTransfer(doc: Document, ctx: PostingContext): PostedEntry[] {
  const from = money(doc, ctx);
  if (!doc.toMoneyAccountId)
    throw new PostingError(
      'money_account_required',
      'A transfer needs a destination money account',
    );
  if (doc.toMoneyAccountId === from)
    throw new PostingError('same_account', 'A transfer needs two different money accounts');
  if (ctx.accountType(doc.toMoneyAccountId) !== 'asset')
    throw new PostingError('wrong_account_type', 'Destination must be a money account');
  if (doc.feeAmount > doc.total)
    throw new PostingError('total_mismatch', 'Fee exceeds the transfer amount');
  return [
    entry('both', doc.date, [
      dr(doc.toMoneyAccountId, doc.total - doc.feeAmount),
      dr(sys(ctx, C.PAYMENT_FEES), doc.feeAmount),
      cr(from, doc.total),
    ]),
  ];
}

function postStockAdjustment(
  doc: Document,
  ctx: PostingContext,
  warnings: PostingWarning[],
): PostedEntry[] {
  const lines: JournalLine[] = [];
  for (const l of doc.lines) {
    if (!l.itemId)
      throw new PostingError('invalid_line', 'A stock adjustment line needs an item', l.id);
    if (ctx.itemType(l.itemId) !== 'stocked')
      throw new PostingError('invalid_line', 'Only stocked items can be adjusted', l.id);
    const counter = l.accountId ?? sys(ctx, C.STOCK_ADJUSTMENT);
    const counterType = ctx.accountType(counter);
    if (counterType === undefined)
      throw new PostingError('unknown_account', `Unknown account ${counter}`, l.id);
    if (
      counterType !== 'cost_of_sales' &&
      counterType !== 'expense' &&
      counter !== sys(ctx, C.OPENING_BALANCE)
    ) {
      throw new PostingError(
        'wrong_account_type',
        'Adjustments post to a cost or expense account',
        l.id,
      );
    }
    if (l.quantityMilli > 0) {
      lines.push(dr(sys(ctx, C.STOCK), l.amount, { itemId: l.itemId }));
      lines.push(cr(counter, l.amount, { itemId: l.itemId }));
    } else {
      const cost = ctx.lineCost(l.id);
      if (cost === undefined)
        throw new PostingError('missing_cost', 'Stock line has not been costed', l.id);
      lines.push(dr(counter, cost, { itemId: l.itemId }));
      lines.push(cr(sys(ctx, C.STOCK), cost, { itemId: l.itemId }));
    }
  }
  if (doc.feeAmount > 0)
    warnings.push({
      code: 'fee_without_money_account',
      message: 'Fee ignored on a stock adjustment',
    });
  return [entry('both', doc.date, lines)];
}

/**
 * Opening balances post against Opening balance adjustment. Money, stock,
 * equipment and loans post with basis both. An opening receivable or payable
 * posts with basis accrual, so that cash-basis reports only see it when it is
 * collected or paid; such a document carries one contact and only receivable
 * (or only payable) lines, and payments allocate to it like a sale or bill.
 */
function postOpeningBalance(doc: Document, ctx: PostingContext): PostedEntry[] {
  const opening = sys(ctx, C.OPENING_BALANCE);
  const both: JournalLine[] = [];
  const accrual: JournalLine[] = [];
  let bothNet = 0;
  let accrualNet = 0;

  for (const l of doc.lines) {
    if (l.itemId) {
      if (ctx.itemType(l.itemId) !== 'stocked')
        throw new PostingError('invalid_line', 'Opening stock needs a stocked item', l.id);
      both.push(dr(sys(ctx, C.STOCK), l.amount, { itemId: l.itemId }));
      bothNet += l.amount;
      continue;
    }
    if (!l.accountId)
      throw new PostingError(
        'account_required',
        'An opening balance line needs an account or an item',
        l.id,
      );
    const type = ctx.accountType(l.accountId);
    if (type === undefined)
      throw new PostingError('unknown_account', `Unknown account ${l.accountId}`, l.id);
    if (l.accountId === opening)
      throw new PostingError('invalid_line', 'Opening balance adjustment cannot be a line', l.id);
    const isContactLine =
      l.accountId === sys(ctx, C.RECEIVABLE) || l.accountId === sys(ctx, C.PAYABLE);
    if (isContactLine) {
      const contactId = contact(doc);
      if (type === 'asset') {
        accrual.push(dr(l.accountId, l.amount, { contactId }));
        accrualNet += l.amount;
      } else {
        accrual.push(cr(l.accountId, l.amount, { contactId }));
        accrualNet -= l.amount;
      }
      continue;
    }
    if (doc.contactId)
      throw new PostingError(
        'invalid_line',
        'An opening balance for a contact carries only receivable or payable lines',
        l.id,
      );
    if (type === 'income' || type === 'expense' || type === 'cost_of_sales') {
      throw new PostingError(
        'wrong_account_type',
        'Opening balances are for money, stock, things owned, loans and owner accounts',
        l.id,
      );
    }
    if (type === 'asset') {
      both.push(dr(l.accountId, l.amount));
      bothNet += l.amount;
    } else {
      both.push(cr(l.accountId, l.amount));
      bothNet -= l.amount;
    }
  }
  if (doc.contactId && accrual.length === 0) {
    throw new PostingError(
      'invalid_line',
      'An opening balance for a contact needs a receivable or payable line',
    );
  }
  requireTotal(
    doc,
    doc.lines.reduce((s, l) => s + l.amount, 0),
  );

  const entries: PostedEntry[] = [];
  if (both.length > 0) {
    both.push(bothNet >= 0 ? cr(opening, bothNet) : dr(opening, -bothNet));
    entries.push(entry('both', doc.date, both));
  }
  if (accrual.length > 0) {
    accrual.push(accrualNet >= 0 ? cr(opening, accrualNet) : dr(opening, -accrualNet));
    entries.push(entry('accrual', doc.date, accrual));
  }
  return entries;
}
