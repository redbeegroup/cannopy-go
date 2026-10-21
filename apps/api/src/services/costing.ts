import { type CostingInput, recost, sortMovements } from '@cannopy/core';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { items, stockMovements } from '../db/schema/index.js';
import { recordChange } from './changes.js';
import { rowToItem, rowToStockMovement } from './mappers.js';
import type { Tx } from './tx.js';

export interface RecostResult {
  /** Documents whose outbound movements changed value and therefore need reposting. */
  changedDocumentIds: Set<string>;
  warnings: { itemId: string; documentId: string; date: string; quantityMilli: number }[];
}

/**
 * Reruns the weighted average engine over every movement of the given items,
 * writes the resulting values back, refreshes the item caches and reports
 * which documents now carry a different cost of goods sold.
 */
export async function recostItems(
  tx: Tx,
  businessId: string,
  itemIds: Iterable<string>,
): Promise<RecostResult> {
  const ids = [...new Set(itemIds)];
  const result: RecostResult = { changedDocumentIds: new Set(), warnings: [] };
  if (ids.length === 0) return result;

  const rows = await tx
    .select()
    .from(stockMovements)
    .where(
      and(
        eq(stockMovements.businessId, businessId),
        inArray(stockMovements.itemId, ids),
        isNull(stockMovements.deletedAt),
      ),
    );

  for (const itemId of ids) {
    const mine = rows.filter((r) => r.itemId === itemId);
    const inputs: CostingInput[] = mine.map((r) => ({
      id: r.id,
      documentId: r.documentId,
      lineId: r.lineId,
      date: r.date,
      quantityMilli: r.quantityMilli,
      value: r.quantityMilli > 0 ? r.value : 0,
    }));
    const { movements, state, warnings } = recost(sortMovements(inputs));
    const before = new Map(mine.map((r) => [r.id, r]));
    for (const m of movements) {
      const old = before.get(m.id);
      if (!old) continue;
      if (old.value === m.value && old.unitCost === m.unitCost) continue;
      if (m.quantityMilli < 0) result.changedDocumentIds.add(m.documentId);
      const [updated] = await tx
        .update(stockMovements)
        .set({ value: m.value, unitCost: m.unitCost })
        .where(eq(stockMovements.id, m.id))
        .returning();
      if (updated) {
        await recordChange(tx, businessId, 'stock_movement', m.id, 'upsert', {
          ...rowToStockMovement(updated),
        });
      }
    }
    const [item] = await tx
      .update(items)
      .set({
        quantityOnHandMilli: state.quantityMilli,
        stockValue: state.stockValue,
        averageCost: state.averageCost,
        lastCost: state.lastCost,
      })
      .where(eq(items.id, itemId))
      .returning();
    if (item) await recordChange(tx, businessId, 'item', itemId, 'upsert', { ...rowToItem(item) });
    for (const w of warnings) {
      result.warnings.push({
        itemId,
        documentId: w.documentId,
        date: w.date,
        quantityMilli: w.quantityMilli,
      });
    }
  }
  return result;
}
