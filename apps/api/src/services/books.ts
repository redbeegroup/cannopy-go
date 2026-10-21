import {
  type AccountType,
  type Business,
  isDebitNormal,
  SYSTEM_ACCOUNT_CODES,
  type SystemAccounts,
} from '@cannopy/core';
import { and, eq, isNull } from 'drizzle-orm';
import { accounts, businesses } from '../db/schema/index.js';
import { ApiError, notFound } from './errors.js';
import type { Tx } from './tx.js';

export interface AccountRef {
  id: string;
  code: string;
  type: AccountType;
  isSystem: boolean;
  moneyKind: 'cash' | 'bank' | 'wallet' | null;
}

/** The accounts of one business, indexed the way the posting rules need them. */
export interface Books {
  businessId: string;
  accountsById: Map<string, AccountRef>;
  systemAccounts: SystemAccounts;
}

export async function loadBooks(tx: Tx, businessId: string): Promise<Books> {
  const rows = await tx
    .select({
      id: accounts.id,
      code: accounts.code,
      type: accounts.type,
      isSystem: accounts.isSystem,
      moneyKind: accounts.moneyKind,
    })
    .from(accounts)
    .where(and(eq(accounts.businessId, businessId), isNull(accounts.deletedAt)));
  const accountsById = new Map(rows.map((r) => [r.id, r]));
  const byCode = new Map(rows.map((r) => [r.code, r.id]));
  const systemAccounts = {} as Record<string, string>;
  for (const code of Object.values(SYSTEM_ACCOUNT_CODES)) {
    const id = byCode.get(code);
    if (!id) {
      throw new ApiError(500, 'chart_incomplete', `Business ${businessId} has no account ${code}`);
    }
    systemAccounts[code] = id;
  }
  return { businessId, accountsById, systemAccounts: systemAccounts as SystemAccounts };
}

export async function loadBusiness(tx: Tx, businessId: string) {
  const [row] = await tx.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!row) throw notFound('Business', businessId);
  return row;
}

export function businessRowToCore(r: Awaited<ReturnType<typeof loadBusiness>>): Business {
  return {
    id: r.id,
    name: { en: r.nameEn, my: r.nameMy },
    type: r.type,
    primaryLanguage: r.primaryLanguage,
    accountingMode: r.accountingMode,
    fiscalYearStartMonth: r.fiscalYearStartMonth,
    currency: 'MMK',
    taxEnabled: r.taxEnabled,
    lockDate: r.lockDate,
    digitGrouping: r.digitGrouping === 'lakh' ? 'lakh' : 'thousand',
    myanmarDigits: r.myanmarDigits,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** Basis values a report reads for the given accounting mode. */
export function basesFor(mode: 'cash' | 'accrual'): ('accrual' | 'cash' | 'both')[] {
  return mode === 'cash' ? ['cash', 'both'] : ['accrual', 'both'];
}

export { isDebitNormal };
