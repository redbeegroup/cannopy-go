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

## API integration tests

`apps/api` has tests that post real documents through the ledger and read the
reports back. They need a PostgreSQL database and skip when `TEST_DATABASE_URL`
is not set (CI provides one). Locally, point them at a scratch database on the
compose Postgres:

```bash
docker compose up -d db
docker compose exec db createdb -U cannopy cannopy_test
TEST_DATABASE_URL=postgres://cannopy:cannopy-dev-only@localhost:5432/cannopy_test pnpm --filter @cannopy/api test
```

Migrations run against that database automatically before the first test.

## Running the full stack in Docker

```bash
docker compose up --build
```

Then open http://localhost:8080. This builds the same images CI builds and is
the closest thing to UAT on your machine. The `api` container runs migrations
on start; `docker compose logs api` shows them.

## Signing in during development

Sign-in sends a six-digit code by SMS. Nothing is sent in development:
`SMS_PROVIDER=log` (the default) writes the code to the API log, and outside
production the request-code reply also carries it, so the sign-in screen shows
"Test mode: your code is 123456". To fix the code instead (handy on a phone
against UAT), set `AUTH_DEV_CODE=123456` on the API.

The API wants a bearer token. From the shell:

```bash
curl -s -X POST localhost:3000/api/auth/request-code \
  -H 'content-type: application/json' -d '{"phone":"+959123456789","language":"en"}'
# -> {"phone":"+959123456789","expiresInSeconds":600,"devCode":"482913"}
curl -s -X POST localhost:3000/api/auth/verify-code \
  -H 'content-type: application/json' \
  -d '{"phone":"+959123456789","code":"482913","deviceId":"curl"}'
# -> {"token":"...","user":{...},"businesses":[...],"invites":[...],"isNewUser":true}
curl -s localhost:3000/api/me -H 'authorization: Bearer <token>'
curl -s 'localhost:3000/api/sync/pull?businessId=<business uuid>&since=0' \
  -H 'authorization: Bearer <token>'
```

The whole flow, with the environment variables and the SMS seam, is in
[sign-in.md](./sign-in.md).

## Testing the app offline

Build and preview (`pnpm --filter @cannopy/web build && pnpm --filter @cannopy/web preview`),
open the app once, then switch the browser or phone to offline. The shell, fonts
and the local store keep working; the status line shows how many changes are
waiting to sync.
