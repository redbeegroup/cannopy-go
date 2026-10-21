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
    /** The device's session token, sent as a bearer token. */
    private readonly token: () => Promise<string | null> = async () =>
      (await getMeta<string>(db, META_KEYS.token)) ?? null,
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

  private async headers(): Promise<Record<string, string>> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const token = await this.token();
    if (token) headers.authorization = `Bearer ${token}`;
    return headers;
  }

  /** Turns a refused push or pull into an error the manager can tell apart. */
  private refused(what: 'push' | 'pull', res: Response): Error {
    if (res.status === 401 || res.status === 403) return new SyncAuthError(what, res.status);
    return new Error(`${what} failed: ${res.status}`);
  }

  async push(businessId: string, batchSize = 200): Promise<PushResult | null> {
    const batch = await this.db.outbox.orderBy('seq').limit(batchSize).toArray();
    if (batch.length === 0) return null;
    const mutations: Mutation[] = batch.map(
      ({ seq: _seq, attempts: _a, lastError: _e, ...m }) => m,
    );

    const res = await fetch(`${this.apiBaseUrl}/sync/push`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify({ businessId, mutations }),
      credentials: 'include',
    });
    if (!res.ok) throw this.refused('push', res);
    const result = pushResultSchema.parse(await res.json());

    // Accepted and rejected mutations both leave the queue: a rejected one
    // would be rejected again, and the server's version of the record arrives
    // on the next pull. The reason is kept for the sync screen.
    const done = new Set([...result.accepted, ...result.rejected.map((r) => r.id)]);
    await this.db.outbox
      .where('id')
      .anyOf([...done])
      .delete();
    if (result.rejected.length > 0) {
      const previous = (await getMeta<RejectedMutation[]>(this.db, REJECTED_KEY)) ?? [];
      const byId = new Map(batch.map((b) => [b.id, b]));
      const rows: RejectedMutation[] = result.rejected.map((r) => ({
        id: r.id,
        entity: byId.get(r.id)?.entity ?? 'document',
        entityId: byId.get(r.id)?.entityId ?? '',
        reason: r.reason,
        at: new Date().toISOString(),
      }));
      await setMeta(this.db, REJECTED_KEY, [...rows, ...previous].slice(0, 50));
    }
    return result;
  }

  async pull(businessId: string): Promise<PullResponse> {
    const since = (await getMeta<number>(this.db, META_KEYS.serverSeq)) ?? 0;
    const url = new URL(`${this.apiBaseUrl}/sync/pull`, window.location.origin);
    url.searchParams.set('businessId', businessId);
    url.searchParams.set('since', String(since));
    const res = await fetch(url, { credentials: 'include', headers: await this.headers() });
    if (!res.ok) throw this.refused('pull', res);
    const page = pullResponseSchema.parse(await res.json());
    await this.applyChanges(page);
    return page;
  }

  /** Pulls until the server has nothing newer. */
  async pullAll(businessId: string, maxPages = 50): Promise<number> {
    let applied = 0;
    for (let i = 0; i < maxPages; i++) {
      const page = await this.pull(businessId);
      applied += page.changes.length;
      if (!page.hasMore) break;
    }
    return applied;
  }

  /** Push what is waiting, then pull what is new. */
  async sync(businessId: string): Promise<{ pushed: number; rejected: number; pulled: number }> {
    let pushed = 0;
    let rejected = 0;
    for (let i = 0; i < 20; i++) {
      const result = await this.push(businessId);
      if (!result) break;
      pushed += result.accepted.length;
      rejected += result.rejected.length;
      if (result.accepted.length + result.rejected.length === 0) break;
    }
    const pulled = await this.pullAll(businessId);
    await setMeta(this.db, META_KEYS.lastSyncAt, new Date().toISOString());
    return { pushed, rejected, pulled };
  }

  private async applyChanges(page: PullResponse): Promise<void> {
    await this.db.transaction(
      'rw',
      [
        this.db.accounts,
        this.db.contacts,
        this.db.items,
        this.db.documents,
        this.db.journalEntries,
        this.db.meta,
      ],
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
      case 'journal_entry':
        return this.db.journalEntries;
      default:
        // Stock movements are summarised on the item rows the server recosts,
        // so the device does not keep them.
        return null;
    }
  }
}

/**
 * The server no longer accepts this device: the session was signed out
 * elsewhere, expired, or the user was removed from the business. The device
 * keeps its data and asks the owner to sign in again.
 */
export class SyncAuthError extends Error {
  constructor(
    readonly what: 'push' | 'pull',
    readonly status: number,
  ) {
    super(status === 403 ? 'not_a_member' : 'unauthenticated');
    this.name = 'SyncAuthError';
  }
}

export const REJECTED_KEY = 'sync.rejected';

export interface RejectedMutation {
  id: string;
  entity: Mutation['entity'];
  entityId: string;
  reason: string;
  at: string;
}
