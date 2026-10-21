import {
  type Account,
  type Contact,
  type Document,
  type DocumentLine,
  type Item,
  newId,
  type SyncedRow,
} from '@cannopy/core';
import type { EntityTable } from 'dexie';
import { type LocalDb, localDb } from '../db/local';
import { type SyncManager, syncManager } from '../sync/manager';

/**
 * Every write the owner makes goes through here: the row is put in IndexedDB
 * and a mutation is appended to the outbox in the same transaction, then a
 * sync is requested. The screen is done as soon as the transaction commits,
 * with or without signal. The server's version of the row (document number,
 * status, paid amount, recosted item caches) replaces the local one when the
 * change log is pulled.
 */
export class Repo {
  constructor(
    private readonly db: LocalDb = localDb,
    private readonly sync: SyncManager = syncManager,
  ) {}

  private now(): string {
    return new Date().toISOString();
  }

  private async write<T extends SyncedRow>(
    entity: 'account' | 'contact' | 'item' | 'document',
    row: T,
  ): Promise<T> {
    const table = tableOf(this.db, entity) as unknown as EntityTable<T, 'id'>;
    const saved = { ...row, updatedAt: this.now() };
    const { serverSeq: _seq, ...data } = saved;
    await this.db.transaction('rw', [table, this.db.outbox, this.db.meta], async () => {
      await table.put(saved as never);
      await this.sync.client.enqueue({ entity, entityId: saved.id, op: 'upsert', data });
    });
    this.sync.requestSync();
    return saved;
  }

  private async remove(
    entity: 'account' | 'contact' | 'item' | 'document',
    id: string,
  ): Promise<void> {
    const table = tableOf(this.db, entity) as unknown as EntityTable<SyncedRow, 'id'>;
    const at = this.now();
    await this.db.transaction('rw', [table, this.db.outbox, this.db.meta], async () => {
      const existing = await table.get(id);
      if (existing) {
        const row = { ...existing, deletedAt: at, updatedAt: at };
        if (entity === 'document') (row as Document).status = 'void';
        await table.put(row as never);
      }
      await this.sync.client.enqueue({ entity, entityId: id, op: 'delete', data: {} });
    });
    this.sync.requestSync();
  }

  saveDocument(doc: Document): Promise<Document> {
    return this.write('document', doc);
  }
  deleteDocument(id: string): Promise<void> {
    return this.remove('document', id);
  }
  saveContact(contact: Contact): Promise<Contact> {
    return this.write('contact', contact);
  }
  deleteContact(id: string): Promise<void> {
    return this.remove('contact', id);
  }
  saveItem(item: Item): Promise<Item> {
    return this.write('item', item);
  }
  deleteItem(id: string): Promise<void> {
    return this.remove('item', id);
  }
  saveAccount(account: Account): Promise<Account> {
    return this.write('account', account);
  }
  deleteAccount(id: string): Promise<void> {
    return this.remove('account', id);
  }

  /** A fresh row with the audit fields filled in. */
  newRow(businessId: string): SyncedRow {
    const now = this.now();
    return { id: newId(), businessId, createdAt: now, updatedAt: now, deletedAt: null };
  }

  /** A document with every default, ready for a screen to fill in. */
  async newDocument(
    businessId: string,
    userId: string,
    type: Document['type'],
    date: string,
  ): Promise<Document> {
    return {
      ...this.newRow(businessId),
      type,
      date,
      contactId: null,
      moneyAccountId: null,
      toMoneyAccountId: null,
      lines: [],
      allocations: [],
      total: 0,
      feeAmount: 0,
      paidAmount: 0,
      status: 'open',
      note: '',
      attachmentUrl: null,
      createdByUserId: userId,
      deviceId: await this.sync.client.deviceId(),
    };
  }

  newContact(businessId: string): Contact {
    return {
      ...this.newRow(businessId),
      name: { en: '', my: '' },
      phone: null,
      isCustomer: true,
      isSupplier: false,
      creditLimit: null,
      note: '',
    };
  }

  newItem(businessId: string): Item {
    return {
      ...this.newRow(businessId),
      name: { en: '', my: '' },
      type: 'stocked',
      unit: { en: 'piece', my: 'ခု' },
      sellingPrice: null,
      averageCost: 0,
      lastCost: null,
      quantityOnHandMilli: 0,
      stockValue: 0,
      lowStockLevelMilli: null,
      barcode: null,
      photoUrl: null,
      locationId: null,
      lotRef: null,
    };
  }
}

export function newLine(partial: Partial<DocumentLine> & { amount: number }): DocumentLine {
  return {
    id: newId(),
    itemId: null,
    accountId: null,
    description: '',
    quantityMilli: 1000,
    unitPrice: 0,
    taxAmount: 0,
    ...partial,
  };
}

function tableOf(db: LocalDb, entity: 'account' | 'contact' | 'item' | 'document') {
  switch (entity) {
    case 'account':
      return db.accounts;
    case 'contact':
      return db.contacts;
    case 'item':
      return db.items;
    case 'document':
      return db.documents;
  }
}

export const repo = new Repo();
