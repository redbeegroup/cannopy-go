import type {
  Account,
  Business,
  Contact,
  Document,
  Item,
  JournalEntry,
  Mutation,
  User,
} from '@cannopy/core';
import Dexie, { type EntityTable } from 'dexie';

/**
 * On-device store (IndexedDB). This is the working copy the app reads and
 * writes; the server is reached only by sync. Tables mirror the shared entity
 * schemas in @cannopy/core, plus an outbox of mutations waiting to be pushed
 * and a small key-value table for sync cursors and settings.
 *
 * Journal entries are server-derived and arrive through the change log. The
 * device keeps them so profit and the balance sheet can be shown offline with
 * the same report functions the API uses.
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
  journalEntries!: EntityTable<JournalEntry, 'id'>;
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
    this.version(2).stores({
      journalEntries: 'id, businessId, documentId, date, basis',
    });
  }
}

export const localDb = new LocalDb();

export const META_KEYS = {
  /** Last server sequence applied on this device. */
  serverSeq: 'sync.serverSeq',
  /** When the last successful sync finished (ISO instant). */
  lastSyncAt: 'sync.lastSyncAt',
  deviceId: 'device.id',
  businessId: 'business.id',
  /** The Business row, kept here because it is not a synced table. */
  business: 'business.row',
  /** The owner User row; its id is the acting user for every request. */
  user: 'user.row',
} as const;

export async function getMeta<T>(db: LocalDb, key: string): Promise<T | undefined> {
  const row = await db.meta.get(key);
  return row?.value as T | undefined;
}

export async function setMeta(db: LocalDb, key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

export interface Session {
  business: Business;
  user: User;
}

export async function loadSession(db: LocalDb): Promise<Session | null> {
  const [business, user] = await Promise.all([
    getMeta<Business>(db, META_KEYS.business),
    getMeta<User>(db, META_KEYS.user),
  ]);
  return business && user ? { business, user } : null;
}

export async function saveSession(db: LocalDb, session: Session): Promise<void> {
  await db.transaction('rw', db.meta, async () => {
    await setMeta(db, META_KEYS.business, session.business);
    await setMeta(db, META_KEYS.user, session.user);
    await setMeta(db, META_KEYS.businessId, session.business.id);
  });
}

/** Wipes the working copy. Used by "Start over on this device" in settings. */
export async function clearDevice(db: LocalDb): Promise<void> {
  await db.delete();
  await db.open();
}
