import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

const config = { NODE_ENV: 'test' as const, LOG_LEVEL: 'error' as const, corsOrigins: [] };

describe('api scaffold', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp({ config, db: null });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  it('reports health without a database', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', database: 'not_configured' });
  });

  it('rejects a malformed sync push before touching the database', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      payload: { businessId: 'not-a-uuid', mutations: 'nope' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_request');
  });

  it('answers 503 for a valid push when no database is configured', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      payload: { businessId: '019a1b2c-3d4e-7f80-9a0b-1c2d3e4f5a6b', mutations: [] },
    });
    expect(res.statusCode).toBe(503);
  });
});
