import {
  type AllocationTarget,
  allocationKind,
  type Document,
  deriveStockMovements,
  documentStatus,
  type ItemType,
  isOnCredit,
  type JournalLine,
  newId,
  type PostingContext,
  PostingError,
  postDocument,
} from '@cannopy/core';
import { and, eq, inArray, isNull, lt, max, ne, or, sql } from 'drizzle-orm';
import {
  auditLog,
  contacts,
  documentAllocations,
  documents,
  items,
  journalEntries,
  journalLines,
  stockMovements,
} from '../db/schema/index.js';
import { type Books, loadBooks, loadBusiness } from './books.js';
import { recordChange } from './changes.js';
import { recostItems } from './costing.js';
import { ApiError, notFound } from './errors.js';
import { documentToRow, rowToDocument, rowToJournalEntry, rowToStockMovement } from './mappers.js';
import type { Tx } from './tx.js';

/**
 * The ledger service: turns documents into journal entries, stock movements
 * and settled balances, and keeps them right when documents change.
 *
 * Writing a document always goes through `upsertDocument`, whether it comes
 * from the REST routes or from a sync mutation. Editing reverses and reposts:
 * the derived rows of the document are deleted and rebuilt, affected items are
 * recosted, and every document whose cost of goods sold or settled amount
 * changed is reposted too (sales after a late purchase, payments on an edited
 * sale). Devices learn about all of it through the change log.
 */

export interface LedgerWarning {
  code: 'negative_stock';
  itemId: string;
  documentId: string;
  date: string;
  quantityMilli: number;
}

export interface UpsertDocumentInput {
  businessId: string;
  userId: string;
  document: Document;
  mutationId?: string | null;
}

export interface DocumentResult {
  document: Document;
  warnings: LedgerWarning[];
}

const PAYMENT_TYPES = new Set<Document['type']>(['payment_in', 'payment_out']);

export async function upsertDocument(tx: Tx, input: UpsertDocumentInput): Promise<DocumentResult> {
  const { businessId, userId, document: doc } = input;
  const mutationId = input.mutationId ?? null;
  if (doc.businessId !== businessId) {
    throw new ApiError(400, 'wrong_business', 'Document belongs to another business');
  }
  await loadBusiness(tx, businessId);
  const books = await loadBooks(tx, businessId);
  const itemTypes = await validateReferences(tx, books, doc);

  const [existing] = await tx.select().from(documents).where(eq(documents.id, doc.id)).limit(1);
  if (existing && existing.businessId !== businessId) throw notFound('Document', doc.id);
  if (existing && existing.type !== doc.type) {
    throw new ApiError(
      409,
      'type_changed',
      'A document cannot change its type; delete and recreate it',
    );
  }
  if (existing && existing.deletedAt && !doc.deletedAt) {
    throw new ApiError(409, 'deleted', 'A deleted document cannot be edited');
  }
  const previousTargets = existing ? allocationIds(rowToDocument(existing)) : [];
  const previousItems = existing ? itemIds(rowToDocument(existing)) : [];

  const number = existing?.number ?? (await nextNumber(tx, businessId, doc.type));
  const row = {
    ...documentToRow(doc),
    number,
    paidAmount: existing?.paidAmount ?? 0,
    status: doc.status,
  };
  await tx.insert(documents).values(row).onConflictDoUpdate({ target: documents.id, set: row });

  await clearDerived(tx, businessId, doc.id);

  const active = !doc.deletedAt && doc.status !== 'void';
  const newTargets = active ? allocationIds(doc) : [];
  if (active && PAYMENT_TYPES.has(doc.type)) {
    await insertAllocations(tx, books, doc);
  }

  const warnings: LedgerWarning[] = [];
  const drafts = active ? deriveStockMovementsOrThrow(doc, itemTypes) : [];
  if (drafts.length > 0) {
    await tx.insert(stockMovements).values(
      drafts.map((m) => ({
        id: newId(),
        businessId,
        itemId: m.itemId,
        documentId: doc.id,
        lineId: m.lineId,
        date: m.date,
        quantityMilli: m.quantityMilli,
        unitCost: 0,
        value: m.value,
        createdAt: new Date(doc.updatedAt),
        updatedAt: new Date(doc.updatedAt),
      })),
    );
  }
  const recost = await recostItems(tx, businessId, [...previousItems, ...itemIds(doc)]);
  for (const w of recost.warnings) warnings.push({ code: 'negative_stock', ...w });

  // Settled amounts first, because payment postings read paidBefore from the allocation rows.
  const targets = [...new Set([...previousTargets, ...newTargets])];
  await refreshSettled(tx, books, targets, mutationId);

  const toRepost = new Set<string>([doc.id, ...recost.changedDocumentIds]);
  const dependentPayments = await paymentsAllocatingTo(tx, businessId, [...toRepost, ...targets]);
  const docsFirst = [...toRepost].filter((id) => id !== doc.id || !PAYMENT_TYPES.has(doc.type));
  for (const id of docsFirst) await postOne(tx, books, id, id === doc.id ? mutationId : null);
  const payments = new Set<string>(dependentPayments);
  if (PAYMENT_TYPES.has(doc.type)) payments.add(doc.id);
  for (const id of payments) await postOne(tx, books, id, id === doc.id ? mutationId : null);

  const [final] = await refreshSettled(tx, books, [doc.id], mutationId);
  if (!final) throw notFound('Document', doc.id);

  await tx.insert(auditLog).values({
    id: newId(),
    businessId,
    userId,
    entity: 'document',
    entityId: doc.id,
    action: existing ? 'update' : 'create',
    before: existing ? rowToDocument(existing) : null,
    after: final,
  });
  return { document: final, warnings };
}

