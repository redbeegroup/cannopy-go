import {
  type Mutation,
  newId,
  type PullResponse,
  type PushResult,
  pullResponseSchema,
  pushResultSchema,
} from '@cannopy/core';
import { getMeta, type LocalDb, META_KEYS, setMeta } from '../db/local';

/**
 * Outbox-based sync. Every local write enqueues a mutation; `push` sends the
 * queue in order and `pull` applies the server's change log. Both are safe to
 * retry: mutations are idempotent by id and pulls are cursor-based.
 *
 * Conflict policy for version 1 (one owner, maybe two devices): the server
 * applies mutations in the order it receives them and the change log wins on
 * the device. See docs/architecture.md, decision 6.
 */
export class SyncClient {
  constructor(
    private readonly db: LocalDb,
    private readonly apiBaseUrl: string = import.meta.env.VITE_API_BASE_URL ?? '/api',
  ) {}

  async deviceId(): Promise<string> {
    let id = await getMeta<string>(this.db, META_KEYS.deviceId);
    if (!id) {
      id = newId();
      await setMeta(this.db, META_KEYS.deviceId, id);
    }
    return id;
  }

  /** Records a local change to be pushed later. Call inside the same transaction as the write. */
  async enqueue(m: Omit<Mutation, 'id' | 'clientAt' | 'deviceId'>): Promise<void> {
    await this.db.outbox.add({
      ...m,
      id: newId(),
      clientAt: new Date().toISOString(),
      deviceId: await this.deviceId(),
      attempts: 0,
    });
  }

  async pendingCount(): Promise<number> {
    return this.db.outbox.count();
  }

  async push(businessId: string, batchSize = 200): Promise<PushResult | null> {
    const batch = await this.db.outbox.orderBy('seq').limit(batchSize).toArray();
    if (batch.length === 0) return null;
    const mutations: Mutation[] = batch.map(
      ({ seq: _seq, attempts: _a, lastError: _e, ...m }) => m,
    );

    const res = await fetch(`${this.apiBaseUrl}/sync/push`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ businessId, mutations }),
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`push failed: ${res.status}`);
    const result = pushResultSchema.parse(await res.json());

    const done = new Set([...result.accepted, ...result.rejected.map((r) => r.id)]);
    await this.db.outbox
      .where('id')
      .anyOf([...done])
      .delete();
    return result;
  }

  async pull(businessId: string): Promise<PullResponse> {
    const since = (await getMeta<number>(this.db, META_KEYS.serverSeq)) ?? 0;
    const url = new URL(`${this.apiBaseUrl}/sync/pull`, window.location.origin);
    url.searchParams.set('businessId', businessId);
    url.searchParams.set('since', String(since));
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`pull failed: ${res.status}`);
    const page = pullResponseSchema.parse(await res.json());
    await this.applyChanges(page);
    return page;
  }

  private async applyChanges(page: PullResponse): Promise<void> {
    await this.db.transaction(
      'rw',
      [this.db.accounts, this.db.contacts, this.db.items, this.db.documents, this.db.meta],
      async () => {
        for (const c of page.changes) {
          const table = this.tableFor(c.entity);
          if (!table) continue;
          if (c.op === 'delete') await table.delete(c.entityId);
          else await table.put(c.data as never);
        }
        await setMeta(this.db, META_KEYS.serverSeq, page.serverSeq);
      },
    );
  }

  private tableFor(entity: Mutation['entity']) {
    switch (entity) {
      case 'account':
        return this.db.accounts;
      case 'contact':
        return this.db.contacts;
      case 'item':
        return this.db.items;
      case 'document':
        return this.db.documents;
      default:
        // stock movements and journal entries are server-derived; the device
        // keeps documents and lets thread 3 decide what to cache for reports.
        return null;
    }
  }
}
