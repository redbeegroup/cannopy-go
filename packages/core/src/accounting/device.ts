import type { Id } from '../ids/id.js';
import type { Account } from '../schema/account.js';
import type { AccountingMode } from '../schema/business.js';
import type { Document } from '../schema/document.js';
import type { JournalBasis, JournalEntry } from '../schema/journal.js';
import { allocationKind, isOnCredit } from './posting.js';
import type { AccountBalance } from './reports.js';

/**
 * What the device computes from its working copy, without the server.
 *
 * The phone must answer "how much money do I have" and "who owes me" with no
 * signal and with sales it has not pushed yet. Both follow from the documents
 * alone: a money account moves by a document's total (less or plus its fee)
 * and a credit document is settled by the allocations of later payments. The
 * functions here derive exactly that, and `moneyEffects` is tested against the
 * posting rules so the home screen never disagrees with the ledger.
 *
 * Profit and the balance sheet need costing, so for those the device sums the
 * journal entries it pulled from the server (`balancesFromJournal`) and shapes
 * them with the same report functions the API uses.
 */

export interface MoneyEffect {
  accountId: Id;
  /** Signed whole kyat: positive when money comes in. */
  delta: number;
}

/**
 * How a document moves each money account. Void and deleted documents move
 * nothing. An opening balance lists every account line it carries (money,
 * equipment, loans); `moneyBalances` keeps only the money accounts.
 */
export function moneyEffects(doc: Document): MoneyEffect[] {
  if (doc.status === 'void' || doc.deletedAt) return [];
  const m = doc.moneyAccountId;
  switch (doc.type) {
    case 'sale':
    case 'payment_in':
      return m ? [{ accountId: m, delta: doc.total - doc.feeAmount }] : [];
    case 'purchase':
    case 'expense':
    case 'payment_out':
      return m ? [{ accountId: m, delta: -(doc.total + doc.feeAmount) }] : [];
    case 'owner_in':
      return m ? [{ accountId: m, delta: doc.total }] : [];
    case 'owner_out':
      return m ? [{ accountId: m, delta: -doc.total }] : [];
    case 'transfer':
      return m && doc.toMoneyAccountId
        ? [
            { accountId: m, delta: -doc.total },
            { accountId: doc.toMoneyAccountId, delta: doc.total - doc.feeAmount },
          ]
        : [];
    case 'opening_balance': {
      if (doc.contactId) return [];
      return doc.lines
        .filter((l) => l.accountId !== null && l.itemId === null)
        .map((l) => ({ accountId: l.accountId as Id, delta: l.amount }));
    }
    case 'stock_adjustment':
      return [];
  }
}

/**
 * Balance of every money account from the documents on the device. Only
 * accounts with `moneyKind` set count, so an opening balance for a loan or
 * equipment does not show up as money.
 */
export function moneyBalances(
  documents: readonly Document[],
  accounts: readonly Account[],
  upTo?: string,
): Map<Id, number> {
  const balances = new Map<Id, number>();
  for (const a of accounts) if (a.moneyKind && !a.deletedAt) balances.set(a.id, 0);
  for (const doc of documents) {
    if (upTo && doc.date > upTo) continue;
    for (const e of moneyEffects(doc)) {
      if (!balances.has(e.accountId)) continue;
      balances.set(e.accountId, (balances.get(e.accountId) ?? 0) + e.delta);
    }
  }
  return balances;
}

export interface OpenBalance {
  documentId: Id;
  type: Document['type'];
  number: number | null;
  date: string;
  contactId: Id;
  kind: 'receivable' | 'payable';
  total: number;
  paid: number;
  balance: number;
}

/**
 * Every document on credit with what is still owed on it, oldest first. Paid
 * amounts come from the allocations of the payment documents on the device,
 * so a payment recorded offline a minute ago already reduces the balance and
 * the same payment pulled back from the server does not count twice.
 */
