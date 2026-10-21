import {
  type AccountBalance,
  type AccountingMode,
  allocationKind,
  type BalanceSheet,
  type Bilingual,
  balanceSheet,
  isOnCredit,
  type JournalBasis,
  type ProfitAndLoss,
  profitAndLoss,
} from '@cannopy/core';
import { and, asc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import {
  accounts,
  contacts,
  documents,
  items,
  journalEntries,
  journalLines,
  stockMovements,
} from '../db/schema/index.js';
import { basesFor, loadBooks } from './books.js';
import { rowToDocument } from './mappers.js';
import type { Tx } from './tx.js';

/**
 * Reports read one journal: the bases for the chosen mode (cash reads
 * `cash` + `both`, accrual reads `accrual` + `both`). Sums are done in SQL
 * over journal_lines; the shaping into owner groups is the core package's job
 * so the device can produce the same report from its local copy.
 */

export interface ReportPeriod {
  from?: string;
  to?: string;
}

export async function accountBalances(
  tx: Tx,
  businessId: string,
  mode: AccountingMode,
  period: ReportPeriod,
): Promise<AccountBalance[]> {
  const bases: JournalBasis[] = basesFor(mode);
  const conditions = [
    eq(journalLines.businessId, businessId),
    inArray(journalEntries.basis, bases),
    isNull(journalEntries.deletedAt),
  ];
  if (period.from) conditions.push(gte(journalEntries.date, period.from));
  if (period.to) conditions.push(lte(journalEntries.date, period.to));

  const sums = await tx
    .select({
      accountId: journalLines.accountId,
      debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)`,
      credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(and(...conditions))
    .groupBy(journalLines.accountId);

  const rows = await tx
    .select()
    .from(accounts)
    .where(eq(accounts.businessId, businessId))
    .orderBy(asc(accounts.code));
  const byId = new Map(sums.map((s) => [s.accountId, s]));
  return rows.map((a) => {
    const s = byId.get(a.id);
    return {
      accountId: a.id,
      code: a.code,
      type: a.type,
      ownerGroup: a.ownerGroup,
      name: { en: a.nameEn, my: a.nameMy },
      isHidden: a.isHidden,
      debit: Number(s?.debit ?? 0),
      credit: Number(s?.credit ?? 0),
    };
  });
}

export interface ProfitAndLossReport extends ProfitAndLoss {
  mode: AccountingMode;
  from: string;
  to: string;
}

export async function profitAndLossReport(
  tx: Tx,
  businessId: string,
  mode: AccountingMode,
  from: string,
  to: string,
): Promise<ProfitAndLossReport> {
  const balances = await accountBalances(tx, businessId, mode, { from, to });
  return { mode, from, to, ...profitAndLoss(balances) };
}

export interface BalanceSheetReport extends BalanceSheet {
  mode: AccountingMode;
  asOf: string;
}

export async function balanceSheetReport(
  tx: Tx,
  businessId: string,
  mode: AccountingMode,
  asOf: string,
): Promise<BalanceSheetReport> {
  const balances = await accountBalances(tx, businessId, mode, { to: asOf });
  return { mode, asOf, ...balanceSheet(balances) };
}

export interface MoneyAccountBalance {
  accountId: string;
  code: string;
  name: Bilingual;
  moneyKind: 'cash' | 'bank' | 'wallet';
  provider: string | null;
  balance: number;
  inToday: number;
  outToday: number;
}

export interface MoneyReport {
  date: string;
  total: number;
  inToday: number;
  outToday: number;
  accounts: MoneyAccountBalance[];
}

/** "Money today": the same in both modes, because money accounts only ever post with basis both. */
export async function moneyReport(tx: Tx, businessId: string, date: string): Promise<MoneyReport> {
  const upTo = await accountBalances(tx, businessId, 'cash', { to: date });
  const onDay = await accountBalances(tx, businessId, 'cash', { from: date, to: date });
  const moneyRows = await tx
    .select()
    .from(accounts)
    .where(and(eq(accounts.businessId, businessId), isNull(accounts.deletedAt)))
    .orderBy(asc(accounts.code));
  const out: MoneyAccountBalance[] = [];
  for (const a of moneyRows) {
    if (!a.moneyKind) continue;
    const total = upTo.find((b) => b.accountId === a.id);
    const today = onDay.find((b) => b.accountId === a.id);
    out.push({
      accountId: a.id,
      code: a.code,
      name: { en: a.nameEn, my: a.nameMy },
      moneyKind: a.moneyKind,
      provider: a.provider,
      balance: (total?.debit ?? 0) - (total?.credit ?? 0),
      inToday: today?.debit ?? 0,
      outToday: today?.credit ?? 0,
    });
  }
  return {
    date,
    total: out.reduce((s, a) => s + a.balance, 0),
    inToday: out.reduce((s, a) => s + a.inToday, 0),
    outToday: out.reduce((s, a) => s + a.outToday, 0),
    accounts: out,
  };
}

export interface ContactBalance {
  contactId: string;
  name: Bilingual;
  phone: string | null;
  balance: number;
  oldestOpenDate: string | null;
  openDocuments: number;
}

export interface ContactBalancesReport {
  kind: 'receivable' | 'payable';
  total: number;
  contacts: ContactBalance[];
}

/**
 * "Who owes me" and "Who I owe": the sum of open document balances per
 * contact. Operational information shown in both modes. Open documents are
 * few, so they are grouped here rather than in SQL, which also lets an opening
 * balance count on the side its lines say.
 */
export async function contactBalances(
  tx: Tx,
  businessId: string,
  kind: 'receivable' | 'payable',
): Promise<ContactBalancesReport> {
  const books = await loadBooks(tx, businessId);
  const rows = await tx
    .select({
      document: documents,
      nameEn: contacts.nameEn,
      nameMy: contacts.nameMy,
      phone: contacts.phone,
    })
    .from(documents)
    .innerJoin(contacts, eq(contacts.id, documents.contactId))
    .where(
      and(
        eq(documents.businessId, businessId),
        isNull(documents.deletedAt),
        inArray(documents.status, ['open', 'partly_paid']),
        isNull(documents.moneyAccountId),
      ),
    )
    .orderBy(asc(documents.date), asc(documents.id));
  const byContact = new Map<string, ContactBalance>();
  for (const r of rows) {
    const d = rowToDocument(r.document);
    if (!d.contactId || !isOnCredit(d)) continue;
    if (allocationKind(d, (id) => books.accountsById.get(id)?.code) !== kind) continue;
    const balance = d.total - d.paidAmount;
    if (balance === 0) continue;
    const current = byContact.get(d.contactId) ?? {
      contactId: d.contactId,
      name: { en: r.nameEn, my: r.nameMy },
      phone: r.phone,
      balance: 0,
      oldestOpenDate: null,
      openDocuments: 0,
    };
    current.balance += balance;
    current.openDocuments += 1;
    if (current.oldestOpenDate === null || d.date < current.oldestOpenDate)
      current.oldestOpenDate = d.date;
    byContact.set(d.contactId, current);
  }
  const out = [...byContact.values()].sort(
    (x, y) =>
      (x.oldestOpenDate ?? '').localeCompare(y.oldestOpenDate ?? '') ||
      x.contactId.localeCompare(y.contactId),
  );
  return { kind, total: out.reduce((s, c) => s + c.balance, 0), contacts: out };
}

/** Open documents of one contact, oldest first: what the Get paid and Pay supplier screens list. */
export async function openDocuments(tx: Tx, businessId: string, contactId: string) {
  const rows = await tx
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.businessId, businessId),
        eq(documents.contactId, contactId),
        isNull(documents.deletedAt),
        inArray(documents.status, ['open', 'partly_paid']),
      ),
    )
    .orderBy(asc(documents.date), asc(documents.id));
  return rows
    .map(rowToDocument)
    .filter((d) => isOnCredit(d))
    .map((d) => ({
      documentId: d.id,
      type: d.type,
      number: d.number ?? null,
      date: d.date,
      total: d.total,
      paidAmount: d.paidAmount,
      balance: d.total - d.paidAmount,
    }));
}

export interface StockReportLine {
  itemId: string;
  name: Bilingual;
  unit: Bilingual;
  quantityOnHandMilli: number;
  averageCost: number;
  lastCost: number | null;
  stockValue: number;
  lowStock: boolean;
  negative: boolean;
  lastSoldDate: string | null;
}

export interface StockReport {
  asOf: string;
  totalValue: number;
  items: StockReportLine[];
}

/** "My stock": quantity, average cost and value per item; the same in both modes. */
export async function stockReport(tx: Tx, businessId: string, asOf: string): Promise<StockReport> {
  const rows = await tx
    .select()
    .from(items)
    .where(
      and(eq(items.businessId, businessId), eq(items.type, 'stocked'), isNull(items.deletedAt)),
    )
    .orderBy(asc(items.nameEn), asc(items.nameMy));
  const lastSold = await tx
    .select({ itemId: stockMovements.itemId, last: sql<string>`max(${stockMovements.date})` })
    .from(stockMovements)
    .innerJoin(documents, eq(documents.id, stockMovements.documentId))
    .where(
      and(
        eq(stockMovements.businessId, businessId),
        eq(documents.type, 'sale'),
        isNull(stockMovements.deletedAt),
      ),
    )
    .groupBy(stockMovements.itemId);
  const lastById = new Map(lastSold.map((r) => [r.itemId, r.last]));
  const lines: StockReportLine[] = rows.map((r) => ({
    itemId: r.id,
    name: { en: r.nameEn, my: r.nameMy },
    unit: { en: r.unitEn, my: r.unitMy },
    quantityOnHandMilli: r.quantityOnHandMilli,
    averageCost: r.averageCost,
    lastCost: r.lastCost,
    stockValue: r.stockValue,
    lowStock: r.lowStockLevelMilli !== null && r.quantityOnHandMilli <= r.lowStockLevelMilli,
    negative: r.quantityOnHandMilli < 0,
    lastSoldDate: lastById.get(r.id) ?? null,
  }));
  return { asOf, totalValue: lines.reduce((s, l) => s + l.stockValue, 0), items: lines };
}
