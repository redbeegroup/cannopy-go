import { newId } from '@cannopy/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalDb } from '../db/local';
import { SyncManager } from '../sync/manager';
import { Repo } from './repo';

describe('repo: every write lands in the working copy and the outbox together', () => {
  let db: LocalDb;
  let repo: Repo;
  const businessId = newId();
  const userId = newId();

  beforeEach(() => {
    db = new LocalDb(`repo-test-${Math.random()}`);
    repo = new Repo(db, new SyncManager(db));
  });
  afterEach(async () => {
    await db.delete();
  });

  it('saves a document and queues an upsert with the same row', async () => {
    const doc = await repo.newDocument(businessId, userId, 'sale', '2026-10-21');
    doc.total = 5000;
    doc.lines = [
      {
        id: newId(),
        itemId: null,
        accountId: null,
        description: 'tea',
        quantityMilli: 1000,
        unitPrice: 0,
        amount: 5000,
        taxAmount: 0,
      },
    ];
    await repo.saveDocument(doc);

    const stored = await db.documents.get(doc.id);
    expect(stored?.total).toBe(5000);
    const outbox = await db.outbox.toArray();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.entity).toBe('document');
    expect(outbox[0]?.op).toBe('upsert');
    expect(outbox[0]?.entityId).toBe(doc.id);
    expect((outbox[0]?.data as { total: number }).total).toBe(5000);
    expect(outbox[0]?.deviceId).toBe(doc.deviceId);
  });

  it('marks a deleted document void locally and queues a delete', async () => {
    const doc = await repo.newDocument(businessId, userId, 'expense', '2026-10-21');
    await repo.saveDocument(doc);
    await repo.deleteDocument(doc.id);

    const stored = await db.documents.get(doc.id);
    expect(stored?.status).toBe('void');
    expect(stored?.deletedAt).not.toBeNull();
    const ops = (await db.outbox.orderBy('seq').toArray()).map((m) => m.op);
    expect(ops).toEqual(['upsert', 'delete']);
  });

  it('builds contacts and items with the shared defaults', async () => {
    const contact = repo.newContact(businessId);
    expect(contact.isCustomer).toBe(true);
    const item = repo.newItem(businessId);
    expect(item.type).toBe('stocked');
    expect(item.unit).toEqual({ en: 'piece', my: 'ခု' });
    await repo.saveContact(contact);
    await repo.saveItem(item);
    expect(await db.outbox.count()).toBe(2);
  });
});
