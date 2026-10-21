import { describe, expect, it } from 'vitest';
import { newId } from '../ids/id.js';
import { journalEntrySchema } from './journal.js';

const base = {
  id: newId(),
  businessId: newId(),
  documentId: newId(),
  date: '2026-10-21',
  createdAt: '2026-10-21T03:00:00Z',
  updatedAt: '2026-10-21T03:00:00Z',
};

describe('journal entry schema', () => {
  it('accepts a balanced cash sale', () => {
    const entry = journalEntrySchema.parse({
      ...base,
      basis: 'both',
      lines: [
        { accountId: newId(), debit: 10_000 },
        { accountId: newId(), credit: 10_000 },
      ],
    });
    expect(entry.basis).toBe('both');
  });

  it('rejects an unbalanced entry', () => {
    const result = journalEntrySchema.safeParse({
      ...base,
      basis: 'accrual',
      lines: [
        { accountId: newId(), debit: 10_000 },
        { accountId: newId(), credit: 9_000 },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects fractional kyat', () => {
    const result = journalEntrySchema.safeParse({
      ...base,
      basis: 'cash',
      lines: [
        { accountId: newId(), debit: 10.5 },
        { accountId: newId(), credit: 10.5 },
      ],
    });
    expect(result.success).toBe(false);
  });
});
