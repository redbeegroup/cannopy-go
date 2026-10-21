import { describe, expect, it } from 'vitest';
import { newId } from '../ids/id.js';
import { type CostingInput, recost, sortMovements } from './costing.js';

const mv = (date: string, quantityMilli: number, value = 0): CostingInput => ({
  id: newId(),
  documentId: newId(),
  lineId: newId(),
  date,
  quantityMilli,
  value,
});

describe('weighted average costing', () => {
  it('recomputes average cost on every purchase and not on a sale', () => {
    const r = recost([
      mv('2026-10-01', 10_000, 8000),
      mv('2026-10-02', -4000),
      mv('2026-10-03', 10_000, 12_000),
    ]);
    expect(r.movements[0]?.unitCost).toBe(800);
    expect(r.movements[1]?.value).toBe(-3200);
    expect(r.movements[1]?.unitCost).toBe(800);
    // (6 x 800 + 12 000) / 16 = 1050
    expect(r.state).toEqual({
      quantityMilli: 16_000,
      stockValue: 16_800,
      averageCost: 1050,
      lastCost: 1200,
    });
    expect(r.warnings).toEqual([]);
  });

  it('brings the stock value to exactly zero when the last unit goes out', () => {
    const r = recost([
      mv('2026-10-01', 3000, 1000),
      mv('2026-10-02', -1000),
      mv('2026-10-03', -1000),
      mv('2026-10-04', -1000),
    ]);
    expect(r.movements.slice(1).map((m) => m.value)).toEqual([-333, -334, -333]);
    expect(r.state.quantityMilli).toBe(0);
    expect(r.state.stockValue).toBe(0);
  });

  it('allows negative stock at the last known average cost, with a warning', () => {
    const r = recost([
      mv('2026-10-01', 1000, 600),
      mv('2026-10-02', -3000),
      mv('2026-10-03', 4000, 2600),
    ]);
    expect(r.movements[1]?.value).toBe(-1800);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]?.code).toBe('negative_stock');
    // The late purchase absorbs the difference: (-1200 + 2600) / 2 units = 700
    expect(r.state).toEqual({
      quantityMilli: 2000,
      stockValue: 1400,
      averageCost: 700,
      lastCost: 650,
    });
  });

  it('sorts a late purchase before the sales it supplied', () => {
    const sale = mv('2026-10-05', -1000);
    const late = mv('2026-10-02', 2000, 2000);
    const sorted = sortMovements([sale, late]);
    expect(sorted[0]).toBe(late);
    const r = recost(sorted);
    expect(r.movements[1]?.value).toBe(-1000);
    expect(r.warnings).toEqual([]);
  });
});
