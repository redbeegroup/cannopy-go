import {
  accountingModeSchema,
  accountSchema,
  businessSchema,
  contactSchema,
  documentSchema,
  documentTypeSchema,
  fiscalYearRange,
  isoDateSchema,
  isoInstantSchema,
  itemSchema,
  monthRange,
  userSchema,
} from '@cannopy/core';
import { and, desc, eq, gte, isNull, lte } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { documents } from '../db/schema/index.js';
import { businessRowToCore, loadBusiness } from '../services/books.js';
import { createBusiness, setAccountingMode } from '../services/business.js';
import {
  deleteAccount,
  deleteContact,
  deleteItem,
  listAccounts,
  listContacts,
  listItems,
  upsertAccount,
  upsertContact,
  upsertItem,
} from '../services/entities.js';
import { deleteDocument, loadDocumentWithPostings, upsertDocument } from '../services/ledger.js';
import { rowToDocument } from '../services/mappers.js';
import {
  balanceSheetReport,
  contactBalances,
  moneyReport,
  openDocuments,
  profitAndLossReport,
  stockReport,
} from '../services/reports.js';
import { parseBody, parseQuery, requireUserId } from './common.js';

/**
 * REST API for the owner's data. Every route lives under
 * /api/businesses/:businessId and reads the acting user from the dev header
 * until authentication lands. Bodies and replies use the @cannopy/core types,
 * so the web app can share them.
 *
 * Writes go through the same services the sync push uses, so a document saved
 * here and a document pushed from a phone post identically.
 */

const today = () => new Date().toISOString().slice(0, 10);

