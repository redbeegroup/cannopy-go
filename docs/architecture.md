# Cannopy GO architecture

Status: proposed in the "Architecture and Docker setup" thread, 21 October 2026.
Builds on the [product scope and accounting model](https://claude.ai/artifact/J4NiDmKopJT6BsropxtHYs).

Cannopy GO is a bookkeeping app for Myanmar micro and small business owners.
It must work on a cheap Android phone first, also on a tablet and in a browser,
keep working without signal for Sell, Spend and Get paid, speak English and
Myanmar everywhere, and run in Docker on the owner's own hosts.

## The shape in one paragraph

One repository, one language (TypeScript), three containers. A **web app**
(React PWA served by nginx) is the only client for phone, tablet and browser; it
keeps a working copy of the business's data on the device and syncs an outbox of
changes. An **API** (Node 22 + Fastify) is the source of truth, posts documents
to the two journals and serves sync. **PostgreSQL** stores everything. A shared
**core** package holds the entity schemas, the whole-kyat money rules and the
bilingual label type so the client and the server never disagree about the data.

```
 phone / tablet / browser                     UAT or production host (Docker)
 ┌──────────────────────────┐    HTTPS     ┌───────────┐   /api   ┌──────────┐      ┌────────────┐
 │ web app (PWA)            │ ───────────▶ │ web       │ ───────▶ │ api      │ ───▶ │ db         │
 │  IndexedDB working copy  │ ◀─────────── │ nginx     │ ◀─────── │ Fastify  │ ◀─── │ PostgreSQL │
 │  outbox → push / pull    │              │ static +  │          │ Drizzle  │      │ 17         │
 │  service worker cache    │              │ proxy     │          │ sync     │      │            │
 └──────────────────────────┘              └───────────┘          └──────────┘      └────────────┘
```

## Decisions

Each decision names the alternative it beat. Decisions marked **needs you** have
a default that only the owner of the project can confirm.

### 1. Client: a React progressive web app, not a native app

One codebase covers phone, tablet and browser. A PWA installs to the Android
home screen, opens full screen, works offline through a service worker, and
updates without an app store. Android is the overwhelming majority of phones in
Myanmar, where PWAs are well supported. If a Play Store listing is wanted later,
the same code is wrapped with Capacitor; nothing in the stack blocks that.

- Alternatives: Flutter (strong on mobile, weaker on the web and a second
  language next to the server); React Native (no browser target without extra
  work). Both would split the domain code across two languages.
- Stack: React 19, TypeScript, Vite, `vite-plugin-pwa` (Workbox), Dexie for
  IndexedDB, i18next, Padauk font bundled through Fontsource.
- **Needs you**: whether a Play Store listing is a version 1 goal. Default: no.

### 2. Server: Node 22 with Fastify, in TypeScript

The same language as the client means the entity schemas, money rules and later
the posting rules live once in `packages/core` and run in both places. That is
what makes offline work honest: the phone can show a correct balance from local
documents using the same code the server uses to post them.

- Alternatives: Go (fast, small images, but the domain types would be duplicated
  and kept in step by hand); Python or Ruby frameworks (no shared code with the
  client either).
- Fastify over Express for schema-based validation, speed and a maintained
  plugin set (`@fastify/cors`, `@fastify/helmet`, `@fastify/rate-limit`).

### 3. Database: PostgreSQL 17 with Drizzle ORM and SQL migrations

Postgres for correctness under concurrent writes, `bigint`, JSONB for document
lines, and because every host the project targets already runs it well in
Docker. Drizzle keeps the schema in TypeScript (`apps/api/src/db/schema`) and
generates plain SQL migrations into `apps/api/drizzle`, which are committed and
reviewed. The `api` container runs pending migrations when it starts, so a
Portainer redeploy upgrades the schema with no manual step.

- One database, `business_id` on every tenant-owned row. Version 1 has one
  business per deployment in practice, but the column means a hosted
  multi-business service later needs row-level security, not a redesign.

### 4. Data conventions (binding for threads 3 and 4)

| Rule | Why |
| --- | --- |
| Ids are UUID v7, generated on the device that creates the record | An offline phone can create a sale with a final id; retries are idempotent; inserts stay ordered |
| Money is whole kyat in `bigint` columns and integer JS numbers; `kyatSchema` rejects decimals | The kyat has no subunit in daily use; integers avoid float drift; a later two-decimal currency fits as minor units |
| Quantities are integer thousandths of a unit (`quantity_milli`) | 1.5 kg and 0.25 viss without floating point |
| Every name is two columns, `name_en` and `name_my`, with fallback to whichever was typed | Myanmar is a first-class language in the data, not a translation layer |
| Myanmar text is Unicode only; Zawgyi is detected and converted at input | Reports and sorting break on mixed encodings |
| Documents carry a calendar `date`; audit fields carry timestamps | Yesterday's sale entered today is dated yesterday |
| Soft delete via `deleted_at` on synced tables | A deletion has to reach the other device through sync |
| Journal lines are a table, not JSON | Reports sum by account in SQL |

### 5. Two journals, one record

As the scope doc sets out: every document posts to the accrual journal on its
date; cash lines are posted when money moves; lines identical in both modes are
stored once with basis `both`. The mode switch changes which basis the reports
read and nothing else. The schema has `journal_entries.basis` and the invariants
in the scope doc become tests in thread 3.

### 6. Offline first: outbox sync, server authoritative

The device keeps the business's accounts, contacts, items and documents in
IndexedDB and reads from there, so Sell, Spend and Get paid and the customer
balance screen work with no signal. Every local write also appends a
**mutation** to an outbox. When online, the client pushes the outbox in order
and pulls the server's **change log** from the last sequence it has seen.

- Mutations carry a client id, so a push that times out can be retried and is
  applied once (`sync_mutations` is keyed by that id).
- The server applies a mutation through the posting rules, writes the derived
  rows (journal entries, stock movements) and appends to `sync_changes`. Devices
  only ever learn about data through that log, so what the phone shows after a
  sync is exactly what the server has.
- Conflict policy for version 1: one owner, possibly two devices. The server
  applies mutations in arrival order and the change log wins on the device. Edits
  are whole-row upserts; a later edit of the same record replaces an earlier one.
  This is acceptable for one user and is logged in `audit_log`. A cashier role
  later needs field-level merging only for a few fields (stock counts), and the
  mutation format leaves room for that.
- Sequence numbers are global (`bigserial`) and filtered per business; this keeps
  the pull query one indexed range scan.
- The service worker precaches the app shell, fonts and icons. API calls are
  never cached: the working copy in IndexedDB is the offline source, not a cached
  HTTP response.
- Shipped in this scaffold: the protocol types (`packages/core/src/schema/sync.ts`),
  the API endpoints with idempotent storage and the change log
  (`apps/api/src/routes/sync.ts`), and the device side (`apps/web/src/sync`).
  Thread 3 fills in `applyMutation` with the posting rules.

### 7. Two languages everywhere

`i18next` with one JSON file per language in `apps/web/src/i18n`; a test fails
the build when the English and Myanmar files have different keys. Padauk is
bundled so Myanmar renders the same on every phone, the base font size is larger
and line height is 1.65 because Myanmar script needs the room. The chosen
language persists on the device and is also stored on the business and the user
for receipts and exports. Zawgyi conversion at input uses Google's
`myanmar-tools` and is thread 4's job on the text fields.

### 8. Authentication (shape decided, implementation deferred)

Owner only in version 1. Login by phone number or email plus a password, with a
one-time code by SMS as a later option once an SMS provider is chosen. The
session is a signed token kept on the device so the app opens and records
offline; the token is only checked when syncing. The `users` table and the
`AUTH_SECRET` setting are in place; the sync routes currently read a dev-only
header and must not be exposed publicly until the auth work lands.

- **Needs you**: phone or email as the primary login. Default: phone, because
  that is what an owner has; email optional.

### 9. Containers

Three services in Docker Compose, the same shape locally and on UAT:

| Service | Image | Role |
| --- | --- | --- |
| `web` | `nginx:1.29-alpine` with the built PWA | Serves the app, proxies `/api/` to the API so the browser sees one origin and no CORS is needed |
| `api` | `node:22-alpine`, non-root | Runs migrations then the Fastify server on port 3000, internal only |
| `db` | `postgres:17-alpine` | Data on a named volume |

Images are multi-stage builds from the repository root (so the shared `core`
package is included) and carry health checks. TLS is terminated outside the
stack: the UAT host's existing reverse proxy (or a Caddy/Traefik container that
is already there) forwards to the `web` port.

