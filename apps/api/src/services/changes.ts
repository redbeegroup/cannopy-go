import type { SyncEntity } from '@cannopy/core';
import { syncChanges } from '../db/schema/index.js';
import type { Tx } from './tx.js';

/**
 * Appends to the change log that devices pull. Every row the server derives
 * (journal entries, stock movements, recosted items, settled documents) goes
 * through here so a phone learns about it on its next pull.
 */
export async function recordChange(
  tx: Tx,
  businessId: string,
  entity: SyncEntity,
  entityId: string,
  op: 'upsert' | 'delete',
  data: Record<string, unknown>,
  mutationId: string | null = null,
): Promise<void> {
  await tx.insert(syncChanges).values({ businessId, entity, entityId, op, data, mutationId });
}
