import { createInviteBodySchema, type MembersResult, memberRoleSchema } from '@cannopy/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import {
  acceptInvite,
  createInvite,
  listMembers,
  removeMember,
  requireMember,
  requireOwner,
  revokeInvite,
  setMemberRole,
} from '../services/members.js';
import { parseBody, requireUserId } from './common.js';

/**
 * People who can open a business.
 *
 *   GET    /businesses/:id/members                      members and pending invites (any member)
 *   POST   /businesses/:id/invites      { phone, name?, role? }   owner only
 *   DELETE /businesses/:id/invites/:inviteId                     owner only
 *   PUT    /businesses/:id/members/:userId   { role }            owner only
 *   DELETE /businesses/:id/members/:userId                       owner, or a member leaving
 *   POST   /invites/:inviteId/accept                             the invited phone's user
 */
export const memberRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  app.get<{ Params: { businessId: string } }>(
    '/businesses/:businessId/members',
    async (req): Promise<MembersResult> => {
      const userId = requireUserId(req);
      await requireMember(db, req.params.businessId, userId);
      return listMembers(db, req.params.businessId);
    },
  );

  app.post<{ Params: { businessId: string } }>(
    '/businesses/:businessId/invites',
    async (req, reply) => {
      const userId = requireUserId(req);
      const body = parseBody(createInviteBodySchema, req.body);
      const invite = await db.transaction(async (tx) => {
        await requireOwner(tx, req.params.businessId, userId);
        return createInvite(tx, { businessId: req.params.businessId, byUserId: userId, ...body });
      });
      return reply.code(201).send(invite);
    },
  );

  app.delete<{ Params: { businessId: string; inviteId: string } }>(
    '/businesses/:businessId/invites/:inviteId',
    async (req, reply) => {
      const userId = requireUserId(req);
      await db.transaction(async (tx) => {
        await requireOwner(tx, req.params.businessId, userId);
        await revokeInvite(tx, req.params.businessId, req.params.inviteId);
      });
      return reply.code(204).send();
    },
  );

  app.put<{ Params: { businessId: string; userId: string } }>(
    '/businesses/:businessId/members/:userId',
    async (req, reply) => {
      const actor = requireUserId(req);
      const body = parseBody(z.object({ role: memberRoleSchema }), req.body);
      await db.transaction(async (tx) => {
        await requireOwner(tx, req.params.businessId, actor);
        await setMemberRole(tx, req.params.businessId, req.params.userId, body.role);
      });
      return reply.code(204).send();
    },
  );

  app.delete<{ Params: { businessId: string; userId: string } }>(
    '/businesses/:businessId/members/:userId',
    async (req, reply) => {
      const actor = requireUserId(req);
      await db.transaction(async (tx) => {
        if (req.params.userId !== actor) await requireOwner(tx, req.params.businessId, actor);
        else await requireMember(tx, req.params.businessId, actor);
        await removeMember(tx, req.params.businessId, req.params.userId);
      });
      return reply.code(204).send();
    },
  );

  app.post<{ Params: { inviteId: string } }>('/invites/:inviteId/accept', async (req) => {
    const userId = requireUserId(req);
    return db.transaction((tx) => acceptInvite(tx, req.params.inviteId, userId));
  });
};