export interface DeleteDocumentInput {
  businessId: string;
  userId: string;
  documentId: string;
  deletedAt: string;
  mutationId?: string | null;
}

/** Soft delete: the document stays for sync and audit, its postings are reversed. */
export async function deleteDocument(tx: Tx, input: DeleteDocumentInput): Promise<DocumentResult> {
  const { businessId, documentId } = input;
  const [existing] = await tx.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!existing || existing.businessId !== businessId) throw notFound('Document', documentId);
  const current = rowToDocument(existing);
  if (current.deletedAt) return { document: current, warnings: [] };

  const settledBy = await tx
    .select({ paymentId: documentAllocations.paymentId })
    .from(documentAllocations)
    .where(eq(documentAllocations.documentId, documentId));
  if (settledBy.length > 0) {
    throw new ApiError(
      409,
      'has_payments',
      'Delete or edit the payments against this document first',
      { paymentIds: settledBy.map((s) => s.paymentId) },
    );
  }
  return upsertDocument(tx, {
    businessId,
    userId: input.userId,
    document: {
      ...current,
      deletedAt: input.deletedAt,
      updatedAt: input.deletedAt,
      status: 'void',
    },
    mutationId: input.mutationId ?? null,
  });
}

/** A document with the journal entries and stock movements it produced. */
export async function loadDocumentWithPostings(tx: Tx, businessId: string, documentId: string) {
  const [row] = await tx.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!row || row.businessId !== businessId) throw notFound('Document', documentId);
  const entries = await loadEntries(tx, documentId);
  const movements = await tx
    .select()
    .from(stockMovements)
    .where(and(eq(stockMovements.documentId, documentId), isNull(stockMovements.deletedAt)));
  return {
    document: rowToDocument(row),
    journalEntries: entries,
    stockMovements: movements.map(rowToStockMovement),
  };
}

/* ----------------------------------------------------------------------- */

function allocationIds(doc: Document): string[] {
  return doc.allocations.map((a) => a.documentId);
}

function itemIds(doc: Document): string[] {
  return doc.lines.flatMap((l) => (l.itemId ? [l.itemId] : []));
}

