import {
  type Me,
  requestCodeBodySchema,
  type SignInResult,
  updateMeBodySchema,
  verifyCodeBodySchema,
} from '@cannopy/core';
import type { FastifyPluginAsync } from 'fastify';
import type { Db } from '../db/client.js';
import type { AuthService } from '../services/auth.js';
import { loadMe, updateMe } from '../services/members.js';
import { parseBody, requireAuth } from './common.js';

/**
 * Sign-in by phone and one-time code, and the signed-in user's own record.
 *
 *   POST /auth/request-code   { phone, language? }             -> { phone, expiresInSeconds, devCode? }
 *   POST /auth/verify-code    { phone, code, deviceId, ... }    -> { token, user, businesses, invites, isNewUser }
 *   POST /auth/sign-out                                         -> 204 (this device)
 *   POST /auth/sign-out-others                                  -> { count } (every other device)
 *   GET  /me                                                    -> { user, businesses, invites }
 *   PUT  /me                  { name?, language? }              -> { user, businesses, invites }
 *
 * The code endpoints are rate limited harder than the rest of the API.
 */
export const authRoutes: FastifyPluginAsync<{ db: Db; auth: AuthService }> = async (
  app,
  { db, auth },
) => {
  // Per IP. The per-phone limit in AuthService is what keeps SMS cost down.
  const codeLimit = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };

  app.post('/auth/request-code', codeLimit, async (req) => {
    const body = parseBody(requestCodeBodySchema, req.body);
    const result = await auth.requestCode(body.phone, body.language ?? 'my');
    return { phone: body.phone, ...result };
  });

  app.post('/auth/verify-code', codeLimit, async (req): Promise<SignInResult> => {
    const body = parseBody(verifyCodeBodySchema, req.body);
    const { token, userId, isNewUser } = await auth.verifyCode(body);
    const me = await loadMe(db, userId);
    return { token, isNewUser, ...me };
  });

  app.post('/auth/sign-out', async (req, reply) => {
    const { sessionId } = requireAuth(req);
    await auth.signOut(sessionId);
    return reply.code(204).send();
  });

  app.post('/auth/sign-out-others', async (req) => {
    const { userId, sessionId } = requireAuth(req);
    const count = await auth.signOutOtherDevices(userId, sessionId);
    return { count };
  });

  app.get('/me', async (req): Promise<Me> => {
    const { userId } = requireAuth(req);
    return loadMe(db, userId);
  });

  app.put('/me', async (req): Promise<Me> => {
    const { userId } = requireAuth(req);
    const body = parseBody(updateMeBodySchema, req.body);
    return db.transaction(async (tx) => {
      await updateMe(tx, userId, body);
      return loadMe(tx, userId);
    });
  });
};
