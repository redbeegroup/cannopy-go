import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import type { Db } from './db/client.js';
import { authRoutes } from './routes/auth.js';
import { businessRoutes } from './routes/businesses.js';
import { bearerToken, sendError } from './routes/common.js';
import { healthRoutes } from './routes/health.js';
import { memberRoutes } from './routes/members.js';
import { syncRoutes } from './routes/sync.js';
import { AuthService } from './services/auth.js';
import { createSmsSender, type SmsSender } from './services/sms.js';

export interface AppOptions {
  config: Pick<Config, 'NODE_ENV' | 'LOG_LEVEL' | 'corsOrigins'> &
    Partial<
      Pick<
        Config,
        | 'AUTH_SECRET'
        | 'SMS_PROVIDER'
        | 'SMS_WEBHOOK_URL'
        | 'SMS_WEBHOOK_TOKEN'
        | 'AUTH_DEV_CODE'
        | 'SESSION_DAYS'
      >
    >;
  /** Null lets the app start without a database (health reports it). */
  db: Db | null;
  /** Replaces the configured SMS provider; tests use this to read the codes. */
  sms?: SmsSender;
}

export async function buildApp({ config, db, sms }: AppOptions): Promise<FastifyInstance> {
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

  // Sign-in. The secret is required in every environment that has a database.
  const secret =
    config.AUTH_SECRET ?? (config.NODE_ENV === 'test' ? 'test-secret-not-for-use' : '');
  if (db && secret.length < 16) throw new Error('AUTH_SECRET must be at least 16 characters');
  const auth = db
    ? new AuthService(db, {
        secret,
        sms:
          sms ??
          createSmsSender(
            {
              SMS_PROVIDER: config.SMS_PROVIDER ?? 'log',
              SMS_WEBHOOK_URL: config.SMS_WEBHOOK_URL,
              SMS_WEBHOOK_TOKEN: config.SMS_WEBHOOK_TOKEN,
            },
            app.log,
          ),
        devCode: config.AUTH_DEV_CODE,
        revealCodes: config.NODE_ENV !== 'production',
        sessionDays: config.SESSION_DAYS ?? 365,
      })
    : null;
  if (config.AUTH_DEV_CODE) {
    app.log.warn('AUTH_DEV_CODE is set: every sign-in code is fixed. Not for real data.');
  }

  // Every request learns who is asking, from the bearer token, before any route runs.
  app.decorateRequest('auth', null);
  app.addHook('onRequest', async (req) => {
    const token = bearerToken(req);
    req.auth = token && auth ? await auth.authenticate(token) : null;
  });

  app.setErrorHandler((err, _req, reply) => {
    try {
      return sendError(reply, err);
    } catch (other) {
      app.log.error({ err: other }, 'unhandled error');
      const status = (other as { statusCode?: number }).statusCode ?? 500;
      return reply.code(status).send({
        error: status === 500 ? 'internal_error' : 'request_error',
        message: status === 500 ? 'Something went wrong' : (other as Error).message,
      });
    }
  });

  // Everything is served under /api so the web container can proxy one prefix.
  await app.register(
    async (api) => {
      await api.register(healthRoutes, { db });
      await api.register(syncRoutes, { db });
      if (db && auth) {
        await api.register(authRoutes, { db, auth });
        await api.register(memberRoutes, { db });
        await api.register(businessRoutes, { db });
      }
    },
    { prefix: '/api' },
  );

  return app;
}
