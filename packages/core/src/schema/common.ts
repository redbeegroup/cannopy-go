import { z } from 'zod';
import { idSchema } from '../ids/id.js';
import { MAX_KYAT } from '../money/kyat.js';

/** Whole-kyat amount, never negative. Used for prices, totals and payments. */
export const kyatSchema = z.number().int().min(0).max(MAX_KYAT);
/** Signed whole-kyat amount for journal lines and stock movement values. */
export const signedKyatSchema = z.number().int().min(-MAX_KYAT).max(MAX_KYAT);

/** Calendar date as YYYY-MM-DD in the business's local time. Documents are dated, not timestamped. */
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
/** Instant as ISO 8601 with timezone, for audit fields. */
export const isoInstantSchema = z.string().datetime({ offset: true });

/**
 * Fields every synced row carries. `updatedAt` and `deletedAt` come from the
 * device that made the change; `serverSeq` is assigned by the API when the
 * change is accepted and drives incremental pull.
 */
export const syncedRowSchema = z.object({
  id: idSchema,
  businessId: idSchema,
  createdAt: isoInstantSchema,
  updatedAt: isoInstantSchema,
  deletedAt: isoInstantSchema.nullable().default(null),
  serverSeq: z.number().int().nonnegative().optional(),
});
export type SyncedRow = z.infer<typeof syncedRowSchema>;
