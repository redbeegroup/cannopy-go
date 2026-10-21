import {
  type Account,
  type Contact,
  type Item,
  nextAccountCode,
  OWNER_GROUP_FOR_TYPE,
  TYPE_FOR_OWNER_GROUP,
} from '@cannopy/core';
import { and, eq, isNull } from 'drizzle-orm';
import { accounts, contacts, documents, items } from '../db/schema/index.js';
import { recordChange } from './changes.js';
import { ApiError, notFound } from './errors.js';
import { accountHasPostings } from './ledger.js';
import {
  accountToRow,
  contactToRow,
  itemToRow,
  rowToAccount,
  rowToContact,
  rowToItem,
} from './mappers.js';
import type { Tx } from './tx.js';

/**
 * Master data the owner edits: accounts (categories and money accounts),
 * contacts and items. Each write records a change for sync. Derived fields on
 * items (quantity, average cost, stock value) are never taken from the client.
 */

export async function listAccounts(tx: Tx, businessId: string): Promise<Account[]> {
  const rows = await tx
    .select()
    .from(accounts)
    .where(and(eq(accounts.businessId, businessId), isNull(accounts.deletedAt)))
    .orderBy(accounts.code);
  return rows.map(rowToAccount);
}

/**
 * Creates or updates an owner account. The owner picks a group and a name;
 * the type and the code follow. System accounts keep their code, type, group
 * and system flag; only the name, hidden flag, provider and default fee change.
 */
export async function upsertAccount(
  tx: Tx,
  businessId: string,
  input: Account,
  mutationId: string | null = null,
): Promise<Account> {
  if (input.businessId !== businessId)
    throw new ApiError(400, 'wrong_business', 'Account belongs to another business');
  const [existing] = await tx.select().from(accounts).where(eq(accounts.id, input.id)).limit(1);
  if (existing && existing.businessId !== businessId) throw notFound('Account', input.id);

  let next: Account;
  if (existing?.isSystem) {
    const current = rowToAccount(existing);
    next = {
      ...current,
      name: { en: input.name.en || current.name.en, my: input.name.my || current.name.my },
      isHidden: input.isHidden,
      provider: input.provider,
      defaultFee: input.defaultFee,
      updatedAt: input.updatedAt,
      deletedAt: null,
    };
  } else {
    const type = existing ? existing.type : TYPE_FOR_OWNER_GROUP[input.ownerGroup];
    const ownerGroup = input.ownerGroup ?? OWNER_GROUP_FOR_TYPE[type];
    if (ownerGroup === 'stock' || ownerGroup === 'owed_to_me') {
      throw new ApiError(
        422,
        'reserved_group',
        'Stock and amounts owed are kept by the app, not as owner accounts',
      );
    }
    let code = existing?.code ?? input.code;
    if (!existing) {
      const used = (await listAccounts(tx, businessId)).map((a) => a.code);
      if (!code || used.includes(code)) code = nextAccountCode(ownerGroup, used);
    }
    const moneyKind = ownerGroup === 'my_money' ? (input.moneyKind ?? 'bank') : null;
    next = {
      ...input,
      code,
      type,
      ownerGroup,
      isSystem: false,
      moneyKind,
      deletedAt: null,
    };
  }
  const row = accountToRow(next);
  const [saved] = await tx
    .insert(accounts)
    .values(row)
    .onConflictDoUpdate({ target: accounts.id, set: row })
    .returning();
  if (!saved) throw new ApiError(500, 'save_failed', 'Account was not saved');
  const out = rowToAccount(saved);
  await recordChange(tx, businessId, 'account', out.id, 'upsert', { ...out }, mutationId);
  return out;
}

export async function deleteAccount(
  tx: Tx,
  businessId: string,
  accountId: string,
  deletedAt: string,
  mutationId: string | null = null,
): Promise<void> {
  const [existing] = await tx.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
  if (!existing || existing.businessId !== businessId) throw notFound('Account', accountId);
  if (existing.isSystem)
    throw new ApiError(409, 'system_account', 'System accounts cannot be deleted');
  if (await accountHasPostings(tx, accountId)) {
    throw new ApiError(409, 'account_in_use', 'This account has transactions; hide it instead');
  }
  await tx
    .update(accounts)
    .set({ deletedAt: new Date(deletedAt), updatedAt: new Date(deletedAt) })
    .where(eq(accounts.id, accountId));
  await recordChange(tx, businessId, 'account', accountId, 'delete', {}, mutationId);
}

