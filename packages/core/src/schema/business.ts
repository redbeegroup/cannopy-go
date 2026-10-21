import { z } from 'zod';
import { bilingualSchema, languageSchema } from '../i18n/label.js';
import { idSchema } from '../ids/id.js';
import { isoDateSchema, isoInstantSchema } from './common.js';

export const accountingModeSchema = z.enum(['cash', 'accrual']);
export type AccountingMode = z.infer<typeof accountingModeSchema>;

export const businessTypeSchema = z.enum([
  'shop',
  'food_and_drink',
  'trader',
  'service',
  'online_seller',
  'other',
]);

export const businessSchema = z.object({
  id: idSchema,
  name: bilingualSchema,
  type: businessTypeSchema,
  primaryLanguage: languageSchema,
  accountingMode: accountingModeSchema.default('cash'),
  /** 1 to 12; default April for the Myanmar government fiscal year. */
  fiscalYearStartMonth: z.number().int().min(1).max(12).default(4),
  currency: z.literal('MMK').default('MMK'),
  taxEnabled: z.boolean().default(false),
  /** Documents dated on or before this date ask for confirmation before edits. */
  lockDate: isoDateSchema.nullable().default(null),
  digitGrouping: z.enum(['thousand', 'lakh']).default('thousand'),
  myanmarDigits: z.boolean().default(false),
  createdAt: isoInstantSchema,
  updatedAt: isoInstantSchema,
});
export type Business = z.infer<typeof businessSchema>;

export const userRoleSchema = z.enum(['owner', 'cashier']);

export const userSchema = z.object({
  id: idSchema,
  businessId: idSchema,
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(32).nullable().default(null),
  email: z.string().trim().email().nullable().default(null),
  role: userRoleSchema.default('owner'),
  language: languageSchema,
  createdAt: isoInstantSchema,
  updatedAt: isoInstantSchema,
});
export type User = z.infer<typeof userSchema>;
