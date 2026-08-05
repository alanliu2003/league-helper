# Milestone 7 UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stabilize the player flow and replace the temporary UI with a League-inspired design system, including backend-provided champion splash URLs.

**Architecture:** Extend Data Dragon media helpers to emit `championSplashUrl` on public mastery DTOs (built at enrichment/mapping time, never stored in PostgreSQL). Frontend consumes those URLs only. Redesign Nuxt shell, homepage, and player page with CSS design tokens and focused components.

**Tech Stack:** NestJS, Prisma, Nuxt 3, Vue 3, Tailwind, Vitest, Playwright, Data Dragon CDN

---

### Task 1: Champion splash URL (backend)

**Files:**

- Modify: `packages/shared/src/player-api.ts`
- Modify: `apps/api/src/integrations/data-dragon/data-dragon.types.ts`
- Modify: `apps/api/src/integrations/data-dragon/data-dragon-champion.service.ts`
- Modify: `apps/api/src/features/players/player-response.mapper.ts`
- Test: `apps/api/src/integrations/data-dragon/data-dragon-champion.service.test.ts`
- Test: `apps/api/src/features/players/player-mastery-enrichment.test.ts`

- [ ] Add `buildChampionSplashUrl` (`/cdn/img/champion/splash/{key}_0.jpg`)
- [ ] Add `championSplashUrl` to `PublicMasterySummary`
- [ ] Map from validated champion asset key; null when unavailable
- [ ] API tests: Tryndamere, `_0.jpg`, DrMundo, unknown → null

### Task 2: Design tokens + app shell

**Files:**

- Modify: `apps/web/assets/css/main.css`
- Create: `apps/web/layouts/default.vue`
- Create: `apps/web/components/layout/AppHeader.vue`, `AppFooter.vue`, `GlobalPlayerSearch.vue`
- Modify: `apps/web/app.vue`

### Task 3: Homepage redesign

**Files:**

- Modify: `apps/web/pages/index.vue`
- Reuse search + recent players; demote health panel

### Task 4: Player page redesign

**Files:**

- Create focused components under `apps/web/components/player/`
- Modify: `apps/web/pages/players/[playerId].vue`
- Hero uses top mastery `championSplashUrl`; featured mastery cards use own splash

### Task 5: Tests + docs + verify

- Frontend component tests, Playwright updates, README design-system section
- format / lint / typecheck / test / build
