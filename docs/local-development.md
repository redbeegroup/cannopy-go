# Local development

## Prerequisites

- Node 22 (`.nvmrc`), pnpm 10 (`corepack enable` or `npm i -g pnpm@10.28.0`)
- Docker with Compose v2

## First run

```bash
cp .env.example .env            # development defaults, safe to keep as is
pnpm install
docker compose up -d db         # PostgreSQL on localhost:5432
pnpm db:migrate                 # applies apps/api/drizzle/*.sql
pnpm dev                        # core (tsc --watch), api on :3000, web on :5173
```

Open http://localhost:5173. The Vite dev server proxies `/api` to the API, so
the app and the API share one origin in development too.

## Everyday commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Watches and runs core, api and web together |
| `pnpm lint` / `pnpm lint:fix` | Biome lint and format |
| `pnpm typecheck` | Strict TypeScript across the workspace |
| `pnpm test` | Vitest in every package |
| `pnpm build` | Builds core, api (`dist/`) and web (`apps/web/dist/`) |
| `pnpm db:generate` | Generates a SQL migration from changes in `apps/api/src/db/schema` |
| `pnpm db:migrate` | Applies migrations to `DATABASE_URL` |

Changing the schema: edit `apps/api/src/db/schema/index.ts`, run
`pnpm db:generate`, review the SQL in `apps/api/drizzle/`, commit both.

## Running the full stack in Docker

```bash
docker compose up --build
```

Then open http://localhost:8080. This builds the same images CI builds and is
the closest thing to UAT on your machine. The `api` container runs migrations
on start; `docker compose logs api` shows them.

## Trying the sync endpoints

The sync routes read a development-only header until authentication lands:

```bash
curl -s localhost:3000/api/health
curl -s -X POST localhost:3000/api/sync/push \
  -H 'content-type: application/json' -H 'x-dev-user-id: <a user uuid>' \
  -d '{"businessId":"<business uuid>","mutations":[]}'
curl -s 'localhost:3000/api/sync/pull?businessId=<business uuid>&since=0'
```

## Testing the app offline

Build and preview (`pnpm --filter @cannopy/web build && pnpm --filter @cannopy/web preview`),
open the app once, then switch the browser or phone to offline. The shell, fonts
and the local store keep working; the status line shows how many changes are
waiting to sync.