function deriveStockMovementsOrThrow(doc: Document, itemTypes: Map<string, ItemType>) {
  try {
    return deriveStockMovements(doc, { itemType: (id) => itemTypes.get(id) });
  } catch (err) {
    throw toApiError(err);
  }
}

function toApiError(err: unknown): unknown {
  if (err instanceof PostingError) {
    return new ApiError(
      422,
      err.code,
      err.message,
      err.lineId ? { lineId: err.lineId } : undefined,
    );
  }
  return err;
}

async function nextNumber(tx: Tx, businessId: string, type: Document['type']): Promise<number> {
  const [row] = await tx
    .select({ last: max(documents.number) })
    .from(documents)
    .where(and(eq(documents.businessId, businessId), eq(documents.type, type)));
  return (row?.last ?? 0) + 1;
}

/** Checks every id the document points at exists in this business; returns the item types it needs. */
async function validateReferences(
  tx: Tx,
  books: Books,
  doc: Document,
): Promise<Map<string, ItemType>> {
  const bad = (code: string, message: string) => new ApiError(422, code, message);

  for (const id of [doc.moneyAccountId, doc.toMoneyAccountId]) {
    if (!id) continue;
    const a = books.accountsById.get(id);
    if (!a) throw bad('unknown_account', `Unknown money account ${id}`);
    if (!a.moneyKind) throw bad('not_money_account', `Account ${a.code} is not a money account`);
  }
  for (const l of doc.lines) {
    if (l.accountId && !books.accountsById.has(l.accountId)) {
      throw bad('unknown_account', `Unknown account ${l.accountId} on line ${l.id}`);
    }
  }
  if (doc.contactId) {
    const [c] = await tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(
          eq(contacts.id, doc.contactId),
          eq(contacts.businessId, books.businessId),
          isNull(contacts.deletedAt),
        ),
      )
      .limit(1);
    if (!c) throw bad('unknown_contact', `Unknown contact ${doc.contactId}`);
  }
  const ids = [...new Set(itemIds(doc))];
  const itemTypes = new Map<string, ItemType>();
  if (ids.length > 0) {
    const rows = await tx
      .select({ id: items.id, type: items.type })
      .from(items)
      .where(
        and(
          eq(items.businessId, books.businessId),
          inArray(items.id, ids),
          isNull(items.deletedAt),
        ),
      );
    for (const r of rows) itemTypes.set(r.id, r.type);
    for (const id of ids) if (!itemTypes.has(id)) throw bad('unknown_item', `Unknown item ${id}`);
  }
  if (PAYMENT_TYPES.has(doc.type)) {
    const targetIds = allocationIds(doc);
    if (new Set(targetIds).size !== targetIds.length) {
      throw bad('duplicate_allocation', 'A payment allocates to each document at most once');
    }
    if (targetIds.length > 0) {
      const rows = await tx
        .select()
        .from(documents)
        .where(and(eq(documents.businessId, books.businessId), inArray(documents.id, targetIds)));
      for (const id of targetIds) {
        const t = rows.find((r) => r.id === id);
        if (!t || t.deletedAt || t.status === 'void')
          throw bad('unknown_allocation_target', `Unknown document ${id}`);
        if (t.id === doc.id) throw bad('self_allocation', 'A payment cannot settle itself');
        const target = rowToDocument(t);
        if (!isOnCredit(target))
          throw bad('not_on_credit', `Document ${id} is not open for payment`);
        if (target.contactId !== doc.contactId)
          throw bad('contact_mismatch', `Document ${id} belongs to another contact`);
      }
    }
  }
  return itemTypes;
}

async function clearDerived(tx: Tx, businessId: string, documentId: string): Promise<void> {
  const entries = await tx
    .delete(journalEntries)
    .where(eq(journalEntries.documentId, documentId))
    .returning({ id: journalEntries.id });
  for (const e of entries) await recordChange(tx, businessId, 'journal_entry', e.id, 'delete', {});
  const movements = await tx
    .delete(stockMovements)
    .where(eq(stockMovements.documentId, documentId))
    .returning({ id: stockMovements.id });
  for (const m of movements)
    await recordChange(tx, businessId, 'stock_movement', m.id, 'delete', {});
  await tx.delete(documentAllocations).where(eq(documentAllocations.paymentId, documentId));
}

