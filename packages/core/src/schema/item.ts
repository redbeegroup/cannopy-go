import { z } from 'zod';
import { bilingualSchema } from '../i18n/label.js';
import { kyatSchema, syncedRowSchema } from './common.js';

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
  lowStockLevelMilli: z.number().int().min(0).nullable().default(null),
  barcode: z.string().trim().max(64).nullable().default(null),
  photoUrl: z.string().trim().max(500).nullable().default(null),
  /** Reserved for multi-location and lot tracking in a later version. */
  locationId: z.string().nullable().default(null),
  lotRef: z.string().nullable().default(null),
});
export type Item = z.infer<typeof itemSchema>;

export const stockMovementSchema = syncedRowSchema.extend({
  itemId: z.string(),
  date: z.string(),
  /** Signed quantity in thousandths of a unit. */
  quantityMilli: z.number().int(),
  /** Cost per whole unit in kyat at the time of the movement. */
  unitCost: kyatSchema,
  documentId: z.string(),
});
export type StockMovement = z.infer<typeof stockMovementSchema>;
