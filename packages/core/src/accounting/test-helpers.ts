import { newId } from '../ids/id.js';
import type { Document, DocumentLine } from '../schema/document.js';
import type { ItemType } from '../schema/item.js';
import type { JournalLine } from '../schema/journal.js';
import { SYSTEM_ACCOUNT_CODES, type SystemAccountCode, standardChart } from './chart.js';
import {
  type AllocationTarget,
  type PostedEntry,
  type PostingContext,
  type SystemAccounts,
} from './posting.js';

/** An in-memory business for posting rule tests: standard chart, a few items, no database. */
export class TestBooks {
  readonly businessId = newId();
  readonly userId = newId();
  readonly now = '2026-10-21T03:00:00Z';
  readonly accounts = standardChart(this.businessId, this.now);
  readonly systemAccounts: SystemAccounts;
  readonly items = new Map<string, ItemType>();
  readonly lineCosts = new Map<string, number>();
  readonly targets = new Map<string, AllocationTarget>();

  constructor() {
    const byCode = new Map(this.accounts.map((a) => [a.code, a.id]));
    this.systemAccounts = Object.fromEntries(
      Object.values(SYSTEM_ACCOUNT_CODES).map((code) => [code, byCode.get(code) as string]),
    ) as SystemAccounts;
  }

  id(code: SystemAccountCode | string): string {
    const found = this.accounts.find((a) => a.code === code);
    if (!found) throw new Error(`No account ${code}`);
    return found.id;
  }

  item(type: ItemType = 'stocked'): string {
    const id = newId();
    this.items.set(id, type);
    return id;
  }

  get ctx(): PostingContext {
    return {
      systemAccounts: this.systemAccounts,
      accountType: (id) => this.accounts.find((a) => a.id === id)?.type,
      itemType: (id) => this.items.get(id),
      lineCost: (lineId) => this.lineCosts.get(lineId),
      allocationTarget: (id) => this.targets.get(id),
    };
  }

  line(partial: Partial<DocumentLine> & { amount: number }): DocumentLine {
    return {
      id: newId(),
      itemId: null,
      accountId: null,
      description: '',
      quantityMilli: 1000,
      unitPrice: 0,
      taxAmount: 0,
      ...partial,
    };
  }

  doc(partial: Partial<Document> & { type: Document['type']; total: number }): Document {
    return {
      id: newId(),
      businessId: this.businessId,
      createdAt: this.now,
      updatedAt: this.now,
      deletedAt: null,
      date: '2026-10-21',
      contactId: null,
      moneyAccountId: null,
      toMoneyAccountId: null,
      lines: [],
      allocations: [],
      feeAmount: 0,
      paidAmount: 0,
      status: 'open',
      note: '',
      attachmentUrl: null,
      createdByUserId: this.userId,
      deviceId: 'test',
      ...partial,
    };
  }

  /** Registers a document on credit as something payments can settle. */
  target(
    doc: Document,
    entries: PostedEntry[],
    kind: 'receivable' | 'payable',
    paidBefore = 0,
  ): void {
    this.targets.set(doc.id, {
      documentId: doc.id,
      type: doc.type,
      kind,
      total: doc.total,
      paidBefore,
      accrualLines: entries.filter((e) => e.basis === 'accrual').flatMap((e) => e.lines),
    });
  }
}

/** Net movement of an account across entries of the given bases. */
export function balance(
  entries: readonly PostedEntry[],
  accountId: string,
  bases: readonly string[],
): number {
  let debit = 0;
  let credit = 0;
  for (const e of entries) {
    if (!bases.includes(e.basis)) continue;
    for (const l of e.lines) {
      if (l.accountId !== accountId) continue;
      debit += l.debit;
      credit += l.credit;
    }
  }
  return debit - credit;
}

export const ACCRUAL = ['accrual', 'both'] as const;
export const CASH = ['cash', 'both'] as const;

export function findLine(entry: PostedEntry, accountId: string): JournalLine | undefined {
  return entry.lines.find((l) => l.accountId === accountId);
}
