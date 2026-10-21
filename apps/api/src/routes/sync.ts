import {
  accountSchema,
  contactSchema,
  documentSchema,
  itemSchema,
  type Mutation,
  pullRequestSchema,
  pullResponseSchema,
  pushRequestSchema,
} from '@cannopy/core';
import { and, desc, eq, gt } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { Db } from '../db/client.js';
import { syncChanges, syncMutations } from '../db/schema/index.js';
import {
  deleteAccount,
  deleteContact,
  deleteItem,
  upsertAccount,
  upsertContact,
  upsertItem,
} from '../services/entities.js';
import { ApiError } from '../services/errors.js';
import { deleteDocument, upsertDocument } from '../services/ledger.js';
import type { Tx } from '../services/tx.js';
import { currentUserId } from './common.js';

/**
 * Offline sync endpoints. A device pushes its outbox of mutations; each one
 * is stored by its client id (so a retried push is applied once) and applied
 * through the same services the REST routes use. The services append every
 * row they create or change (the document with its server-assigned number and
 * status, journal entries, stock movements, recosted items) to the change
 * log, which devices pull from.
 *
 * Authentication is not wired yet: the acting user comes from a dev-only
 * header. Until the auth work lands these routes are only reachable in
 * development.
 */
export const syncRoutes: FastifyPluginAsync<{ db: Db | null }> = async (app, { db }) => {
  app.post('/sync/push', async (req, reply) => {
    const parsed = pushRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request', issues: parsed.error.issues });
    }
    if (!db) return reply.code(503).send({ error: 'database_unavailable' });
    const { businessId, mutations } = parsed.data;
    const userId = currentUserId(req);
    if (!userId) return reply.code(401).send({ error: 'unauthenticated' });

    const accepted: string[] = [];
    const rejected: { id: string; reason: string }[] = [];

    // Each mutation is its own transaction so one bad record does not block the rest of the outbox.
    for (const m of mutations) {
      try {
        const applied = await db.transaction(async (tx) => {
          const inserted = await tx
            .insert(syncMutations)
            .values({
              id: m.id,
              businessId,
              userId,
              deviceId: m.deviceId,
              entity: m.entity,
              entityId: m.entityId,
              op: m.op,
              data: m.data,
              clientAt: new Date(m.clientAt),
            })
            .onConflictDoNothing()
            .returning({ id: syncMutations.id });
          if (inserted.length === 0) return 'duplicate';
          await applyMutation(tx, businessId, userId, m);
          return 'applied';
        });
        void applied;
        accepted.push(m.id);
      } catch (err) {
        rejected.push({ id: m.id, reason: reasonOf(err) });
      }
    }

    const serverSeq = await latestSeq(db, businessId);
    return { accepted, rejected, serverSeq };
  });

  app.get('/sync/pull', async (req, reply) => {
    const parsed = pullRequestSchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request', issues: parsed.error.issues });
    }
    if (!db) return reply.code(503).send({ error: 'database_unavailable' });
    const { businessId, since, limit } = parsed.data;

    const rows = await db
      .select({
        seq: syncChanges.seq,
        entity: syncChanges.entity,
        entityId: syncChanges.entityId,
        op: syncChanges.op,
        data: syncChanges.data,
      })
      .from(syncChanges)
      .where(and(eq(syncChanges.businessId, businessId), gt(syncChanges.seq, since)))
      .orderBy(syncChanges.seq)
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const changes = rows
      .slice(0, limit)
      .map((r) => ({ ...r, data: r.data as Record<string, unknown> }));
    const serverSeq = changes.length > 0 ? (changes.at(-1)?.seq ?? since) : since;
    return pullResponseSchema.parse({ changes, serverSeq, hasMore });
  });
};

/**
 * Applies one mutation through the domain services. Devices own accounts,
 * contacts, items and documents; journal entries and stock movements are
 * derived on the server and cannot be pushed.
 */
export async function applyMutation(
  tx: Tx,
  businessId: string,
  userId: string,
  m: Mutation,
): Promise<void> {
  const at = m.clientAt;
  const withIds = { ...m.data, id: m.entityId, businessId };
  switch (m.entity) {
    case 'document': {
      if (m.op === 'delete') {
        await deleteDocument(tx, {
          businessId,
          userId,
          documentId: m.entityId,
          deletedAt: at,
          mutationId: m.id,
        });
        return;
      }
      const document = parse(documentSchema, withIds);
      await upsertDocument(tx, { businessId, userId, document, mutationId: m.id });
      return;
    }
    case 'account': {
      if (m.op === 'delete') return deleteAccount(tx, businessId, m.entityId, at, m.id);
      await upsertAccount(tx, businessId, parse(accountSchema, withIds), m.id);
      return;
    }
    case 'contact': {
      if (m.op === 'delete') return deleteContact(tx, businessId, m.entityId, at, m.id);
      await upsertContact(tx, businessId, parse(contactSchema, withIds), m.id);
      return;
    }
    case 'item': {
      if (m.op === 'delete') return deleteItem(tx, businessId, m.entityId, at, m.id);
      await upsertItem(tx, businessId, parse(itemSchema, withIds), m.id);
      return;
    }
    case 'journal_entry':
    case 'stock_movement':
      throw new ApiError(
        422,
        'server_owned',
        `${m.entity} rows are derived on the server and cannot be pushed`,
      );
  }
}

function parse<T>(
  schema: {
    safeParse(
      v: unknown,
    ): { success: true; data: T } | { success: false; error: { issues: unknown } };
  },
  value: unknown,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new ApiError(400, 'invalid_mutation', 'Mutation data is invalid', parsed.error.issues);
  return parsed.data;
}

function reasonOf(err: unknown): string {
  if (err instanceof ApiError) return `${err.code}: ${err.message}`;
  return err instanceof Error ? err.message : 'rejected';
}

async function latestSeq(db: Db, businessId: string): Promise<number> {
  const [latest] = await db
    .select({ seq: syncChanges.seq })
    .from(syncChanges)
    .where(eq(syncChanges.businessId, businessId))
    .orderBy(desc(syncChanges.seq))
    .limit(1);
  return latest?.seq ?? 0;
}
