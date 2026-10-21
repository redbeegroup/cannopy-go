import type {
  Account,
  Contact,
  Document,
  DocumentLine,
  Item,
  JournalEntry,
  JournalLine,
  StockMovement,
} from '@cannopy/core';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import type {
  accounts,
  contacts,
  documents,
  items,
  journalEntries,
  journalLines,
  stockMovements,
} from '../db/schema/index.js';

/**
 * Rows use name_en / name_my columns and Date timestamps; the shared core
 * types use { en, my } labels and ISO strings. These mappers are the only
 * place the two shapes meet.
 */

type AccountRow = InferSelectModel<typeof accounts>;
type ContactRow = InferSelectModel<typeof contacts>;
type ItemRow = InferSelectModel<typeof items>;
type DocumentRow = InferSelectModel<typeof documents>;
type EntryRow = InferSelectModel<typeof journalEntries>;
type LineRow = InferSelectModel<typeof journalLines>;
type MovementRow = InferSelectModel<typeof stockMovements>;

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);
const isoRequired = (d: Date): string => d.toISOString();
const at = (s: string): Date => new Date(s);

function synced(row: {
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  serverSeq: number | null;
}) {
  return {
    createdAt: isoRequired(row.createdAt),
    updatedAt: isoRequired(row.updatedAt),
    deletedAt: iso(row.deletedAt),
    ...(row.serverSeq === null ? {} : { serverSeq: row.serverSeq }),
  };
}

export function rowToAccount(r: AccountRow): Account {
  return {
    id: r.id,
    businessId: r.businessId,
    ...synced(r),
    code: r.code,
    type: r.type,
    ownerGroup: r.ownerGroup,
    name: { en: r.nameEn, my: r.nameMy },
    isSystem: r.isSystem,
    isHidden: r.isHidden,
    moneyKind: r.moneyKind,
    provider: r.provider,
    defaultFee: r.defaultFee,
  };
}

export function accountToRow(a: Account): InferInsertModel<typeof accounts> {
  return {
    id: a.id,
    businessId: a.businessId,
    code: a.code,
    type: a.type,
    ownerGroup: a.ownerGroup,
    nameEn: a.name.en,
    nameMy: a.name.my,
    isSystem: a.isSystem,
    isHidden: a.isHidden,
    moneyKind: a.moneyKind,
    provider: a.provider,
    defaultFee: a.defaultFee,
    createdAt: at(a.createdAt),
    updatedAt: at(a.updatedAt),
    deletedAt: a.deletedAt ? at(a.deletedAt) : null,
  };
}

export function rowToContact(r: ContactRow): Contact {
  return {
    id: r.id,
    businessId: r.businessId,
    ...synced(r),
    name: { en: r.nameEn, my: r.nameMy },
    phone: r.phone,
    isCustomer: r.isCustomer,
    isSupplier: r.isSupplier,
    creditLimit: r.creditLimit,
    note: r.note,
  };
}

export function contactToRow(c: Contact): InferInsertModel<typeof contacts> {
  return {
    id: c.id,
    businessId: c.businessId,
    nameEn: c.name.en,
    nameMy: c.name.my,
    phone: c.phone,
    isCustomer: c.isCustomer,
    isSupplier: c.isSupplier,
    creditLimit: c.creditLimit,
    note: c.note,
    createdAt: at(c.createdAt),
    updatedAt: at(c.updatedAt),
    deletedAt: c.deletedAt ? at(c.deletedAt) : null,
  };
}

export function rowToItem(r: ItemRow): Item {
  return {
    id: r.id,
    businessId: r.businessId,
    ...synced(r),
    name: { en: r.nameEn, my: r.nameMy },
    type: r.type,
    unit: { en: r.unitEn, my: r.unitMy },
    sellingPrice: r.sellingPrice,
    averageCost: r.averageCost,
    lastCost: r.lastCost,
    quantityOnHandMilli: r.quantityOnHandMilli,
    stockValue: r.stockValue,
    lowStockLevelMilli: r.lowStockLevelMilli,
    barcode: r.barcode,
    photoUrl: r.photoUrl,
    locationId: r.locationId,
    lotRef: r.lotRef,
  };
}

/** The owner-editable part of an item. Costing caches are never taken from the client. */
export function itemToRow(
  i: Item,
): Omit<
  InferInsertModel<typeof items>,
  'averageCost' | 'lastCost' | 'quantityOnHandMilli' | 'stockValue'
> {
  return {
    id: i.id,
    businessId: i.businessId,
    nameEn: i.name.en,
    nameMy: i.name.my,
    type: i.type,
    unitEn: i.unit.en,
    unitMy: i.unit.my,
    sellingPrice: i.sellingPrice,
    lowStockLevelMilli: i.lowStockLevelMilli,
    barcode: i.barcode,
    photoUrl: i.photoUrl,
    locationId: i.locationId,
    lotRef: i.lotRef,
    createdAt: at(i.createdAt),
    updatedAt: at(i.updatedAt),
    deletedAt: i.deletedAt ? at(i.deletedAt) : null,
  };
}

export function rowToDocument(r: DocumentRow): Document {
  return {
    id: r.id,
    businessId: r.businessId,
    ...synced(r),
    type: r.type,
    date: r.date,
    ...(r.number === null ? {} : { number: r.number }),
    contactId: r.contactId,
    moneyAccountId: r.moneyAccountId,
    toMoneyAccountId: r.toMoneyAccountId,
    lines: r.lines as DocumentLine[],
    allocations: r.allocations as Document['allocations'],
    total: r.total,
    feeAmount: r.feeAmount,
    paidAmount: r.paidAmount,
    status: r.status,
    note: r.note,
    attachmentUrl: r.attachmentUrl,
    createdByUserId: r.createdByUserId,
    deviceId: r.deviceId,
  };
}

/** Server-owned fields (number, paidAmount, status) are set by the ledger service, not copied. */
export function documentToRow(
  d: Document,
): Omit<InferInsertModel<typeof documents>, 'number' | 'paidAmount' | 'status'> {
  return {
    id: d.id,
    businessId: d.businessId,
    type: d.type,
    date: d.date,
    contactId: d.contactId,
    moneyAccountId: d.moneyAccountId,
    toMoneyAccountId: d.toMoneyAccountId,
    lines: d.lines,
    allocations: d.allocations,
    total: d.total,
    feeAmount: d.feeAmount,
    note: d.note,
    attachmentUrl: d.attachmentUrl,
    createdByUserId: d.createdByUserId,
    deviceId: d.deviceId,
    createdAt: at(d.createdAt),
    updatedAt: at(d.updatedAt),
    deletedAt: d.deletedAt ? at(d.deletedAt) : null,
  };
}

export function rowToJournalEntry(e: EntryRow, lines: LineRow[]): JournalEntry {
  return {
    id: e.id,
    businessId: e.businessId,
    ...synced(e),
    documentId: e.documentId,
    date: e.date,
    basis: e.basis,
    lines: lines
      .sort((x, y) => x.lineNo - y.lineNo)
      .map<JournalLine>((l) => ({
        accountId: l.accountId,
        debit: l.debit,
        credit: l.credit,
        contactId: l.contactId,
        itemId: l.itemId,
      })),
  };
}

export function rowToStockMovement(m: MovementRow): StockMovement {
  return {
    id: m.id,
    businessId: m.businessId,
    ...synced(m),
    itemId: m.itemId,
    documentId: m.documentId,
    lineId: m.lineId,
    date: m.date,
    quantityMilli: m.quantityMilli,
    unitCost: m.unitCost,
    value: m.value,
  };
}
