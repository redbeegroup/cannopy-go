# Working in this repository

Read `docs/architecture.md` before changing data shapes or adding services; its
"Data conventions" table is binding. The product scope and accounting model doc
it links to defines the two-journal cash/accrual design and the posting rules.

- pnpm workspace: `apps/api` (Fastify + Drizzle + PostgreSQL), `apps/web`
  (React PWA, offline first), `packages/core` (shared zod schemas, money, labels).
- Domain logic that the device must also run (posting rules, stock costing,
  money formatting) goes in `packages/core`, not in the API.
- Money is whole kyat as integers. Quantities are integer thousandths. Names
  are `name_en` and `name_my`. Ids are UUID v7 made on the client.
- Schema changes: edit `apps/api/src/db/schema/index.ts`, run `pnpm db:generate`,
  commit the SQL under `apps/api/drizzle/`.
- Before pushing: `pnpm lint && pnpm --filter @cannopy/core build && pnpm typecheck && pnpm test && pnpm build`.
- Never commit secrets. Local settings live in `.env` (ignored); deployment
  secrets live in GitHub repository settings and on the Portainer stack.
