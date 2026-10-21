import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalDb } from '../db/local';
import { SyncClient } from './client';

describe('sync outbox', () => {
  let db: LocalDb;
  beforeEach(() => {
    db = new LocalDb(`test-${Math.random()}`);
  });
  afterEach(async () => {
    await db.delete();
  });

  it('assigns a stable device id and queues mutations in order', async () => {
    const sync = new SyncClient(db, 'http://api.test');
    const a = await sync.deviceId();
    const b = await sync.deviceId();
    expect(a).toBe(b);

    await sync.enqueue({ entity: 'document', entityId: a, op: 'upsert', data: { total: 10_000 } });
    await sync.enqueue({ entity: 'document', entityId: a, op: 'delete', data: {} });
    expect(await sync.pendingCount()).toBe(2);
    const rows = await db.outbox.orderBy('seq').toArray();
    expect(rows.map((r) => r.op)).toEqual(['upsert', 'delete']);
    expect(rows[0]?.deviceId).toBe(a);
  });
});
