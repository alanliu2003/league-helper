# League Helper

League of Legends analytics and AI coaching monorepo.

> Temporary product name. Final branding TBD.

## Workspace layout

- `apps/web` — Nuxt frontend (TypeScript strict, Tailwind CSS)
- `apps/api` — NestJS REST API with Prisma
- `apps/worker` — BullMQ background worker
- `packages/shared` — shared types, Zod schemas, constants
- `packages/config` — shared TypeScript and ESLint config

## Prerequisites

- Node.js 20.12+ (Node 22 recommended; this repo pins `22.14.0` in `.node-version`)
- pnpm 9 (`npm install -g pnpm@9`)
- Docker Desktop running (PostgreSQL + Redis)

### Windows / Nodist note

If you see `Sorry, there's a problem with nodist` or `%1 is not a valid Win32 application`, Nodist's Node 22 install is corrupted or locked. Fix with:

```powershell
nodist 20.10.0
nodist rm 22.14.0
nodist + 22.14.0
nodist 22.14.0
node -v   # should print v22.14.0
```

Then reopen the terminal and rerun `pnpm install` / `pnpm dev`.

## Local setup

```bash
# 1) Install dependencies (from repo root)
pnpm install

# 2) Copy environment templates (no real secrets)
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/worker/.env.example apps/worker/.env
cp apps/web/.env.example apps/web/.env

# 3) Start PostgreSQL and Redis
pnpm docker:up

# 4) Generate Prisma client
pnpm db:generate

# 5) Build shared package (required before API/worker/web)
pnpm --filter @league-helper/shared build

# 6) Start API, worker, and web
pnpm dev
```

Then open:

- Web: http://localhost:3000
- API health: http://localhost:3001/health

## Useful scripts

```bash
pnpm lint
pnpm format
pnpm typecheck
pnpm test
pnpm build
pnpm docker:down
```

## Notes

- `RIOT_API_KEY` stays in backend/worker env only. It is never exposed through Nuxt public runtime config.
- Mainland Chinese server support is out of scope.
- Riot business logic is not implemented in this scaffold milestone.
