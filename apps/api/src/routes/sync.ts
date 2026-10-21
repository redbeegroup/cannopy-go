import { pullRequestSchema, pullResponseSchema, pushRequestSchema } from '@cannopy/core';
import { and, desc, eq, gt } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { Db } from '../db/client.js';
import { syncChanges, syncMutations } from '../db/schema/index.js';

/**
 * Offline sync endpoints. This is the transport skeleton; thread 3 (core
 * accounting and inventory) plugs the domain logic into `applyMutation`, which
 * is where a document mutation becomes journal entries and stock movements.
 *
 * Authentication is not wired yet: `currentUser` is a placeholder that the auth
 * work replaces with the session user. Until then these routes are only
 * reachable in development.
 */
export const syncRoutes: FastifyPluginAsync<{ db: Db | null }> = async (app, { db }) => {
  app.post('/sync/push', async (req, reply) => {
    const parsed = pushRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request', issues: parsed.error.issues });
    }
    if (!db) return reply.code(503).send({ error: 'database_unavailable' });
    const { businessId, mutations } = parsed.data;
    const user = currentUser(req.headers);
    if (!user) return reply.code(401).send({ error: 'unauthenticated' });

    const accepted: string[] = [];
    const rejected: { id: string; reason: string }[] = [];

    await db.transaction(async (tx) => {
      for (const m of mutations) {
        const inserted = await tx
          .insert(syncMutations)
          .values({
            id: m.id,
            businessId,
            userId: user.id,
            deviceId: m.deviceId,
            entity: m.entity,
            entityId: m.entityId,
            op: m.op,
            data: m.data,
            clientAt: new Date(m.clientAt),
          })
          .onConflictDoNothing()
          .returning({ id: syncMutations.id });

        if (inserted.length === 0) {
          // Already applied by an earlier push: idempotent success.
          accepted.push(m.id);
          continue;
        }

        try {
          await applyMutation();
          await tx.insert(syncChanges).values({
            businessId,
            entity: m.entity,
            entityId: m.entityId,
            op: m.op,
            data: m.data,
            mutationId: m.id,
          });
          accepted.push(m.id);
        } catch (err) {
          rejected.push({ id: m.id, reason: err instanceof Error ? err.message : 'rejected' });
        }
      }
    });

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

/** Placeholder until the auth work lands. Reads a dev-only header. */
function currentUser(headers: Record<string, unknown>): { id: string } | null {
  const id = headers['x-dev-user-id'];
  return typeof id === 'string' && id.length > 0 ? { id } : null;
}

/** Thread 3 replaces this with posting rules, stock costing and audit logging. */
async function applyMutation(): Promise<void> {
  // Intentionally empty in the scaffold: the change log still records the mutation.
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
