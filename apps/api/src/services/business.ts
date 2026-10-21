import {
  type Account,
  type AccountingMode,
  type Business,
  newId,
  standardChart,
} from '@cannopy/core';
import { eq } from 'drizzle-orm';
import { accounts, auditLog, businesses } from '../db/schema/index.js';
import { businessRowToCore, loadBusiness } from './books.js';
import { recordChange } from './changes.js';
import { accountToRow, rowToAccount } from './mappers.js';
import { addMembership } from './members.js';
import type { Tx } from './tx.js';

export interface CreateBusinessInput {
  business: Business;
  /** The signed-in user, who becomes the owner. */
  ownerUserId: string;
}

export interface CreateBusinessResult {
  business: Business;
  role: 'owner';
  accounts: Account[];
}

/** Creates the business, makes the caller its owner and seeds the standard chart, in one transaction. */
export async function createBusiness(
  tx: Tx,
  input: CreateBusinessInput,
): Promise<CreateBusinessResult> {
  const { business, ownerUserId } = input;
  await tx.insert(businesses).values({
    id: business.id,
    nameEn: business.name.en,
    nameMy: business.name.my,
    type: business.type,
    primaryLanguage: business.primaryLanguage,
    accountingMode: business.accountingMode,
    fiscalYearStartMonth: business.fiscalYearStartMonth,
    currency: business.currency,
    taxEnabled: business.taxEnabled,
    lockDate: business.lockDate,
    digitGrouping: business.digitGrouping,
    myanmarDigits: business.myanmarDigits,
    createdAt: new Date(business.createdAt),
    updatedAt: new Date(business.updatedAt),
  });
  await addMembership(tx, business.id, ownerUserId, 'owner', null, new Date(business.createdAt));
  const chart = standardChart(business.id, business.createdAt);
  const rows = await tx.insert(accounts).values(chart.map(accountToRow)).returning();
  const saved = rows.map(rowToAccount);
  for (const a of saved) await recordChange(tx, business.id, 'account', a.id, 'upsert', { ...a });
  return { business, role: 'owner', accounts: saved };
}

/** The mode switch only changes which journal reports read; it is logged with the date and user. */
export async function setAccountingMode(
  tx: Tx,
  businessId: string,
  userId: string,
  mode: AccountingMode,
  at: string,
): Promise<Business> {
  const before = await loadBusiness(tx, businessId);
  if (before.accountingMode === mode) return businessRowToCore(before);
  const [after] = await tx
    .update(businesses)
    .set({ accountingMode: mode, updatedAt: new Date(at) })
    .where(eq(businesses.id, businessId))
    .returning();
  if (!after) throw new Error('Business vanished during update');
  await tx.insert(auditLog).values({
    id: newId(),
    businessId,
    userId,
    at: new Date(at),
    entity: 'business',
    entityId: businessId,
    action: 'mode_switch',
    before: { accountingMode: before.accountingMode },
    after: { accountingMode: mode },
  });
  return businessRowToCore(after);
}