- **Needs you**: the UAT hostname and how TLS is handled on that host today.
  Default: the stack exposes plain HTTP on port 8080 and the host proxy adds TLS.

### 10. Build and deploy

GitHub Actions (`.github/workflows/ci.yml`) runs lint, typecheck, tests and the
app builds on every pull request, builds both images on every PR, and on `main`
pushes them to the registry tagged with the commit SHA and `latest`. A final job
calls a Portainer stack webhook so the UAT host re-pulls and redeploys. The UAT
stack file is `deploy/uat/docker-compose.yml`, and `deploy/uat/README.md` has
the click-by-click Portainer setup.

- Secrets live only in GitHub repository settings and on the Portainer stack.
  GitHub needs `PORTAINER_WEBHOOK_URL` (or the four `PORTAINER_*` API secrets).
  Portainer needs `POSTGRES_PASSWORD` and `AUTH_SECRET` as stack variables, and
  a registry credential to pull the private images.
- **Needs you**: the registry. Default: GitHub Container Registry
  (`ghcr.io/redbeegroup/cannopy-go-api` and `-web`) because it needs no extra
  account and the workflow's own token can push. Docker Hub or a self-hosted
  registry works with two lines changed in the workflow and the stack file.
- **Needs you**: the Portainer webhook URL (or endpoint id and stack id) once
  the stack exists, and the stack name. Default name: `cannopy-uat`.

