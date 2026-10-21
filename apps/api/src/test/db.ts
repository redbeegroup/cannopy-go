import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from '../db/client.js';

/**
 * Integration tests need PostgreSQL. Set TEST_DATABASE_URL to run them; CI
 * provides one through a service container. Without it the suites skip.
 */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
export const hasTestDb = typeof TEST_DATABASE_URL === 'string' && TEST_DATABASE_URL.length > 0;

let shared: ReturnType<typeof createDb> | null = null;
let migrated: Promise<void> | null = null;

export async function testDb(): Promise<ReturnType<typeof createDb>> {
  if (!hasTestDb) throw new Error('TEST_DATABASE_URL is not set');
  if (!shared) shared = createDb(TEST_DATABASE_URL as string);
  if (!migrated) {
    // Test files run in separate workers; an advisory lock keeps two of them
    // from creating the migrations schema at the same moment.
    const { db, pool } = shared;
    migrated = (async () => {
      const client = await pool.connect();
      try {
        await client.query('select pg_advisory_lock(7_4_2026)');
        await migrate(db, { migrationsFolder: new URL('../../drizzle', import.meta.url).pathname });
      } finally {
        await client.query('select pg_advisory_unlock(7_4_2026)');
        client.release();
      }
    })();
  }
  await migrated;
  return shared;
}

export async function closeTestDb(): Promise<void> {
  if (shared) await shared.pool.end();
  shared = null;
  migrated = null;
}
