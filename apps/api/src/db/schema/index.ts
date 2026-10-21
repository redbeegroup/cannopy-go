import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/*
 * Database schema for Cannopy GO. Mirrors the entity schemas in @cannopy/core.
 * Conventions (see docs/architecture.md):
 *  - every tenant-owned row carries business_id; the API filters on it for every query
 *  - money is bigint whole kyat; quantities are integer thousandths of a unit
 *  - bilingual names are two columns, name_en and name_my
 *  - ids are UUID v7 created on the device, so the server never allocates ids
 *  - soft delete via deleted_at so deletions reach offline devices through sync
 */

export const languageEnum = pgEnum('language', ['en', 'my']);
export const accountingModeEnum = pgEnum('accounting_mode', ['cash', 'accrual']);
export const businessTypeEnum = pgEnum('business_type', [
  'shop',
  'food_and_drink',
  'trader',
  'service',
  'online_seller',
  'other',
]);
export const memberRoleEnum = pgEnum('member_role', ['owner', 'member']);
export const inviteStatusEnum = pgEnum('invite_status', ['pending', 'accepted', 'revoked']);
export const accountTypeEnum = pgEnum('account_type', [
  'asset',
  'liability',
  'equity',
  'income',
  'cost_of_sales',
  'expense',
]);
export const ownerGroupEnum = pgEnum('owner_group', [
  'my_money',
  'owed_to_me',
  'stock',
  'things_i_own',
  'i_owe',
  'owner',
  'money_in',
  'money_out',
]);
export const moneyKindEnum = pgEnum('money_kind', ['cash', 'bank', 'wallet']);
export const itemTypeEnum = pgEnum('item_type', ['stocked', 'not_tracked', 'service']);
export const documentTypeEnum = pgEnum('document_type', [
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
export const documentStatusEnum = pgEnum('document_status', [
  'open',
  'partly_paid',
  'paid',
  'void',
]);
export const journalBasisEnum = pgEnum('journal_basis', ['accrual', 'cash', 'both']);
export const syncEntityEnum = pgEnum('sync_entity', [
  'account',
  'contact',
  'item',
  'document',
  'stock_movement',
  'journal_entry',
]);
export const syncOpEnum = pgEnum('sync_op', ['upsert', 'delete']);
export const auditActionEnum = pgEnum('audit_action', [
  'create',
  'update',
  'delete',
  'mode_switch',
]);

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

const synced = {
  ...timestamps,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  serverSeq: bigint('server_seq', { mode: 'number' }),
};

export const businesses = pgTable('businesses', {
  id: uuid('id').primaryKey(),
  nameEn: text('name_en').notNull().default(''),
  nameMy: text('name_my').notNull().default(''),
  type: businessTypeEnum('type').notNull().default('other'),
  primaryLanguage: languageEnum('primary_language').notNull().default('my'),
  accountingMode: accountingModeEnum('accounting_mode').notNull().default('cash'),
  fiscalYearStartMonth: smallint('fiscal_year_start_month').notNull().default(4),
  currency: text('currency').notNull().default('MMK'),
  taxEnabled: boolean('tax_enabled').notNull().default(false),
  lockDate: date('lock_date'),
  digitGrouping: text('digit_grouping').notNull().default('thousand'),
  myanmarDigits: boolean('myanmar_digits').notNull().default(false),
  ...timestamps,
});

/**
 * A person who signs in. The phone number is the identity (E.164). Which
 * businesses they can open is in memberships, so one owner can run two shops
 * and one shop can have two people.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),
    phone: text('phone').notNull(),
    name: text('name').notNull().default(''),
    email: text('email'),
    language: languageEnum('language').notNull().default('my'),
    lastSignInAt: timestamp('last_sign_in_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('users_phone_unique').on(t.phone),
    uniqueIndex('users_email_unique').on(t.email).where(sql`email is not null`),
  ],
);

export const memberships = pgTable(
  'memberships',
  {
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    role: memberRoleEnum('role').notNull().default('member'),
    invitedByUserId: uuid('invited_by_user_id').references(() => users.id),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.businessId, t.userId] }),
    index('memberships_user_idx').on(t.userId),
  ],
);

/** One-time sign-in codes. Only an HMAC of the code is stored. */
export const authCodes = pgTable(
  'auth_codes',
  {
    id: uuid('id').primaryKey(),
    phone: text('phone').notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: smallint('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('auth_codes_phone_idx').on(t.phone, t.createdAt)],
);

/**
 * Device sessions. The token itself is only ever on the device; the row keeps
 * an HMAC of it so a database leak does not hand out sessions. Long-lived,
 * because the app must open and record offline; revoking the row signs the
 * device out at its next sync.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    tokenHash: text('token_hash').notNull(),
    deviceId: text('device_id').notNull(),
    deviceName: text('device_name').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_unique').on(t.tokenHash),
    index('sessions_user_idx').on(t.userId),
  ],
);

/** An invitation to join a business, addressed to a phone number. */
export const invites = pgTable(
  'invites',
  {
    id: uuid('id').primaryKey(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id),
    phone: text('phone').notNull(),
    name: text('name').notNull().default(''),
    role: memberRoleEnum('role').notNull().default('member'),
    invitedByUserId: uuid('invited_by_user_id')
      .notNull()
      .references(() => users.id),
    status: inviteStatusEnum('status').notNull().default('pending'),
    acceptedByUserId: uuid('accepted_by_user_id').references(() => users.id),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('invites_business_idx').on(t.businessId, t.status),
    index('invites_phone_idx').on(t.phone, t.status),
  ],
);

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id),
    code: text('code').notNull(),
    type: accountTypeEnum('type').notNull(),
    ownerGroup: ownerGroupEnum('owner_group').notNull(),
    nameEn: text('name_en').notNull().default(''),
    nameMy: text('name_my').notNull().default(''),
    isSystem: boolean('is_system').notNull().default(false),
    isHidden: boolean('is_hidden').notNull().default(false),
    moneyKind: moneyKindEnum('money_kind'),
    provider: text('provider'),
    defaultFee: bigint('default_fee', { mode: 'number' }),
    ...synced,
  },
  (t) => [
    uniqueIndex('accounts_business_code_unique').on(t.businessId, t.code),
    index('accounts_business_seq_idx').on(t.businessId, t.serverSeq),
  ],
);

export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').primaryKey(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id),
    nameEn: text('name_en').notNull().default(''),
    nameMy: text('name_my').notNull().default(''),
    phone: text('phone'),
    isCustomer: boolean('is_customer').notNull().default(true),
    isSupplier: boolean('is_supplier').notNull().default(false),
    creditLimit: bigint('credit_limit', { mode: 'number' }),
    note: text('note').notNull().default(''),
    ...synced,
  },
  (t) => [index('contacts_business_seq_idx').on(t.businessId, t.serverSeq)],
);

