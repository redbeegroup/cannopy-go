import { z } from 'zod';
import { bilingualSchema } from '../i18n/label.js';
import { kyatSchema, syncedRowSchema } from './common.js';

/** One entity for customers and suppliers: a trader buys from and sells to the same people. */
export const contactSchema = syncedRowSchema.extend({
  name: bilingualSchema,
  phone: z.string().trim().max(32).nullable().default(null),
  isCustomer: z.boolean().default(true),
  isSupplier: z.boolean().default(false),
  creditLimit: kyatSchema.nullable().default(null),
  note: z.string().trim().max(1000).default(''),
});
export type Contact = z.infer<typeof contactSchema>;