async function insertAllocations(tx: Tx, books: Books, doc: Document): Promise<void> {
  const rows = doc.allocations
    .filter((a) => a.amount > 0)
    .map((a) => ({
      paymentId: doc.id,
      documentId: a.documentId,
      businessId: books.businessId,
      amount: a.amount,
      date: doc.date,
    }));
  if (rows.length > 0) await tx.insert(documentAllocations).values(rows);
}

/** Recomputes paid amount and status for documents, logging the new row for sync. */
async function refreshSettled(
  tx: Tx,
  books: Books,
  documentIds: string[],
  mutationId: string | null,
): Promise<Document[]> {
  const out: Document[] = [];
  for (const id of documentIds) {
    const [row] = await tx.select().from(documents).where(eq(documents.id, id)).limit(1);
    if (!row) continue;
    const [sum] = await tx
      .select({ paid: sql<number>`coalesce(sum(${documentAllocations.amount}), 0)::bigint` })
      .from(documentAllocations)
      .innerJoin(documents, eq(documents.id, documentAllocations.paymentId))
      .where(and(eq(documentAllocations.documentId, id), isNull(documents.deletedAt)));
    const paidAmount = Number(sum?.paid ?? 0);
    const current = rowToDocument(row);
    const status = documentStatus(current, paidAmount);
    const [updated] = await tx
      .update(documents)
      .set({ paidAmount, status })
      .where(eq(documents.id, id))
      .returning();
    if (!updated) continue;
    const next = rowToDocument(updated);
    out.push(next);
    const op = next.deletedAt ? 'delete' : 'upsert';
    await recordChange(
      tx,
      books.businessId,
      'document',
      id,
      op,
      op === 'delete' ? {} : { ...next },
      mutationId,
    );
  }
  return out;
}

async function paymentsAllocatingTo(
  tx: Tx,
  businessId: string,
  documentIds: string[],
): Promise<string[]> {
  if (documentIds.length === 0) return [];
  const rows = await tx
    .selectDistinct({ paymentId: documentAllocations.paymentId })
    .from(documentAllocations)
    .where(
      and(
        eq(documentAllocations.businessId, businessId),
        inArray(documentAllocations.documentId, documentIds),
      ),
    );
  return rows.map((r) => r.paymentId);
}

async function loadEntries(tx: Tx, documentId: string) {
  const entries = await tx
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.documentId, documentId), isNull(journalEntries.deletedAt)));
  if (entries.length === 0) return [];
  const lines = await tx
    .select()
    .from(journalLines)
    .where(
      inArray(
        journalLines.entryId,
        entries.map((e) => e.id),
      ),
    );
  return entries.map((e) =>
    rowToJournalEntry(
      e,
      lines.filter((l) => l.entryId === e.id),
    ),
  );
}

/** Builds the allocation target a payment needs for one settled document. */
async function loadAllocationTarget(
  tx: Tx,
  books: Books,
  payment: Document,
  targetId: string,
): Promise<AllocationTarget | undefined> {
  const [row] = await tx.select().from(documents).where(eq(documents.id, targetId)).limit(1);
  if (!row || row.businessId !== books.businessId) return undefined;
  const target = rowToDocument(row);
  const kind = allocationKind(target, (id) => books.accountsById.get(id)?.code);
  if (!kind) return undefined;
  const [sum] = await tx
    .select({ paid: sql<number>`coalesce(sum(${documentAllocations.amount}), 0)::bigint` })
    .from(documentAllocations)
    .innerJoin(documents, eq(documents.id, documentAllocations.paymentId))
    .where(
      and(
        eq(documentAllocations.documentId, targetId),
        ne(documentAllocations.paymentId, payment.id),
        isNull(documents.deletedAt),
        or(
          lt(documentAllocations.date, payment.date),
          and(
            eq(documentAllocations.date, payment.date),
            lt(documentAllocations.paymentId, payment.id),
          ),
        ),
      ),
    );
  const entries = await loadEntries(tx, targetId);
  const accrualLines: JournalLine[] = entries
    .filter((e) => e.basis === 'accrual')
    .flatMap((e) => e.lines);
  return {
    documentId: targetId,
    type: target.type,
    kind,
    total: target.total,
    paidBefore: Number(sum?.paid ?? 0),
    accrualLines,
  };
}

