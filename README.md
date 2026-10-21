# Cannopy GO

Simple bookkeeping for Myanmar micro and small businesses. The owner records
what happened (I sold, I spent, I got paid) on a phone, with or without signal,
in English or Myanmar, and the app keeps proper double-entry books underneath,
in cash or accrual mode.

- Product scope and accounting model: https://claude.ai/artifact/J4NiDmKopJT6BsropxtHYs
- Architecture and decisions: [docs/architecture.md](docs/architecture.md)
- Run it locally: [docs/local-development.md](docs/local-development.md)
- Deploy to UAT with Portainer: [deploy/uat/README.md](deploy/uat/README.md)

## Layout

```
apps/api          Fastify API, PostgreSQL schema and migrations
apps/web          React progressive web app (phone, tablet, browser), offline first
packages/core     Shared domain: entity schemas, whole-kyat money, bilingual labels, sync protocol
deploy/uat        Portainer stack for the UAT host
```

## Quick start

```bash
cp .env.example .env
pnpm install
docker compose up -d db
pnpm db:migrate
pnpm dev
```

Web app on http://localhost:5173, API on http://localhost:3000/api/health.
`docker compose up --build` runs the whole stack in containers on http://localhost:8080.
