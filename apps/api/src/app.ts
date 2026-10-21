import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import type { Db } from './db/client.js';
import { healthRoutes } from './routes/health.js';
import { syncRoutes } from './routes/sync.js';

export interface AppOptions {
  config: Pick<Config, 'NODE_ENV' | 'LOG_LEVEL' | 'corsOrigins'>;
  /** Null lets the app start without a database (health reports it). */
  db: Db | null;
}

export async function buildApp({ config, db }: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      config.NODE_ENV === 'test'
        ? false
        : {
            level: config.LOG_LEVEL,
            ...(config.NODE_ENV === 'development'
              ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
              : {}),
          },
    trustProxy: true,
  });

  await app.register(helmet, { global: true });
  await app.register(cors, {
    origin: config.corsOrigins.length > 0 ? config.corsOrigins : false,
    credentials: true,
  });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

  // Everything is served under /api so the web container can proxy one prefix.
  await app.register(
    async (api) => {
      await api.register(healthRoutes, { db });
      await api.register(syncRoutes, { db });
    },
    { prefix: '/api' },
  );

  return app;
}
