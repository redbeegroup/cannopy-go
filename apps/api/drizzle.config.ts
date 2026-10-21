import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://cannopy:cannopy-dev-only@localhost:5432/cannopy',
  },
  strict: true,
  verbose: true,
});