export const items = pgTable(
  'items',
  {
    id: uuid('id').primaryKey(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id),
    nameEn: text('name_en').notNull().default(''),
    nameMy: text('name_my').notNull().default(''),
    type: itemTypeEnum('type').notNull().default('stocked'),
    unitEn: text('unit_en').notNull().default('piece'),
    unitMy: text('unit_my').notNull().default(''),
    sellingPrice: bigint('selling_price', { mode: 'number' }),
    averageCost: bigint('average_cost', { mode: 'number' }).notNull().default(0),
    lastCost: bigint('last_cost', { mode: 'number' }),
    quantityOnHandMilli: bigint('quantity_on_hand_milli', { mode: 'number' }).notNull().default(0),
    /** Whole kyat held in Stock on hand for this item; cached from stock movements. */
    stockValue: bigint('stock_value', { mode: 'number' }).notNull().default(0),
    lowStockLevelMilli: bigint('low_stock_level_milli', { mode: 'number' }),
    barcode: text('barcode'),
    photoUrl: text('photo_url'),
    locationId: uuid('location_id'),
    lotRef: text('lot_ref'),
    ...synced,
  },
  (t) => [
    index('items_business_seq_idx').on(t.businessId, t.serverSeq),
    index('items_business_barcode_idx').on(t.businessId, t.barcode),
  ],
);

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id),
    type: documentTypeEnum('type').notNull(),
    date: date('date').notNull(),
    number: integer('number'),
    contactId: uuid('contact_id').references(() => contacts.id),
    moneyAccountId: uuid('money_account_id').references(() => accounts.id),
    toMoneyAccountId: uuid('to_money_account_id').references(() => accounts.id),
    /** Array of DocumentLine (see @cannopy/core). Lines are never queried on their own in v1. */
    lines: jsonb('lines').notNull().default([]),
    /** Array of { documentId, amount } for payments. */
    allocations: jsonb('allocations').notNull().default([]),
    total: bigint('total', { mode: 'number' }).notNull(),
    feeAmount: bigint('fee_amount', { mode: 'number' }).notNull().default(0),
    /** Settled by payments; derived from document_allocations on every repost. */
    paidAmount: bigint('paid_amount', { mode: 'number' }).notNull().default(0),
    status: documentStatusEnum('status').notNull().default('open'),
    note: text('note').notNull().default(''),
    attachmentUrl: text('attachment_url'),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    deviceId: text('device_id').notNull(),
    ...synced,
  },
  (t) => [
    index('documents_business_date_idx').on(t.businessId, t.date),
    index('documents_business_contact_idx').on(t.businessId, t.contactId),
    index('documents_business_seq_idx').on(t.businessId, t.serverSeq),
    uniqueIndex('documents_business_type_number_unique')
      .on(t.businessId, t.type, t.number)
      .where(sql`number is not null`),
  ],
);

