import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { Db } from '../db/client.js';

export const healthRoutes: FastifyPluginAsync<{ db: Db | null }> = async (app, { db }) => {
  app.get('/health', async (_req, reply) => {
    let database: 'ok' | 'unavailable' | 'not_configured' = 'not_configured';
    if (db) {
      try {
        await db.execute(sql`select 1`);
        database = 'ok';
      } catch (err) {
        app.log.warn({ err }, 'database health check failed');
        database = 'unavailable';
      }
    }
    const status = database === 'unavailable' ? 503 : 200;
    return reply.code(status).send({
      status: status === 200 ? 'ok' : 'degraded',
      database,
      version: process.env.APP_VERSION ?? 'dev',
      time: new Date().toISOString(),
    });
  });
};
