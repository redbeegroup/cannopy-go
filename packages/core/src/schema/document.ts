import { z } from 'zod';
import { idSchema } from '../ids/id.js';
import { isoDateSchema, kyatSchema, syncedRowSchema } from './common.js';

/** What the owner creates. Journal entries are derived from these, never typed. */
export const documentTypeSchema = z.enum([
  'sale',
  'purchase',
  'expense',
  'payment_in',
  'payment_out',
  'owner_in',
  'owner_out',
  'transfer',
  'stock_adjustment',
  'opening_balance',
]);
export type DocumentType = z.infer<typeof documentTypeSchema>;

export const documentStatusSchema = z.enum(['open', 'partly_paid', 'paid', 'void']);

export const documentLineSchema = z.object({
  id: idSchema,
  /** Either an item (sale, purchase, stock adjustment) or an account (expense, transfer). */
  itemId: idSchema.nullable().default(null),
  accountId: idSchema.nullable().default(null),
  description: z.string().trim().max(300).default(''),
  quantityMilli: z.number().int().default(1000),
  unitPrice: kyatSchema.default(0),
  amount: kyatSchema,
  taxAmount: kyatSchema.default(0),
});
export type DocumentLine = z.infer<typeof documentLineSchema>;

/** A payment is split across the open documents it settles. */
export const allocationSchema = z.object({
  documentId: idSchema,
  amount: kyatSchema,
});

export const documentSchema = syncedRowSchema.extend({
  type: documentTypeSchema,
  date: isoDateSchema,
  /** Human-facing running number per business and type, assigned on the server. */
  number: z.number().int().positive().optional(),
  contactId: idSchema.nullable().default(null),
  /** Money account paid from or into; null for a credit sale or unpaid bill. */
  moneyAccountId: idSchema.nullable().default(null),
  /** Second money account for transfers. */
  toMoneyAccountId: idSchema.nullable().default(null),
  lines: z.array(documentLineSchema).default([]),
  allocations: z.array(allocationSchema).default([]),
  total: kyatSchema,
  feeAmount: kyatSchema.default(0),
  status: documentStatusSchema.default('open'),
  note: z.string().trim().max(1000).default(''),
  attachmentUrl: z.string().trim().max(500).nullable().default(null),
  /** Set by the device that created it, so an offline sale carries its origin. */
  createdByUserId: idSchema,
  deviceId: z.string().max(64),
});
export type Document = z.infer<typeof documentSchema>;