export function openBalances(
  documents: readonly Document[],
  accountCode: (accountId: Id) => string | undefined,
): OpenBalance[] {
  const paid = new Map<Id, number>();
  for (const doc of documents) {
    if (doc.status === 'void' || doc.deletedAt) continue;
    if (doc.type !== 'payment_in' && doc.type !== 'payment_out') continue;
    for (const a of doc.allocations)
      paid.set(a.documentId, (paid.get(a.documentId) ?? 0) + a.amount);
  }
  const out: OpenBalance[] = [];
  for (const doc of documents) {
    if (doc.status === 'void' || doc.deletedAt || !doc.contactId) continue;
    if (!isOnCredit(doc)) continue;
    const kind = allocationKind(doc, accountCode);
    if (!kind) continue;
    const settled = Math.min(doc.total, paid.get(doc.id) ?? 0);
    out.push({
      documentId: doc.id,
      type: doc.type,
      number: doc.number ?? null,
      date: doc.date,
      contactId: doc.contactId,
      kind,
      total: doc.total,
      paid: settled,
      balance: doc.total - settled,
    });
  }
  return out.sort(
    (x, y) => x.date.localeCompare(y.date) || x.documentId.localeCompare(y.documentId),
  );
}

export interface ContactOpenBalance {
  contactId: Id;
  balance: number;
  oldestOpenDate: string | null;
  openDocuments: number;
}

/** Who owes me (receivable) or who I owe (payable), per contact, from open balances. */
export function contactOpenBalances(
  open: readonly OpenBalance[],
  kind: 'receivable' | 'payable',
): ContactOpenBalance[] {
  const byContact = new Map<Id, ContactOpenBalance>();
  for (const o of open) {
    if (o.kind !== kind || o.balance <= 0) continue;
    const row = byContact.get(o.contactId) ?? {
      contactId: o.contactId,
      balance: 0,
      oldestOpenDate: null,
      openDocuments: 0,
    };
    row.balance += o.balance;
    row.openDocuments += 1;
    if (!row.oldestOpenDate || o.date < row.oldestOpenDate) row.oldestOpenDate = o.date;
    byContact.set(o.contactId, row);
  }
  return [...byContact.values()].sort(
    (x, y) =>
      y.balance - x.balance || (x.oldestOpenDate ?? '').localeCompare(y.oldestOpenDate ?? ''),
  );
}

/** Basis values a report reads for the given accounting mode. */
export function basesFor(mode: AccountingMode): JournalBasis[] {
  return mode === 'cash' ? ['cash', 'both'] : ['accrual', 'both'];
}

/**
 * Sums journal lines by account for one mode and date range, the device-side
 * twin of the API's `accountBalances`. Feed the result to `profitAndLoss` or
 * `balanceSheet`.
 */
export function balancesFromJournal(
  entries: readonly JournalEntry[],
  accounts: readonly Account[],
  mode: AccountingMode,
  period: { from?: string; to?: string } = {},
): AccountBalance[] {
  const bases = new Set<JournalBasis>(basesFor(mode));
  const sums = new Map<Id, { debit: number; credit: number }>();
  for (const e of entries) {
    if (e.deletedAt || !bases.has(e.basis)) continue;
    if (period.from && e.date < period.from) continue;
    if (period.to && e.date > period.to) continue;
    for (const l of e.lines) {
      const s = sums.get(l.accountId) ?? { debit: 0, credit: 0 };
      s.debit += l.debit;
      s.credit += l.credit;
      sums.set(l.accountId, s);
    }
  }
  return accounts
    .filter((a) => !a.deletedAt)
    .map((a) => ({
      accountId: a.id,
      code: a.code,
      type: a.type,
      ownerGroup: a.ownerGroup,
      name: a.name,
      isHidden: a.isHidden,
      debit: sums.get(a.id)?.debit ?? 0,
      credit: sums.get(a.id)?.credit ?? 0,
    }));
}