const createBusinessBody = z.object({ business: businessSchema, owner: userSchema });
const modeBody = z.object({ mode: accountingModeSchema, at: isoInstantSchema.optional() });
const deleteBody = z.object({ deletedAt: isoInstantSchema.optional() });
const periodQuery = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  period: z.enum(['month', 'fiscal_year']).optional(),
  basis: accountingModeSchema.optional(),
});
const asOfQuery = z.object({
  asOf: isoDateSchema.optional(),
  basis: accountingModeSchema.optional(),
});
const dateQuery = z.object({ date: isoDateSchema.optional() });
const listDocumentsQuery = z.object({
  type: documentTypeSchema.optional(),
  contactId: z.string().optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const businessRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  app.post('/businesses', async (req, reply) => {
    const body = parseBody(createBusinessBody, req.body);
    if (body.owner.businessId !== body.business.id) {
      return reply
        .code(400)
        .send({ error: 'invalid_request', message: 'Owner must belong to the business' });
    }
    const result = await db.transaction((tx) => createBusiness(tx, body));
    return reply.code(201).send(result);
  });

  app.get<{ Params: { businessId: string } }>('/businesses/:businessId', async (req) => {
    const row = await loadBusiness(db, req.params.businessId);
    return businessRowToCore(row);
  });

  app.put<{ Params: { businessId: string } }>(
    '/businesses/:businessId/accounting-mode',
    async (req) => {
      const userId = requireUserId(req);
      const body = parseBody(modeBody, req.body);
      return db.transaction((tx) =>
        setAccountingMode(
          tx,
          req.params.businessId,
          userId,
          body.mode,
          body.at ?? new Date().toISOString(),
        ),
      );
    },
  );

  /* Accounts */
  app.get<{ Params: { businessId: string } }>('/businesses/:businessId/accounts', async (req) => {
    return { accounts: await listAccounts(db, req.params.businessId) };
  });
  app.put<{ Params: { businessId: string; id: string } }>(
    '/businesses/:businessId/accounts/:id',
    async (req) => {
      const account = parseBody(accountSchema, { ...(req.body as object), id: req.params.id });
      return db.transaction((tx) => upsertAccount(tx, req.params.businessId, account));
    },
  );
  app.delete<{ Params: { businessId: string; id: string } }>(
    '/businesses/:businessId/accounts/:id',
    async (req, reply) => {
      const body = parseBody(deleteBody, req.body ?? {});
      await db.transaction((tx) =>
        deleteAccount(
          tx,
          req.params.businessId,
          req.params.id,
          body.deletedAt ?? new Date().toISOString(),
        ),
      );
      return reply.code(204).send();
    },
  );

  /* Contacts */
  app.get<{ Params: { businessId: string } }>('/businesses/:businessId/contacts', async (req) => {
    return { contacts: await listContacts(db, req.params.businessId) };
  });
  app.put<{ Params: { businessId: string; id: string } }>(
    '/businesses/:businessId/contacts/:id',
    async (req) => {
      const contact = parseBody(contactSchema, { ...(req.body as object), id: req.params.id });
      return db.transaction((tx) => upsertContact(tx, req.params.businessId, contact));
    },
  );
  app.delete<{ Params: { businessId: string; id: string } }>(
    '/businesses/:businessId/contacts/:id',
    async (req, reply) => {
      const body = parseBody(deleteBody, req.body ?? {});
      await db.transaction((tx) =>
        deleteContact(
          tx,
          req.params.businessId,
          req.params.id,
          body.deletedAt ?? new Date().toISOString(),
        ),
      );
      return reply.code(204).send();
    },
  );
  app.get<{ Params: { businessId: string; id: string } }>(
    '/businesses/:businessId/contacts/:id/open-documents',
    async (req) => ({ documents: await openDocuments(db, req.params.businessId, req.params.id) }),
  );

  /* Items */
  app.get<{ Params: { businessId: string } }>('/businesses/:businessId/items', async (req) => {
    return { items: await listItems(db, req.params.businessId) };
  });
  app.put<{ Params: { businessId: string; id: string } }>(
    '/businesses/:businessId/items/:id',
    async (req) => {
      const item = parseBody(itemSchema, { ...(req.body as object), id: req.params.id });
      return db.transaction((tx) => upsertItem(tx, req.params.businessId, item));
    },
  );
  app.delete<{ Params: { businessId: string; id: string } }>(
    '/businesses/:businessId/items/:id',
    async (req, reply) => {
      const body = parseBody(deleteBody, req.body ?? {});
      await db.transaction((tx) =>
        deleteItem(
          tx,
          req.params.businessId,
          req.params.id,
          body.deletedAt ?? new Date().toISOString(),
        ),
      );
      return reply.code(204).send();
    },
  );

  /* Documents */
  app.get<{ Params: { businessId: string } }>('/businesses/:businessId/documents', async (req) => {
    const q = parseQuery(listDocumentsQuery, req.query);
    const conditions = [
      eq(documents.businessId, req.params.businessId),
      isNull(documents.deletedAt),
    ];
    if (q.type) conditions.push(eq(documents.type, q.type));
    if (q.contactId) conditions.push(eq(documents.contactId, q.contactId));
    if (q.from) conditions.push(gte(documents.date, q.from));
    if (q.to) conditions.push(lte(documents.date, q.to));
    const rows = await db
      .select()
      .from(documents)
      .where(and(...conditions))
      .orderBy(desc(documents.date), desc(documents.id))
      .limit(q.limit);
    return { documents: rows.map(rowToDocument) };
  });
  app.get<{ Params: { businessId: string; id: string } }>(
    '/businesses/:businessId/documents/:id',
    async (req) => {
      return loadDocumentWithPostings(db, req.params.businessId, req.params.id);
    },
  );
  app.put<{ Params: { businessId: string; id: string } }>(
    '/businesses/:businessId/documents/:id',
    async (req) => {
      const userId = requireUserId(req);
      const document = parseBody(documentSchema, { ...(req.body as object), id: req.params.id });
      return db.transaction((tx) =>
        upsertDocument(tx, { businessId: req.params.businessId, userId, document }),
      );
    },
  );
  app.delete<{ Params: { businessId: string; id: string } }>(
    '/businesses/:businessId/documents/:id',
    async (req) => {
      const userId = requireUserId(req);
      const body = parseBody(deleteBody, req.body ?? {});
      return db.transaction((tx) =>
        deleteDocument(tx, {
          businessId: req.params.businessId,
          userId,
          documentId: req.params.id,
          deletedAt: body.deletedAt ?? new Date().toISOString(),
        }),
      );
    },
  );

  /* Reports */
  app.get<{ Params: { businessId: string } }>(
    '/businesses/:businessId/reports/profit-and-loss',
    async (req) => {
      const q = parseQuery(periodQuery, req.query);
      const business = await loadBusiness(db, req.params.businessId);
      const range =
        q.period === 'fiscal_year'
          ? fiscalYearRange(q.to ?? today(), business.fiscalYearStartMonth)
          : q.from || q.to
            ? { from: q.from ?? '0001-01-01', to: q.to ?? today() }
            : monthRange(today());
      return profitAndLossReport(
        db,
        business.id,
        q.basis ?? business.accountingMode,
        range.from,
        range.to,
      );
    },
  );
  app.get<{ Params: { businessId: string } }>(
    '/businesses/:businessId/reports/balance-sheet',
    async (req) => {
      const q = parseQuery(asOfQuery, req.query);
      const business = await loadBusiness(db, req.params.businessId);
      return balanceSheetReport(
        db,
        business.id,
        q.basis ?? business.accountingMode,
        q.asOf ?? today(),
      );
    },
  );
  app.get<{ Params: { businessId: string } }>(
    '/businesses/:businessId/reports/money',
    async (req) => {
      const q = parseQuery(dateQuery, req.query);
      return moneyReport(db, req.params.businessId, q.date ?? today());
    },
  );
  app.get<{ Params: { businessId: string } }>(
    '/businesses/:businessId/reports/receivables',
    async (req) => {
      return contactBalances(db, req.params.businessId, 'receivable');
    },
  );
  app.get<{ Params: { businessId: string } }>(
    '/businesses/:businessId/reports/payables',
    async (req) => {
      return contactBalances(db, req.params.businessId, 'payable');
    },
  );
  app.get<{ Params: { businessId: string } }>(
    '/businesses/:businessId/reports/stock',
    async (req) => {
      const q = parseQuery(asOfQuery, req.query);
      return stockReport(db, req.params.businessId, q.asOf ?? today());
    },
  );
};
