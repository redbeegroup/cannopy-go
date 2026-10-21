import type { Account, Contact, Document, Item, Mutation } from '@cannopy/core';
import Dexie, { type EntityTable } from 'dexie';

/**
 * On-device store (IndexedDB). This is the working copy the app reads and
 * writes; the server is reached only by sync. Tables mirror the shared entity
 * schemas in @cannopy/core, plus an outbox of mutations waiting to be pushed
 * and a small key-value table for sync cursors and settings.
 */
export interface OutboxEntry extends Mutation {
  /** Monotonic order within this device. */
  seq?: number;
  attempts: number;
  lastError?: string;
}

export interface MetaEntry {
  key: string;
  value: unknown;
}

export class LocalDb extends Dexie {
  accounts!: EntityTable<Account, 'id'>;
  contacts!: EntityTable<Contact, 'id'>;
  items!: EntityTable<Item, 'id'>;
  documents!: EntityTable<Document, 'id'>;
  outbox!: EntityTable<OutboxEntry, 'seq'>;
  meta!: EntityTable<MetaEntry, 'key'>;

  constructor(name = 'cannopy') {
    super(name);
    this.version(1).stores({
      accounts: 'id, businessId, code, type, ownerGroup',
      contacts: 'id, businessId, isCustomer, isSupplier',
      items: 'id, businessId, type, barcode',
      documents: 'id, businessId, type, date, contactId, status',
      outbox: '++seq, id, entity, entityId',
      meta: 'key',
    });
  }
}

export const localDb = new LocalDb();

export const META_KEYS = {
  /** Last server sequence applied on this device. */
  serverSeq: 'sync.serverSeq',
  deviceId: 'device.id',
  businessId: 'business.id',
} as const;

export async function getMeta<T>(db: LocalDb, key: string): Promise<T | undefined> {
  const row = await db.meta.get(key);
  return row?.value as T | undefined;
}

export async function setMeta(db: LocalDb, key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}
