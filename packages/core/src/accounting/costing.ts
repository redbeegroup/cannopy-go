import type { Id } from '../ids/id.js';
import { divRound, mulDivRound } from './arith.js';

/**
 * Weighted average cost engine. Runs the stock movements of one item in order
 * and values every outbound movement at the average cost at that point.
 *
 * Rules (scope doc, Inventory):
 *  - average cost = value on hand / quantity on hand, recomputed on every
 *    inbound movement; a sale never changes it
 *  - an outbound movement takes its share of the value on hand, so the stock
 *    value reaches exactly zero when the quantity does
 *  - negative stock is allowed: once quantity on hand is zero or below, an
 *    outbound movement is valued at the last known average cost and the item
 *    gets a warning; the next purchase absorbs the difference in its value
 *  - a late purchase (dated before sales already recorded) simply sorts before
 *    them, so rerunning the engine recomputes those sales' cost of goods sold
 */

export interface CostingInput {
  id: Id;
  documentId: Id;
  lineId: Id | null;
  date: string;
  quantityMilli: number;
  /** Required for inbound movements (quantity > 0): the cost paid, in whole kyat. */
  value: number;
}

export interface CostedMovement extends CostingInput {
  /** Kyat per whole unit, for display. */
  unitCost: number;
}

export interface CostingState {
  quantityMilli: number;
  /** Whole kyat held in the Stock on hand account for this item. */
  stockValue: number;
  /** Kyat per whole unit; carried over while the quantity is zero or negative. */
  averageCost: number;
  /** Unit cost of the most recent inbound movement, or null when there was none. */
  lastCost: number | null;
}

export interface CostingWarning {
  code: 'negative_stock';
  movementId: Id;
  documentId: Id;
  date: string;
  quantityMilli: number;
}

export interface CostingResult {
  movements: CostedMovement[];
  state: CostingState;
  warnings: CostingWarning[];
}

/** Sort movements by date, then by document id (UUID v7 is time ordered), then by id. */
export function sortMovements<T extends CostingInput>(movements: readonly T[]): T[] {
  return [...movements].sort(
    (x, y) =>
      x.date.localeCompare(y.date) ||
      x.documentId.localeCompare(y.documentId) ||
      x.id.localeCompare(y.id),
  );
}

export const EMPTY_COSTING_STATE: CostingState = {
  quantityMilli: 0,
  stockValue: 0,
  averageCost: 0,
  lastCost: null,
};

/** Average cost per whole unit from a value and a quantity in thousandths. */
export function averageCostOf(stockValue: number, quantityMilli: number, fallback: number): number {
  if (quantityMilli <= 0) return fallback;
  return Math.max(0, mulDivRound(stockValue, 1000, quantityMilli));
}

/**
 * Runs the movements in order and returns them valued, plus the final state.
 * The input order is kept; call sortMovements first when it is not sorted.
 */
export function recost(
  movements: readonly CostingInput[],
  initial: CostingState = EMPTY_COSTING_STATE,
): CostingResult {
  let { quantityMilli, stockValue, averageCost, lastCost } = initial;
  const warnings: CostingWarning[] = [];
  const out: CostedMovement[] = [];

  for (const m of movements) {
    if (m.quantityMilli === 0) {
      out.push({ ...m, value: 0, unitCost: averageCost });
      continue;
    }
    if (m.quantityMilli > 0) {
      const unitCost = mulDivRound(m.value, 1000, m.quantityMilli);
      quantityMilli += m.quantityMilli;
      stockValue += m.value;
      lastCost = unitCost;
      averageCost =
        quantityMilli > 0 ? averageCostOf(stockValue, quantityMilli, unitCost) : unitCost;
      out.push({ ...m, unitCost });
      continue;
    }

    const qtyOut = -m.quantityMilli;
    let cost: number;
    if (quantityMilli <= 0) {
      cost = mulDivRound(qtyOut, averageCost, 1000);
      warnings.push(warning(m));
    } else if (qtyOut >= quantityMilli) {
      // Everything on hand goes out at its exact value; the excess at average cost.
      const excess = qtyOut - quantityMilli;
      cost = stockValue + mulDivRound(excess, averageCost, 1000);
      if (excess > 0) warnings.push(warning(m));
    } else {
      cost = mulDivRound(qtyOut, stockValue, quantityMilli);
    }
    quantityMilli -= qtyOut;
    stockValue -= cost;
    out.push({ ...m, value: -cost, unitCost: qtyOut > 0 ? divRound(cost * 1000, qtyOut) : 0 });
  }

  return { movements: out, state: { quantityMilli, stockValue, averageCost, lastCost }, warnings };
}

function warning(m: CostingInput): CostingWarning {
  return {
    code: 'negative_stock',
    movementId: m.id,
    documentId: m.documentId,
    date: m.date,
    quantityMilli: m.quantityMilli,
  };
}
