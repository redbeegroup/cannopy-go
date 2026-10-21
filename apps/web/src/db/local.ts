import type {
  Account,
  Business,
  Contact,
  Document,
  Item,
  JournalEntry,
  MemberRole,
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
  /** What the signed-in user is in this business: owner or member. */
  role: 'business.role',
  /** The signed-in User row; its id goes on every document this device creates. */
  user: 'user.row',
  /** The device session token, sent as a bearer token when syncing. */
  token: 'auth.token',
} as const;

export async function getMeta<T>(db: LocalDb, key: string): Promise<T | undefined> {
  const row = await db.meta.get(key);
  return row?.value as T | undefined;
}

export async function setMeta(db: LocalDb, key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

/** A signed-in user on this device, before or without a business being open. */
export interface Auth {
  token: string;
  user: User;
}

/** A business open on this device: the signed-in user plus the books they chose. */
export interface Session extends Auth {
  business: Business;
  role: MemberRole;
}

export async function loadAuth(db: LocalDb): Promise<Auth | null> {
  const [token, user] = await Promise.all([
    getMeta<string>(db, META_KEYS.token),
    getMeta<User>(db, META_KEYS.user),
  ]);
  return token && user ? { token, user } : null;
}

export async function saveAuth(db: LocalDb, auth: Auth): Promise<void> {
  await db.transaction('rw', db.meta, async () => {
    await setMeta(db, META_KEYS.token, auth.token);
    await setMeta(db, META_KEYS.user, auth.user);
  });
}

export async function loadSession(db: LocalDb): Promise<Session | null> {
  const [auth, business, role] = await Promise.all([
    loadAuth(db),
    getMeta<Business>(db, META_KEYS.business),
    getMeta<MemberRole>(db, META_KEYS.role),
  ]);
  return auth && business ? { ...auth, business, role: role ?? 'owner' } : null;
}

export async function saveSession(db: LocalDb, session: Session): Promise<void> {
  await db.transaction('rw', db.meta, async () => {
    await setMeta(db, META_KEYS.token, session.token);
    await setMeta(db, META_KEYS.user, session.user);
    await setMeta(db, META_KEYS.business, session.business);
    await setMeta(db, META_KEYS.role, session.role);
    await setMeta(db, META_KEYS.businessId, session.business.id);
  });
}

/**
 * Drops the books on this device (rows, outbox, sync cursor) but keeps the
 * device id and the sign-in, for switching to another business.
 */
export async function clearBooks(db: LocalDb): Promise<void> {
  await db.transaction(
    'rw',
    [db.accounts, db.contacts, db.items, db.documents, db.journalEntries, db.outbox, db.meta],
    async () => {
      await Promise.all([
        db.accounts.clear(),
        db.contacts.clear(),
        db.items.clear(),
        db.documents.clear(),
        db.journalEntries.clear(),
        db.outbox.clear(),
      ]);
      await db.meta
        .where('key')
        .anyOf([
          META_KEYS.business,
          META_KEYS.businessId,
          META_KEYS.role,
          META_KEYS.serverSeq,
          META_KEYS.lastSyncAt,
          'sync.rejected',
        ])
        .delete();
    },
  );
}

/** Wipes the working copy. Used by "Sign out" in settings. */
export async function clearDevice(db: LocalDb): Promise<void> {
  await db.delete();
  await db.open();
}
