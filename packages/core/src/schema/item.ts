import { z } from 'zod';
import { bilingualSchema } from '../i18n/label.js';
import { idSchema } from '../ids/id.js';
import { isoDateSchema, kyatSchema, signedKyatSchema, syncedRowSchema } from './common.js';

export const itemTypeSchema = z.enum(['stocked', 'not_tracked', 'service']);
export type ItemType = z.infer<typeof itemTypeSchema>;

export const itemSchema = syncedRowSchema.extend({
  name: bilingualSchema,
  type: itemTypeSchema.default('stocked'),
  /** Piece, kg, viss, bag, bottle, dozen or an owner-typed unit. */
  unit: bilingualSchema.default({ en: 'piece', my: 'ခု' }),
  sellingPrice: kyatSchema.nullable().default(null),
  /** Cached from stock movements; recomputed by the costing engine, never typed. */
  averageCost: kyatSchema.default(0),
  lastCost: kyatSchema.nullable().default(null),
  /** Quantity in thousandths of a unit so 1.5 kg is 1500. Integer avoids float drift. */
  quantityOnHandMilli: z.number().int().default(0),
  /**
   * Value of the stock on hand in whole kyat, cached from stock movements. This
   * is what the Stock on hand account holds for the item; averageCost is
   * stockValue divided by quantity, rounded, so the two can differ by rounding.
   */
  stockValue: signedKyatSchema.default(0),
  lowStockLevelMilli: z.number().int().min(0).nullable().default(null),
  barcode: z.string().trim().max(64).nullable().default(null),
  photoUrl: z.string().trim().max(500).nullable().default(null),
  /** Reserved for multi-location and lot tracking in a later version. */
  locationId: z.string().nullable().default(null),
  lotRef: z.string().nullable().default(null),
});
export type Item = z.infer<typeof itemSchema>;

/**
 * One line of stock in or out, derived from a document by the posting rules.
 * Inbound movements (purchase, positive adjustment, opening stock) carry the
 * cost the owner typed. Outbound movements (sale, negative adjustment) are
 * valued by the costing engine at the weighted average cost at that point.
 */
export const stockMovementSchema = syncedRowSchema.extend({
  itemId: idSchema,
  documentId: idSchema,
  /** The document line this movement came from. */
  lineId: idSchema.nullable().default(null),
  date: isoDateSchema,
  /** Signed quantity in thousandths of a unit. */
  quantityMilli: z.number().int(),
  /** Cost per whole unit in kyat at the time of the movement, for display. */
  unitCost: kyatSchema,
  /** Signed value in whole kyat: what the Stock on hand account moves by. */
  value: signedKyatSchema,
});
export type StockMovement = z.infer<typeof stockMovementSchema>;