export const stockMovements = pgTable(
  'stock_movements',
  {
    id: uuid('id').primaryKey(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id),
    date: date('date').notNull(),
    quantityMilli: bigint('quantity_milli', { mode: 'number' }).notNull(),
    unitCost: bigint('unit_cost', { mode: 'number' }).notNull(),
    /** Signed whole kyat: what Stock on hand moves by. Outbound values come from the costing engine. */
    value: bigint('value', { mode: 'number' }).notNull().default(0),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id),
    /** The document line that produced this movement. */
    lineId: uuid('line_id'),
    ...synced,
  },
  (t) => [
    index('stock_movements_item_date_idx').on(t.itemId, t.date),
    index('stock_movements_document_idx').on(t.documentId),
    index('stock_movements_business_seq_idx').on(t.businessId, t.serverSeq),
  ],
);

export const journalEntries = pgTable(
  'journal_entries',
  {
    id: uuid('id').primaryKey(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id),
    date: date('date').notNull(),
    basis: journalBasisEnum('basis').notNull(),
    ...synced,
  },
  (t) => [
    index('journal_entries_business_date_idx').on(t.businessId, t.date),
    index('journal_entries_document_idx').on(t.documentId),
    index('journal_entries_business_seq_idx').on(t.businessId, t.serverSeq),
  ],
);

/** Journal lines are a real table so reports can sum by account with SQL. */
export const journalLines = pgTable(
  'journal_lines',
  {
    entryId: uuid('entry_id')
      .notNull()
      .references(() => journalEntries.id, { onDelete: 'cascade' }),
    lineNo: smallint('line_no').notNull(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    debit: bigint('debit', { mode: 'number' }).notNull().default(0),
    credit: bigint('credit', { mode: 'number' }).notNull().default(0),
    contactId: uuid('contact_id').references(() => contacts.id),
    itemId: uuid('item_id').references(() => items.id),
  },
  (t) => [
    primaryKey({ columns: [t.entryId, t.lineNo] }),
    index('journal_lines_business_account_idx').on(t.businessId, t.accountId),
  ],
);

/**
 * Derived from payment documents on every post: one row per settled document,
 * so open balances and "who owes me" are a sum, not a JSON scan.
 */
export const documentAllocations = pgTable(
  'document_allocations',
  {
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    /** Payment date, copied so ordering payments per document needs no join. */
    date: date('date').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.paymentId, t.documentId] }),
    index('document_allocations_document_idx').on(t.documentId),
  ],
);

/** Every accepted mutation, keyed by the client id, so a retried push is applied once. */
export const syncMutations = pgTable(
  'sync_mutations',
  {
    id: uuid('id').primaryKey(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    deviceId: text('device_id').notNull(),
    entity: syncEntityEnum('entity').notNull(),
    entityId: uuid('entity_id').notNull(),
    op: syncOpEnum('op').notNull(),
    data: jsonb('data').notNull().default({}),
    clientAt: timestamp('client_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sync_mutations_business_idx').on(t.businessId, t.receivedAt)],
);

/** Ordered change log that devices pull from. seq is global, filtered per business. */
export const syncChanges = pgTable(
  'sync_changes',
  {
    seq: bigserial('seq', { mode: 'number' }).primaryKey(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id),
    entity: syncEntityEnum('entity').notNull(),
    entityId: uuid('entity_id').notNull(),
    op: syncOpEnum('op').notNull(),
    data: jsonb('data').notNull().default({}),
    mutationId: uuid('mutation_id').references(() => syncMutations.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sync_changes_business_seq_idx').on(t.businessId, t.seq)],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    entity: text('entity').notNull(),
    entityId: uuid('entity_id').notNull(),
    action: auditActionEnum('action').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
  },
  (t) => [index('audit_log_business_at_idx').on(t.businessId, t.at)],
);

export const businessesRelations = relations(businesses, ({ many }) => ({
  memberships: many(memberships),
  accounts: many(accounts),
  contacts: many(contacts),
  items: many(items),
  documents: many(documents),
}));

export const journalEntriesRelations = relations(journalEntries, ({ many, one }) => ({
  lines: many(journalLines),
  document: one(documents, { fields: [journalEntries.documentId], references: [documents.id] }),
}));

export const journalLinesRelations = relations(journalLines, ({ one }) => ({
  entry: one(journalEntries, { fields: [journalLines.entryId], references: [journalEntries.id] }),
}));