export async function listContacts(tx: Tx, businessId: string): Promise<Contact[]> {
  const rows = await tx
    .select()
    .from(contacts)
    .where(and(eq(contacts.businessId, businessId), isNull(contacts.deletedAt)))
    .orderBy(contacts.nameEn, contacts.nameMy);
  return rows.map(rowToContact);
}

export async function upsertContact(
  tx: Tx,
  businessId: string,
  input: Contact,
  mutationId: string | null = null,
): Promise<Contact> {
  if (input.businessId !== businessId)
    throw new ApiError(400, 'wrong_business', 'Contact belongs to another business');
  const [existing] = await tx
    .select({ businessId: contacts.businessId })
    .from(contacts)
    .where(eq(contacts.id, input.id))
    .limit(1);
  if (existing && existing.businessId !== businessId) throw notFound('Contact', input.id);
  const row = contactToRow({ ...input, deletedAt: null });
  const [saved] = await tx
    .insert(contacts)
    .values(row)
    .onConflictDoUpdate({ target: contacts.id, set: row })
    .returning();
  if (!saved) throw new ApiError(500, 'save_failed', 'Contact was not saved');
  const out = rowToContact(saved);
  await recordChange(tx, businessId, 'contact', out.id, 'upsert', { ...out }, mutationId);
  return out;
}

export async function deleteContact(
  tx: Tx,
  businessId: string,
  contactId: string,
  deletedAt: string,
  mutationId: string | null = null,
): Promise<void> {
  const [existing] = await tx.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
  if (!existing || existing.businessId !== businessId) throw notFound('Contact', contactId);
  const [used] = await tx
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.contactId, contactId), isNull(documents.deletedAt)))
    .limit(1);
  if (used)
    throw new ApiError(409, 'contact_in_use', 'This contact has documents; it cannot be deleted');
  await tx
    .update(contacts)
    .set({ deletedAt: new Date(deletedAt), updatedAt: new Date(deletedAt) })
    .where(eq(contacts.id, contactId));
  await recordChange(tx, businessId, 'contact', contactId, 'delete', {}, mutationId);
}

export async function listItems(tx: Tx, businessId: string): Promise<Item[]> {
  const rows = await tx
    .select()
    .from(items)
    .where(and(eq(items.businessId, businessId), isNull(items.deletedAt)))
    .orderBy(items.nameEn, items.nameMy);
  return rows.map(rowToItem);
}

export async function upsertItem(
  tx: Tx,
  businessId: string,
  input: Item,
  mutationId: string | null = null,
): Promise<Item> {
  if (input.businessId !== businessId)
    throw new ApiError(400, 'wrong_business', 'Item belongs to another business');
  const [existing] = await tx.select().from(items).where(eq(items.id, input.id)).limit(1);
  if (existing && existing.businessId !== businessId) throw notFound('Item', input.id);
  if (existing && existing.type !== input.type && existing.quantityOnHandMilli !== 0) {
    throw new ApiError(
      409,
      'item_has_stock',
      'Adjust the stock to zero before changing how the item is tracked',
    );
  }
  const row = itemToRow({ ...input, deletedAt: null });
  const [saved] = await tx
    .insert(items)
    .values(row)
    .onConflictDoUpdate({ target: items.id, set: row })
    .returning();
  if (!saved) throw new ApiError(500, 'save_failed', 'Item was not saved');
  const out = rowToItem(saved);
  await recordChange(tx, businessId, 'item', out.id, 'upsert', { ...out }, mutationId);
  return out;
}

export async function deleteItem(
  tx: Tx,
  businessId: string,
  itemId: string,
  deletedAt: string,
  mutationId: string | null = null,
): Promise<void> {
  const [existing] = await tx.select().from(items).where(eq(items.id, itemId)).limit(1);
  if (!existing || existing.businessId !== businessId) throw notFound('Item', itemId);
  if (existing.quantityOnHandMilli !== 0) {
    throw new ApiError(409, 'item_has_stock', 'Adjust the stock to zero before deleting the item');
  }
  await tx
    .update(items)
    .set({ deletedAt: new Date(deletedAt), updatedAt: new Date(deletedAt) })
    .where(eq(items.id, itemId));
  await recordChange(tx, businessId, 'item', itemId, 'delete', {}, mutationId);
}