### 11. Repository layout and tooling

```
apps/api          Fastify API, Drizzle schema and migrations, Dockerfile
apps/web          React PWA, i18n, IndexedDB store, sync client, nginx, Dockerfile
packages/core     Shared schemas (zod), money, bilingual labels, ids, sync protocol
deploy/uat        Portainer stack and setup guide
docs              This document and the local development guide
.github/workflows CI, image build and UAT deploy
```

pnpm workspaces, strict TypeScript, Biome for lint and format, Vitest for tests.
`pnpm lint && pnpm typecheck && pnpm test && pnpm build` is what CI runs.

## What later threads build on

- **Thread 3, core accounting and inventory** (done, see
  [accounting-core.md](./accounting-core.md)): posting rules, costing and
  report shaping in `packages/core/src/accounting`, the ledger and report
  services in `apps/api/src/services`, REST routes under
  `/api/businesses/:businessId`, and `applyMutation` in the sync route.
- **Thread 4, mobile UI and onboarding** (done, see
  [mobile-ui.md](./mobile-ui.md)): setup, home with the plain groups, Sell,
  Spend, Buy, Get paid, Pay, owner money, transfers, items and stock counts,
  customers and suppliers, history with edit and delete, reports and the
  cash/accrual switch. Writes go through an outbox in IndexedDB and the device
  derives money and balances from its own documents, so Sell, Spend and Get
  paid work without signal. Zawgyi is converted at input.

## Open items that need the owner's answer

1. Registry: GitHub Container Registry (default) or another.
2. Portainer: webhook URL or API details, and the stack name (default `cannopy-uat`).
3. UAT hostname and where TLS terminates (default: host reverse proxy to port 8080).
4. Primary login: phone (default) or email.
5. Play Store listing in version 1 (default: no, PWA only).
