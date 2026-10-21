import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadConfig } from '../config.js';
import { createDb } from './client.js';

/**
 * Applies pending SQL migrations from ./drizzle. The api container runs this
 * before starting so a Portainer redeploy upgrades the schema on its own.
 */
async function main() {
  const config = loadConfig();
  const { db, pool } = createDb(config.DATABASE_URL);
  const started = Date.now();
  await migrate(db, { migrationsFolder: new URL('../../drizzle', import.meta.url).pathname });
  await pool.end();
  console.log(`Migrations applied in ${Date.now() - started} ms`);
}

main().catch((err) => {
  console.error('Migration failed', err);
  process.exit(1);
});
