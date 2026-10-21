import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { ApiError } from '../services/errors.js';

/** Placeholder until the auth work lands: the acting user comes from a dev-only header. */
export function currentUserId(req: FastifyRequest): string | null {
  const id = req.headers['x-dev-user-id'];
  return typeof id === 'string' && id.length > 0 ? id : null;
}

export function requireUserId(req: FastifyRequest): string {
  const id = currentUserId(req);
  if (!id) throw new ApiError(401, 'unauthenticated', 'x-dev-user-id header is required');
  return id;
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
