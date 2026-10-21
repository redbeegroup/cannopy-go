import type { Id } from '../ids/id.js';

export interface OpenDocument {
  documentId: Id;
  date: string;
  total: number;
  paidAmount: number;
}

export interface Allocation {
  documentId: Id;
  amount: number;
}

/**
 * Splits a payment across open documents, oldest first (scope doc: partial
 * payments allocate oldest document first by default; the owner can pick a
 * different one on the device, which then sends explicit allocations).
 * Whatever is left over is returned as `unallocated` and becomes an advance.
 */
export function allocateOldestFirst(
  amount: number,
  open: readonly OpenDocument[],
): { allocations: Allocation[]; unallocated: number } {
  const sorted = [...open]
    .filter((d) => d.total - d.paidAmount > 0)
    .sort((x, y) => x.date.localeCompare(y.date) || x.documentId.localeCompare(y.documentId));
  const allocations: Allocation[] = [];
  let left = amount;
  for (const d of sorted) {
    if (left <= 0) break;
    const take = Math.min(left, d.total - d.paidAmount);
    allocations.push({ documentId: d.documentId, amount: take });
    left -= take;
  }
  return { allocations, unallocated: left };
}