/** Deletes and rebuilds the journal entries of one document from its current state. */
async function postOne(
  tx: Tx,
  books: Books,
  documentId: string,
  mutationId: string | null,
): Promise<void> {
  const [row] = await tx.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!row || row.businessId !== books.businessId) return;
  const doc = rowToDocument(row);

  const old = await tx
    .delete(journalEntries)
    .where(eq(journalEntries.documentId, documentId))
    .returning({ id: journalEntries.id });
  for (const e of old)
    await recordChange(tx, books.businessId, 'journal_entry', e.id, 'delete', {});
  if (doc.deletedAt || doc.status === 'void') return;

  const ids = [...new Set(itemIds(doc))];
  const itemTypes = new Map<string, ItemType>();
  if (ids.length > 0) {
    const rows = await tx
      .select({ id: items.id, type: items.type })
      .from(items)
      .where(inArray(items.id, ids));
    for (const r of rows) itemTypes.set(r.id, r.type);
  }
  const movementRows = await tx
    .select({
      lineId: stockMovements.lineId,
      value: stockMovements.value,
      quantityMilli: stockMovements.quantityMilli,
    })
    .from(stockMovements)
    .where(and(eq(stockMovements.documentId, documentId), isNull(stockMovements.deletedAt)));
  const lineCosts = new Map<string, number>();
  for (const m of movementRows) {
    if (m.lineId && m.quantityMilli < 0) lineCosts.set(m.lineId, -m.value);
  }
  const targets = new Map<string, AllocationTarget | undefined>();
  if (PAYMENT_TYPES.has(doc.type)) {
    for (const a of doc.allocations)
      targets.set(a.documentId, await loadAllocationTarget(tx, books, doc, a.documentId));
  }

  const ctx: PostingContext = {
    systemAccounts: books.systemAccounts,
    accountType: (id) => books.accountsById.get(id)?.type,
    itemType: (id) => itemTypes.get(id),
    lineCost: (lineId) => lineCosts.get(lineId),
    allocationTarget: (id) => targets.get(id),
  };
  let result: ReturnType<typeof postDocument>;
  try {
    result = postDocument(doc, ctx);
  } catch (err) {
    throw toApiError(err);
  }

  const now = new Date(doc.updatedAt);
  for (const e of result.entries) {
    const id = newId();
    await tx.insert(journalEntries).values({
      id,
      businessId: books.businessId,
      documentId,
      date: e.date,
      basis: e.basis,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(journalLines).values(
      e.lines.map((l, i) => ({
        entryId: id,
        lineNo: i + 1,
        businessId: books.businessId,
        accountId: l.accountId,
        debit: l.debit,
        credit: l.credit,
        contactId: l.contactId,
        itemId: l.itemId,
      })),
    );
    await recordChange(
      tx,
      books.businessId,
      'journal_entry',
      id,
      'upsert',
      {
        id,
        businessId: books.businessId,
        documentId,
        date: e.date,
        basis: e.basis,
        lines: e.lines,
        createdAt: doc.updatedAt,
        updatedAt: doc.updatedAt,
        deletedAt: null,
      },
      mutationId,
    );
  }
}

/** Accounts referenced by journal lines cannot be deleted; used by the account routes. */
export async function accountHasPostings(tx: Tx, accountId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: journalLines.accountId })
    .from(journalLines)
    .where(eq(journalLines.accountId, accountId))
    .limit(1);
  return row !== undefined;
}
