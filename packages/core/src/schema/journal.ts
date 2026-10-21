import { z } from 'zod';
import { idSchema } from '../ids/id.js';
import { isoDateSchema, isoInstantSchema, kyatSchema, syncedRowSchema } from './common.js';

/**
 * accrual: posted on the document date only.
 * cash: posted when money moves only.
 * both: identical in both modes, stored once.
 */
export const journalBasisSchema = z.enum(['accrual', 'cash', 'both']);
export type JournalBasis = z.infer<typeof journalBasisSchema>;

export const journalLineSchema = z.object({
  accountId: idSchema,
  debit: kyatSchema.default(0),
  credit: kyatSchema.default(0),
  contactId: idSchema.nullable().default(null),
  itemId: idSchema.nullable().default(null),
});
export type JournalLine = z.infer<typeof journalLineSchema>;

export const journalEntrySchema = syncedRowSchema
  .extend({
    documentId: idSchema,
    date: isoDateSchema,
    basis: journalBasisSchema,
    lines: z.array(journalLineSchema).min(2),
  })
  .refine(
    (e) => e.lines.reduce((s, l) => s + l.debit, 0) === e.lines.reduce((s, l) => s + l.credit, 0),
    { message: 'Journal entry must balance: debits equal credits' },
  );
export type JournalEntry = z.infer<typeof journalEntrySchema>;

export const auditLogSchema = z.object({
  id: idSchema,
  businessId: idSchema,
  userId: idSchema,
  at: isoInstantSchema,
  entity: z.string().max(40),
  entityId: idSchema,
  action: z.enum(['create', 'update', 'delete', 'mode_switch']),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
});
export type AuditLog = z.infer<typeof auditLogSchema>;
