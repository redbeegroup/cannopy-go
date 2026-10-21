import { z } from 'zod';
import { bilingualSchema } from '../i18n/label.js';
import { syncedRowSchema } from './common.js';

/** Standard accounting type, never shown to the owner. */
export const accountTypeSchema = z.enum([
  'asset',
  'liability',
  'equity',
  'income',
  'cost_of_sales',
  'expense',
]);
export type AccountType = z.infer<typeof accountTypeSchema>;

/** The plain-language group the owner sees. */
export const ownerGroupSchema = z.enum([
  'my_money',
  'owed_to_me',
  'stock',
  'things_i_own',
  'i_owe',
  'owner',
  'money_in',
  'money_out',
]);
export type OwnerGroup = z.infer<typeof ownerGroupSchema>;

export const moneyAccountKindSchema = z.enum(['cash', 'bank', 'wallet']);

export const accountSchema = syncedRowSchema.extend({
  /** Internal code such as 1000. Unique per business. */
  code: z.string().regex(/^\d{4}$/),
  type: accountTypeSchema,
  ownerGroup: ownerGroupSchema,
  name: bilingualSchema,
  /** System accounts are created for every business and cannot be deleted or renamed. */
  isSystem: z.boolean().default(false),
  isHidden: z.boolean().default(false),
  /** Set only for money accounts (cash drawer, bank, mobile wallet). */
  moneyKind: moneyAccountKindSchema.nullable().default(null),
  /** Wallet or bank provider name, e.g. KBZPay. */
  provider: z.string().trim().max(60).nullable().default(null),
  /** Default cash-out fee for wallets, in whole kyat. */
  defaultFee: z.number().int().min(0).nullable().default(null),
});
export type Account = z.infer<typeof accountSchema>;
