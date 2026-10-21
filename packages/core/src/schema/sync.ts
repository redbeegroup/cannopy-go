import { z } from 'zod';
import { idSchema } from '../ids/id.js';
import { isoInstantSchema } from './common.js';

/**
 * Offline-first sync protocol (see docs/architecture.md, decision 6).
 * The device keeps an outbox of mutations and pushes them in order; the server
 * applies each one once (idempotent by mutation id), assigns a server sequence
 * number per business, and the device pulls everything after the last sequence
 * it has seen.
 */
export const syncEntitySchema = z.enum([
  'account',
  'contact',
  'item',
  'document',
  'stock_movement',
  'journal_entry',
]);
export type SyncEntity = z.infer<typeof syncEntitySchema>;

export const mutationSchema = z.object({
  /** Client-generated UUID v7; the server stores it to make retries idempotent. */
  id: idSchema,
  entity: syncEntitySchema,
  entityId: idSchema,
  op: z.enum(['upsert', 'delete']),
  /** Full row for upsert; empty for delete. */
  data: z.record(z.string(), z.unknown()).default({}),
  clientAt: isoInstantSchema,
  deviceId: z.string().max(64),
});
export type Mutation = z.infer<typeof mutationSchema>;

export const pushRequestSchema = z.object({
  businessId: idSchema,
  mutations: z.array(mutationSchema).max(500),
});
export type PushRequest = z.infer<typeof pushRequestSchema>;

export const pushResultSchema = z.object({
  accepted: z.array(idSchema),
  rejected: z.array(z.object({ id: idSchema, reason: z.string() })),
  serverSeq: z.number().int().nonnegative(),
});
export type PushResult = z.infer<typeof pushResultSchema>;

export const pullRequestSchema = z.object({
  businessId: idSchema,
  /** Last server sequence this device has applied; 0 for a fresh install. Coerced: it arrives as a query string. */
  since: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});

export const changeSchema = z.object({
  seq: z.number().int().positive(),
  entity: syncEntitySchema,
  entityId: idSchema,
  op: z.enum(['upsert', 'delete']),
  data: z.record(z.string(), z.unknown()).default({}),
});
export type Change = z.infer<typeof changeSchema>;

export const pullResponseSchema = z.object({
  changes: z.array(changeSchema),
  serverSeq: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});
export type PullResponse = z.infer<typeof pullResponseSchema>;
