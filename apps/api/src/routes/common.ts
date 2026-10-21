import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { AuthUser } from '../services/auth.js';
import { ApiError } from '../services/errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the auth hook in app.ts from the bearer token; null when there is none or it is bad. */
    auth: AuthUser | null;
  }
}

export function currentUserId(req: FastifyRequest): string | null {
  return req.auth?.userId ?? null;
}

export function requireAuth(req: FastifyRequest): AuthUser {
  if (!req.auth) throw new ApiError(401, 'unauthenticated', 'Sign in to continue');
  return req.auth;
}

export function requireUserId(req: FastifyRequest): string {
  return requireAuth(req).userId;
}

/** The bearer token from the Authorization header, if any. */
export function bearerToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m?.[1]?.trim() || null;
}

export function parseBody<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(400, 'invalid_request', 'Request body is invalid', parsed.error.issues);
  }
  return parsed.data;
}

export function parseQuery<T extends z.ZodTypeAny>(schema: T, query: unknown): z.infer<T> {
  const parsed = schema.safeParse(query);
  if (!parsed.success) {
    throw new ApiError(400, 'invalid_request', 'Query is invalid', parsed.error.issues);
  }
  return parsed.data;
}

export function sendError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof ApiError) {
    return reply.code(err.status).send({
      error: err.code,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  }
  throw err;
}
