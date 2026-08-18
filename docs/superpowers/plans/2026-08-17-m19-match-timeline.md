# Milestone 19 Match Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist deterministic Match-v5 game-flow (kills, objectives, items, skills, gold frames) for eligible matches and expose it on a Timeline tab without bloating M18 overview.

**Architecture:** Keep inline `getTimeline` on match-ingestion and persist M19 product events/frames for eligible matches on that path. Expand `MatchTimelineEvent`, add `MatchTimelineFrame`, and record `productCoverage` on `MatchTimeline`. A separate BullMQ `match-timeline` / `ENRICH_MATCH_TIMELINE` job covers CLI backfill and optional gated search enrich (`MATCH_TIMELINE_SEARCH_BACKFILL_ENABLED`, default false). `GET /api/matches/:id` stays a cheap overview; `GET /api/matches/:id/timeline` is the product DTO. Spec: `docs/superpowers/specs/2026-08-17-m19-match-timeline-design.md`.

**Tech Stack:** pnpm monorepo, TypeScript, Zod, NestJS, Prisma/PostgreSQL, BullMQ, Nuxt 3, Vue 3, Tailwind, Vitest, Playwright. No AI, no Redis cache, no chart library, `MATCH_STORE_RAW_PAYLOADS` stays false.

**Plan decisions (resolve spec ambiguities):**

1. Prisma migration **is required**. Name: `20260817120000_m19_match_timeline_product`.
2. Expand `MatchTimelineEvent` in place (nullable kill/objective columns). Do **not** create a second event table.
3. New `MatchTimelineFrame` table. No frame positions in M19.
4. `TimelineProductCoverage` enum: `NONE | STORED | INELIGIBLE`.
5. Eligibility: any participant with non-null `playerAccountId` at persist time.
6. Extractor allowlist: existing five build types + `CHAMPION_KILL` + `ELITE_MONSTER_KILL` + `BUILDING_KILL`. Drop everything else.
7. API Option A. 404 uses existing `RESOURCE_NOT_FOUND`. Timeline GET is **200** with empty coverage when the match exists.
8. Overview adds cheap `timeline.productCoverage` + `timeline.productAvailable` from the `MatchTimeline` row only. **No** event/frame queries on overview. Exact `{ items, skills, kills, objectives, frames }` lives only on timeline GET.
9. `MATCH_TIMELINE_SEARCH_BACKFILL_ENABLED` defaults **false**. Post-search historical enrichments (cap **20**) enqueue only when true. Inline eligible ingest still persists product rows. CLI backfill always available.
10. GET never enqueues. Worker concurrency default **1**.
11. `killerId === 0` or missing → `killerKind: 'ENVIRONMENT'`, `killer: null`.
12. Gold difference = Blue team gold − Red team gold; null if either side missing. Team/difference series use **complete snapshots only** — never zero-fill missing participant frames.
13. Building `teamId` = **owner** (team that lost the structure). Fixture-lock this.
14. Skill labels: slot 1–4 → Q/W/E/R. `EVOLVE` still listed with `levelUpType` text; do not invent slot 5.
15. SVG polyline gold graph; no new dependency. Timeline UI order: gold graph → filterable event stream → build progression → skill progression.
16. Hash `#timeline` selects the Timeline tab; match cards stay overview links.
17. Do not change `MATCH_TIMELINE_REQUIRED_FOR_COMPLETE` default.
18. Champion-build `select` list stays as-is; mixed event types must still reconstruct items.

---



## File structure (create / modify)



### Create

```text
apps/api/prisma/migrations/20260817120000_m19_match_timeline_product/migration.sql

packages/shared/src/match-timeline.ts
packages/shared/src/match-timeline.test.ts
packages/shared/src/job-queues/match-timeline-job.ts
packages/shared/src/job-queues/match-timeline-job.test.ts

apps/worker/src/queues/match-ingestion/timeline-product-events.ts
apps/worker/src/queues/match-ingestion/timeline-product-events.test.ts
apps/worker/src/queues/match-ingestion/timeline-frames.ts
apps/worker/src/queues/match-ingestion/timeline-frames.test.ts

apps/worker/src/queues/match-timeline/match-timeline.processor.ts
apps/worker/src/queues/match-timeline/match-timeline.processor.test.ts
apps/worker/src/queues/match-timeline/match-timeline.worker.ts
apps/worker/src/cli/backfill-match-timeline.ts

apps/api/src/queues/match-timeline.producer.ts
apps/api/src/queues/match-timeline.producer.test.ts
apps/api/src/features/matches/match-timeline.service.ts
apps/api/src/features/matches/match-timeline.service.test.ts
apps/api/src/features/matches/match-timeline.mapper.ts
apps/api/src/features/matches/match-timeline.mapper.test.ts
apps/api/src/features/matches/matches.timeline.integration.test.ts

apps/web/composables/useMatchTimelinePage.ts
apps/web/composables/useMatchTimelinePage.test.ts
apps/web/components/match/MatchDetailTabs.vue
apps/web/components/match/MatchDetailTabs.test.ts
apps/web/components/match/MatchTimelineSection.vue
apps/web/components/match/MatchEventStream.vue
apps/web/components/match/MatchEventStream.test.ts
apps/web/components/match/MatchKillFeed.vue
apps/web/components/match/MatchKillFeed.test.ts
apps/web/components/match/MatchObjectiveTimeline.vue
apps/web/components/match/MatchObjectiveTimeline.test.ts
apps/web/components/match/MatchItemProgression.vue
apps/web/components/match/MatchItemProgression.test.ts
apps/web/components/match/MatchSkillProgression.vue
apps/web/components/match/MatchSkillProgression.test.ts
apps/web/components/match/MatchGoldGraph.vue
apps/web/components/match/MatchGoldGraph.test.ts
apps/web/e2e/match-timeline.e2e.ts
```



### Modify

```text
apps/api/prisma/schema.prisma
packages/shared/src/index.ts
packages/shared/src/match-detail.ts
packages/shared/src/match-detail.test.ts
packages/shared/src/job-queues/queue-names.ts
packages/shared/src/job-queues/index.ts

apps/worker/src/config.ts
apps/worker/src/queues.test.ts
apps/worker/src/main.ts
apps/worker/src/queues/match-ingestion/timeline-build-events.ts
apps/worker/src/queues/match-ingestion/match-persistence.ts
apps/worker/src/queues/match-ingestion/match-persistence.test.ts
apps/worker/src/queues/match-ingestion/match-ingestion.processor.ts
apps/worker/src/queues/match-ingestion/match-ingestion.processor.test.ts
apps/worker/src/queues/match-ingestion/test-utils/ranked-match-fixture.ts
packages/match-analytics/src/builds/item-reconstruction.test.ts

apps/api/src/config/player-refresh.config.ts
apps/api/src/queues/queue.tokens.ts
apps/api/src/queues/queues.module.ts
apps/api/src/persistence/match.repository.ts
apps/api/src/persistence/match.repository.detail.test.ts
apps/api/src/features/matches/matches.module.ts
apps/api/src/features/matches/matches.controller.ts
apps/api/src/features/matches/match-detail.mapper.ts
apps/api/src/features/matches/match-detail.mapper.test.ts
apps/api/src/features/matches/matches.integration.test.ts
apps/api/src/features/players/bootstrap/enqueue-discovered-matches.ts
apps/api/src/features/players/bootstrap/enqueue-discovered-matches.test.ts

apps/web/composables/useMatchApi.ts
apps/web/composables/useMatchDetailPage.ts
apps/web/pages/matches/[matchId].vue
apps/web/components/match/match-detail.fixture.ts
apps/web/assets/css/main.css          # only if tab styles need a token already used elsewhere

.env.example
apps/worker/.env.example
apps/api/.env.example                 # only if API producer needs MATCH_TIMELINE_* (queue name + attempts)
README.md
```

Do **not** modify: population collector, AI queues, `MATCH_STORE_RAW_PAYLOADS` default, M18 early-game section behavior, champion-aggregation select list (except tests that add mixed events).

---



### Task 1: Shared public timeline DTO

**Files:**

- Create: `packages/shared/src/match-timeline.ts`
- Create: `packages/shared/src/match-timeline.test.ts`
- Modify: `packages/shared/src/match-detail.ts` (`PublicMatchTimelineSchema.productCoverage` + `productAvailable`)
- Modify: `packages/shared/src/match-detail.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write failing tests for objective/gold helpers + incomplete frames**

```ts
import { describe, expect, it } from 'vitest';
import {
  PublicMatchTimelineDetailSchema,
  deriveTeamGoldSeries,
  mapPublicObjectiveType,
  publicSkillSlotLabel,
} from './match-timeline';

describe('mapPublicObjectiveType', () => {
  it('maps known elite monsters and buildings', () => {
    expect(mapPublicObjectiveType({ monsterType: 'DRAGON' })).toBe('dragon');
    expect(mapPublicObjectiveType({ monsterType: 'BARON_NASHOR' })).toBe('baron');
    expect(mapPublicObjectiveType({ monsterType: 'RIFTHERALD' })).toBe('riftHerald');
    expect(mapPublicObjectiveType({ buildingType: 'TOWER_BUILDING' })).toBe('tower');
    expect(mapPublicObjectiveType({ buildingType: 'INHIBITOR_BUILDING' })).toBe('inhibitor');
  });

  it('returns null for unknown or newer types', () => {
    expect(mapPublicObjectiveType({ monsterType: 'HORDE' })).toBeNull();
    expect(mapPublicObjectiveType({ monsterType: 'ATAKHAN' })).toBeNull();
    expect(mapPublicObjectiveType({})).toBeNull();
  });
});

describe('deriveTeamGoldSeries', () => {
  it('sums by team and differences blue minus red for complete snapshots', () => {
    const derived = deriveTeamGoldSeries({
      participants: [
        { participantId: 1, teamId: 100 },
        { participantId: 6, teamId: 200 },
      ],
      frames: [
        { timestampMs: 0, participantId: 1, totalGold: 500 },
        { timestampMs: 0, participantId: 6, totalGold: 500 },
        { timestampMs: 60_000, participantId: 1, totalGold: 1200 },
        { timestampMs: 60_000, participantId: 6, totalGold: 900 },
      ],
    });
    expect(derived.timestampsMs).toEqual([0, 60_000]);
    expect(derived.difference).toEqual([0, 300]);
  });

  it('omits incomplete timestamps instead of zero-filling missing participants', () => {
    const derived = deriveTeamGoldSeries({
      participants: [
        { participantId: 1, teamId: 100 },
        { participantId: 6, teamId: 200 },
      ],
      frames: [
        { timestampMs: 0, participantId: 1, totalGold: 500 },
        { timestampMs: 0, participantId: 6, totalGold: 500 },
        // incomplete: participant 6 missing at 60s — must NOT become 1200 vs 0
        { timestampMs: 60_000, participantId: 1, totalGold: 1200 },
        { timestampMs: 120_000, participantId: 1, totalGold: 1800 },
        { timestampMs: 120_000, participantId: 6, totalGold: 1500 },
      ],
    });
    expect(derived.timestampsMs).toEqual([0, 120_000]);
    expect(derived.difference).toEqual([0, 300]);
    expect(derived.timestampsMs).not.toContain(60_000);
  });
});

describe('publicSkillSlotLabel', () => {
  it('maps 1-4 to QWER', () => {
    expect(publicSkillSlotLabel(1)).toBe('Q');
    expect(publicSkillSlotLabel(4)).toBe('R');
    expect(publicSkillSlotLabel(5)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @league-helper/shared test -- src/match-timeline.test.ts`

Expected: FAIL (module not found)

- [ ] **Step 3: Implement schemas and helpers**

In `packages/shared/src/match-timeline.ts`:

```ts
import { z } from 'zod';
import { ChampionBuildStaticIdentitySchema } from './champion-builds';
import { NormalizedPositionSchema } from './normalized-position';
import { RiotIdSchema } from './riot-id';
import { PublicMatchTeamSideSchema, matchTeamSide } from './match-detail';

export const PublicMatchTimelineCoverageSchema = z.object({
  items: z.boolean(),
  skills: z.boolean(),
  kills: z.boolean(),
  objectives: z.boolean(),
  frames: z.boolean(),
});

export const PERSISTED_TIMELINE_EVENT_TYPES = [
  'ITEM_PURCHASED',
  'ITEM_SOLD',
  'ITEM_UNDO',
  'ITEM_DESTROYED',
  'SKILL_LEVEL_UP',
  'CHAMPION_KILL',
  'ELITE_MONSTER_KILL',
  'BUILDING_KILL',
] as const;

export const PublicMatchTimelineEventTypeSchema = z.enum(PERSISTED_TIMELINE_EVENT_TYPES);

export const PublicMatchTimelineParticipantSchema = z.object({
  participantId: z.number().int().positive(),
  teamId: z.number().int(),
  side: PublicMatchTeamSideSchema,
  playerId: z.string().uuid().nullable(),
  riotId: RiotIdSchema.nullable(),
  championId: z.number().int(),
  championKey: z.string().min(1).nullable(),
  championName: z.string().min(1).nullable(),
  championIconUrl: z.string().url().nullable(),
  teamPosition: NormalizedPositionSchema,
});

export const PublicMatchPositionSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
});

export const PublicMatchTimelineEventSchema = z.object({
  eventIndex: z.number().int().nonnegative(),
  timestampMs: z.number().int().nonnegative(),
  type: PublicMatchTimelineEventTypeSchema,
  participantId: z.number().int().nullable(),
  killerParticipantId: z.number().int().nullable(),
  victimParticipantId: z.number().int().nullable(),
  assistingParticipantIds: z.array(z.number().int()),
  teamId: z.number().int().nullable(),
  itemId: z.number().int().nullable(),
  beforeItemId: z.number().int().nullable(),
  afterItemId: z.number().int().nullable(),
  skillSlot: z.number().int().nullable(),
  levelUpType: z.string().nullable(),
  monsterType: z.string().nullable(),
  monsterSubType: z.string().nullable(),
  buildingType: z.string().nullable(),
  towerType: z.string().nullable(),
  laneType: z.string().nullable(),
  position: PublicMatchPositionSchema.nullable(),
  item: ChampionBuildStaticIdentitySchema.nullable(),
  skillLabel: z.enum(['Q', 'W', 'E', 'R']).nullable(),
});

export const PublicMatchKillEventSchema = z.object({
  timestampMs: z.number().int().nonnegative(),
  killerKind: z.enum(['CHAMPION', 'ENVIRONMENT']),
  killerParticipantId: z.number().int().nullable(),
  victimParticipantId: z.number().int(),
  assistingParticipantIds: z.array(z.number().int()),
  position: PublicMatchPositionSchema.nullable(),
});

export const PublicMatchObjectiveEventTypeSchema = z.enum([
  'dragon',
  'baron',
  'riftHerald',
  'tower',
  'inhibitor',
]);

export const PublicMatchObjectiveEventSchema = z.object({
  timestampMs: z.number().int().nonnegative(),
  type: PublicMatchObjectiveEventTypeSchema,
  killerKind: z.enum(['CHAMPION', 'ENVIRONMENT']),
  killerParticipantId: z.number().int().nullable(),
  assistingParticipantIds: z.array(z.number().int()),
  ownerTeamId: z.number().int().nullable(),
  killerTeamId: z.number().int().nullable(),
  monsterSubType: z.string().nullable(),
  towerType: z.string().nullable(),
  laneType: z.string().nullable(),
  position: PublicMatchPositionSchema.nullable(),
});

export const PublicMatchTimelineFrameSchema = z.object({
  timestampMs: z.number().int().nonnegative(),
  participantId: z.number().int().positive(),
  totalGold: z.number().int().nonnegative(),
  xp: z.number().int().nonnegative(),
  cs: z.number().int().nonnegative(),
  level: z.number().int().nonnegative(),
});

export const PublicMatchGoldSeriesSchema = z.object({
  timestampsMs: z.array(z.number().int().nonnegative()),
  teams: z.array(
    z.object({
      teamId: z.number().int(),
      side: PublicMatchTeamSideSchema,
      gold: z.array(z.number().int().nonnegative()),
    }),
  ),
  participants: z.array(
    z.object({
      participantId: z.number().int().positive(),
      gold: z.array(z.number().int().nonnegative()),
    }),
  ),
  difference: z.array(z.number().int()).nullable(),
});

export const PublicMatchTimelineDetailSchema = z.object({
  matchId: z.string().uuid(),
  status: z.enum(['PENDING', 'AVAILABLE', 'UNAVAILABLE']),
  coverage: PublicMatchTimelineCoverageSchema,
  frameIntervalMs: z.number().int().positive().nullable(),
  participants: z.array(PublicMatchTimelineParticipantSchema),
  events: z.array(PublicMatchTimelineEventSchema),
  frames: z.array(PublicMatchTimelineFrameSchema),
  derived: z.object({
    kills: z.array(PublicMatchKillEventSchema),
    objectives: z.array(PublicMatchObjectiveEventSchema),
    gold: PublicMatchGoldSeriesSchema,
  }),
});
```



Implement `mapPublicObjectiveType`, `deriveTeamGoldSeries` (complete snapshots only for team/difference — never treat missing frames as 0), `publicSkillSlotLabel`, and `coverageFromEventAndFrameRows()` for the **timeline** endpoint only.

`deriveTeamGoldSeries` contract: for each distinct `timestampMs`, include it in team/`difference` arrays only when every required participant id has a frame at that timestamp; omit incomplete timestamps entirely.

Extend `PublicMatchTimelineSchema` in `match-detail.ts`:

```ts
export const PublicMatchProductCoverageSchema = z.enum(['NONE', 'STORED', 'INELIGIBLE']);

export const PublicMatchTimelineSchema = z.object({
  status: PublicMatchTimelineStatusSchema,
  metricsAvailable: z.boolean(),
  productCoverage: PublicMatchProductCoverageSchema,
  productAvailable: z.boolean(),
});
```

Keep `PublicMatchTimelineCoverageSchema` (items/skills/kills/objectives/frames) in `match-timeline.ts` for the timeline detail DTO only — **not** on overview.

Export new symbols from `packages/shared/src/index.ts`.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @league-helper/shared test -- src/match-timeline.test.ts src/match-detail.test.ts`

Expected: PASS. Update any existing `PublicMatchDetail` fixtures that omit `productCoverage` / `productAvailable` (match-detail tests + web fixture in later tasks if they fail now — fix fixtures in this task if they live in shared).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/match-timeline.ts packages/shared/src/match-timeline.test.ts packages/shared/src/match-detail.ts packages/shared/src/match-detail.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): add public match timeline DTO"
```

---



### Task 2: Prisma schema and migration

**Files:**

- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260817120000_m19_match_timeline_product/migration.sql`

- [ ] **Step 1: Add enum, columns, and** `MatchTimelineFrame`

```prisma
enum TimelineProductCoverage {
  NONE
  STORED
  INELIGIBLE
}

model MatchTimeline {
  // existing fields...
  productCoverage     TimelineProductCoverage @default(NONE)
  frameIntervalMs     Int?
  productNormalizedAt DateTime?               @db.Timestamptz(3)
}

model MatchTimelineEvent {
  // existing fields...
  killerParticipantId     Int?
  victimParticipantId     Int?
  assistingParticipantIds Int[]    @default([])
  teamId                  Int?
  positionX               Int?
  positionY               Int?
  monsterType             String?
  monsterSubType          String?
  buildingType            String?
  towerType               String?
  laneType                String?
}

model MatchTimelineFrame {
  id            String   @id @default(uuid())
  matchId       String
  timestampMs   Int
  participantId Int
  totalGold     Int
  xp            Int
  cs            Int
  level         Int
  createdAt     DateTime @default(now()) @db.Timestamptz(3)

  match Match @relation(fields: [matchId], references: [id], onDelete: Cascade)

  @@unique([matchId, timestampMs, participantId])
  @@index([matchId, timestampMs])
}
```

Add `timelineFrames MatchTimelineFrame[]` on `Match`.

Keep `MatchTimelineEvent` comment updated: persisted types are build + kill + elite monster + building.

- [ ] **Step 2: Write migration SQL** (hand-written to match repo style; do not use a destructive reset)

```sql
-- M19 product timeline: kill/objective event columns + compact frames.
-- Does not backfill historical events (requires Riot re-fetch via match-timeline jobs).

CREATE TYPE "TimelineProductCoverage" AS ENUM ('NONE', 'STORED', 'INELIGIBLE');

ALTER TABLE "MatchTimeline"
ADD COLUMN "productCoverage" "TimelineProductCoverage" NOT NULL DEFAULT 'NONE',
ADD COLUMN "frameIntervalMs" INTEGER,
ADD COLUMN "productNormalizedAt" TIMESTAMPTZ(3);

ALTER TABLE "MatchTimelineEvent"
ADD COLUMN "killerParticipantId" INTEGER,
ADD COLUMN "victimParticipantId" INTEGER,
ADD COLUMN "assistingParticipantIds" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN "teamId" INTEGER,
ADD COLUMN "positionX" INTEGER,
ADD COLUMN "positionY" INTEGER,
ADD COLUMN "monsterType" TEXT,
ADD COLUMN "monsterSubType" TEXT,
ADD COLUMN "buildingType" TEXT,
ADD COLUMN "towerType" TEXT,
ADD COLUMN "laneType" TEXT;

CREATE TABLE "MatchTimelineFrame" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "timestampMs" INTEGER NOT NULL,
    "participantId" INTEGER NOT NULL,
    "totalGold" INTEGER NOT NULL,
    "xp" INTEGER NOT NULL,
    "cs" INTEGER NOT NULL,
    "level" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MatchTimelineFrame_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MatchTimelineFrame_matchId_timestampMs_participantId_key"
ON "MatchTimelineFrame"("matchId", "timestampMs", "participantId");

CREATE INDEX "MatchTimelineFrame_matchId_timestampMs_idx"
ON "MatchTimelineFrame"("matchId", "timestampMs");

ALTER TABLE "MatchTimelineFrame"
ADD CONSTRAINT "MatchTimelineFrame_matchId_fkey"
FOREIGN KEY ("matchId") REFERENCES "Match"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
```

Frames FK to `Match` only. Do not add a second FK to `MatchTimeline`.

- [ ] **Step 3: Generate client and validate**

Run:

```bash
pnpm --filter api exec prisma validate
pnpm --filter api exec prisma generate
```

Expected: valid schema, client includes new fields.

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20260817120000_m19_match_timeline_product
git commit -m "feat(db): add product timeline event columns and frames"
```

---



### Task 3: Product event + frame extractors

**Files:**

- Create: `apps/worker/src/queues/match-ingestion/timeline-product-events.ts`
- Create: `apps/worker/src/queues/match-ingestion/timeline-product-events.test.ts`
- Create: `apps/worker/src/queues/match-ingestion/timeline-frames.ts`
- Create: `apps/worker/src/queues/match-ingestion/timeline-frames.test.ts`
- Modify: `apps/worker/src/queues/match-ingestion/test-utils/ranked-match-fixture.ts` (add BUILDING_KILL + ELITE_MONSTER_KILL + positions to `buildRichTimelineDto`)

- [ ] **Step 1: Write failing extractor tests**

Use `buildRichTimelineDto` plus extra events:

- `CHAMPION_KILL` with `killerId: 6`, `victimId: 1`, `assistingParticipantIds: [7]`, `position: { x: 100, y: 200 }`
- `CHAMPION_KILL` with `killerId: 0` (environment)
- `ELITE_MONSTER_KILL` `monsterType: 'DRAGON'`, `monsterSubType: 'FIRE_DRAGON'`, `killerId: 2`, `killerTeamId: 100`
- `BUILDING_KILL` `buildingType: 'TOWER_BUILDING'`, `towerType: 'OUTER_TURRET'`, `laneType: 'TOP_LANE'`, `teamId: 200`, `killerId: 1`
- `WARD_PLACED` and `TURRET_PLATE_DESTROYED` must be absent from output
- `ITEM_*` / `SKILL_LEVEL_UP` still present
- `eventIndex` is 0..n-1 in flatten order

Frame test: 0/10/15 minute frames × 10 participants; `cs = minionsKilled + jungleMinionsKilled`; skip empty participantFrames.

- [ ] **Step 2: Run tests — expect FAIL**

Run: `pnpm --filter worker test -- src/queues/match-ingestion/timeline-product-events.test.ts src/queues/match-ingestion/timeline-frames.test.ts`

- [ ] **Step 3: Implement extractors**

`extractPersistedTimelineEvents(events: RiotTimelineEventDto[]): PersistedTimelineEvent[]`

Allowlist the eight types. Map:

```ts
killerParticipantId: asOptionalInt(event.killerId)
victimParticipantId: asOptionalInt(event.victimId)
assistingParticipantIds: Array.isArray(event.assistingParticipantIds)
  ? event.assistingParticipantIds.filter((id) => Number.isInteger(id))
  : []
teamId: asOptionalInt(event.teamId) ?? asOptionalInt(record.killerTeamId)
positionX/Y from event.position
```

Do not copy unknown fields. Do not keep `metadata.participants`.

`extractTimelineFrames(frames: RiotTimelineFrameDto[]): TimelineFrameRow[]` — reuse `readParticipantFrame` gold/cs/xp formula from `timeline-metrics.service.ts`. **Extract a shared** `readParticipantFrameStats` **into** `timeline-frame-stats.ts` **if copying more than 15 lines**; otherwise duplicate the small reader to avoid a risky refactor. Prefer extract if both files would drift.

Keep `extractBuildRelevantTimelineEvents` for now **or** replace call sites with a filter of `extractPersistedTimelineEvents` for ITEM_*/SKILL. Locked: one extractor (`extractPersistedTimelineEvents`) is the persist path; `extractBuildRelevantTimelineEvents` may wrap it for existing tests or be deleted once tests move. Prefer wrap to avoid breaking champion-build tests in the same commit.

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(worker): extract kill, objective, and frame timeline rows"
```

---



### Task 4: Persist product rows from match ingestion

**Files:**

- Modify: `apps/worker/src/queues/match-ingestion/match-persistence.ts`
- Modify: `apps/worker/src/queues/match-ingestion/match-persistence.test.ts`
- Modify: `apps/worker/src/queues/match-ingestion/match-ingestion.processor.ts`
- Modify: `apps/worker/src/queues/match-ingestion/match-ingestion.processor.test.ts`

- [ ] **Step 1: Failing persistence tests**

1. Eligible match (one `playerAccountId` linked) + FETCHED timeline → `productCoverage=STORED`, N frame rows, CHAMPION_KILL rows present, ITEM rows still present.
2. Ineligible (all `playerAccountId` null) → `INELIGIBLE`, zero frames, **no** CHAMPION_KILL rows, ITEM/SKILL still written.
3. Replace: second persist with fewer events deletes old rows (unique `eventIndex` holds).
4. Timeline FAILED → `productCoverage=NONE`, no frames.

Eligibility helper:

```ts
export function isProductTimelineEligible(
  participants: { playerAccountId?: string | null }[],
): boolean {
  return participants.some((p) => Boolean(p.playerAccountId));
}
```

Pass eligibility from the processor using **persisted** participant links (the `accountLinks` already resolved before timeline fetch).

- [ ] **Step 2: Extend** `persistTimelineAndMetrics`

Add args: `productEvents?: PersistedTimelineEvent[]`, `frames?: TimelineFrameRow[]`, `productCoverage`, `frameIntervalMs`.

In the same transaction as today:

1. Upsert `MatchTimeline` including new columns; set `productNormalizedAt` when coverage is `STORED`
2. If `productEvents !== undefined` **or** existing `buildEvents` path: `deleteMany` events then `createMany` of the **full persisted list** (processor should pass one list)
3. `deleteMany` frames for match then `createMany` when `frames` provided; when ineligible pass `frames: []` and still delete leftover frames

Locked persist list: processor always passes `extractPersistedTimelineEvents` filtered:

- eligible: all eight types
- ineligible: only the five build types (filter)

- [ ] **Step 3: Wire processor after successful** `normalizeTimeline`

```ts
const persistedEvents = extractPersistedTimelineEvents(timeline.events);
const eligible = isProductTimelineEligible(
  normalized.participants.map((p) => ({
    playerAccountId: accountLinks.get(p.externalAccountId ?? '') ?? null,
  })),
);
const eventsToStore = eligible
  ? persistedEvents
  : persistedEvents.filter((e) => BUILD_TYPE_SET.has(e.type));
const framesToStore = eligible ? extractTimelineFrames(timeline.frames) : [];
```

Fix the accountLinks lookup to match the real `resolvePlayerAccountLinks` return shape (map external id → account id). Read that function before coding; do not invent a Map API.

On timeline skip/fail: `productCoverage=NONE`, do not pass product frames.

- [ ] **Step 4: Processor tests**

- Eligible ranked fixture: `getTimeline` called once; frames stored
- Ineligible: no frames
- Existing 429 soft-fail test still COMPLETE + FAILED timeline + `productCoverage=NONE`
- Champion aggregation still enqueued (do not skip)

- [ ] **Step 5: Run worker tests**

Run:

```bash
pnpm --filter worker test -- src/queues/match-ingestion/match-persistence.test.ts src/queues/match-ingestion/match-ingestion.processor.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(worker): persist product timeline events and frames for eligible matches"
```

---



### Task 5: Champion-build safety with mixed events

**Files:**

- Modify: `packages/match-analytics/src/builds/item-reconstruction.test.ts`
- Modify: `apps/worker/src/queues/champion-build-aggregation/rebuild-core.test.ts` (add a CHAMPION_KILL row to an existing fixture)

- [ ] **Step 1: Test that unknown/kill types do not change inventory**

```ts
it('ignores CHAMPION_KILL when reconstructing inventory', () => {
  const inventory = reconstructItemInventory([
    event({ type: 'ITEM_PURCHASED', itemId: 1001, eventIndex: 0 }),
    event({ type: 'CHAMPION_KILL', itemId: null, eventIndex: 1, timestampMs: 1 }),
    event({ type: 'ITEM_PURCHASED', itemId: 1036, eventIndex: 2, timestampMs: 2 }),
  ]);
  expect(inventory).toEqual([1001, 1036]);
});
```

`default: break` already exists — this test should pass. If rebuild-core filters by participant only and would count extra rows toward eligibility, add a type filter there **only if a test fails**. Do not preemptively rewrite aggregation.

- [ ] **Step 2: Run**

```bash
pnpm --filter @league-helper/match-analytics test -- src/builds/item-reconstruction.test.ts
pnpm --filter worker test -- src/queues/champion-build-aggregation/rebuild-core.test.ts
```

- [ ] **Step 3: Commit only if files changed**

```bash
git commit -m "test(builds): ignore kill events during item reconstruction"
```

---



### Task 6: Match-timeline job contract + worker

**Files:**

- Modify: `packages/shared/src/job-queues/queue-names.ts`, `index.ts`
- Create: `packages/shared/src/job-queues/match-timeline-job.ts` + test
- Modify: `apps/worker/src/config.ts`, `queues.test.ts`, `main.ts`
- Create: worker processor/worker files listed above
- Modify: `.env.example`, `apps/worker/.env.example`

- [ ] **Step 1: Queue names and payload**

```ts
export const MATCH_TIMELINE_QUEUE_NAME = 'match-timeline' as const;
export const MATCH_TIMELINE_JOB_NAME = 'ENRICH_MATCH_TIMELINE' as const;

export const MatchTimelineJobPayloadSchema = z.object({
  matchId: z.string().uuid(),
  correlationId: z.string().min(1).max(128).optional(),
  includeIneligible: z.boolean().optional(), // CLI only; API producer always omits/false
});

export function buildMatchTimelineBullMqJobId(input: { matchId: string }): string {
  return `tl_${input.matchId}`.slice(0, 128);
}
```

Job id is the internal match UUID. Never put Riot match id or PUUID in the payload.

Config defaults:

```
MATCH_TIMELINE_QUEUE_NAME=match-timeline
MATCH_TIMELINE_WORKER_CONCURRENCY=1
MATCH_TIMELINE_JOB_ATTEMPTS=5
MATCH_TIMELINE_BACKOFF_BASE_MS=2000
MATCH_TIMELINE_BACKOFF_MAX_MS=60000
```

Document on API env examples (Task 7/11): `MATCH_TIMELINE_SEARCH_BACKFILL_ENABLED=false` — not a worker ingest flag; gates historical search enqueue only.

- [ ] **Step 2: Processor behavior tests**


| Case                                   | Expected                                                                                |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| Unknown matchId                        | UnrecoverableError                                                                      |
| `productCoverage=STORED`               | no `getTimeline`; success skip                                                          |
| `FETCHED` + `NONE` + eligible          | `getTimeline`, persist STORED                                                           |
| ineligible + `includeIneligible` false | skip persist product; no Riot call                                                      |
| 404                                    | `fetchStatus=FAILED`; UnrecoverableError                                                |
| 429                                    | publish shared cooldown; DelayedError / rethrow ProviderRateLimitedError like ingestion |
| 5xx                                    | retryable throw                                                                         |


Reuse `classifyIngestionError`, `normalizeTimeline`, extractors, `persistTimelineAndMetrics`. **Do not** call `getMatch` or rewrite participants.

Load `externalMatchId` + `regionalRoute` from Prisma inside the worker only; they never leave the job payload.

- [ ] **Step 3: Register worker in** `main.ts` next to match-ingestion (same Redis connection, `withRiotWorkload('match')`).

- [ ] **Step 4: Run**

```bash
pnpm --filter @league-helper/shared test -- src/job-queues/match-timeline-job.test.ts
pnpm --filter worker test -- src/queues/match-timeline src/queues.test.ts
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(worker): add match-timeline enrichment queue"
```

---



### Task 7: API producer + gated post-search enqueue (cap 20)

**Files:**

- Create: `apps/api/src/queues/match-timeline.producer.ts` + test
- Modify: `queue.tokens.ts`, `queues.module.ts`, `player-refresh.config.ts` (attempts + queue name + `matchTimelineSearchBackfillEnabled`)
- Modify: `enqueue-discovered-matches.ts` + test
- Modify: `apps/api/src/persistence/match.repository.ts` — add `listRecentEligibleMatchesMissingProductTimeline`
- Modify: `.env.example`, `apps/api/.env.example`

- [ ] **Step 1: Repository query**

```ts
async listRecentMatchesMissingProductTimeline(input: {
  playerAccountId: string;
  limit: number; // 20
}): Promise<{ id: string }[]> {
  return this.prisma.match.findMany({
    where: {
      ingestionStatus: 'COMPLETED',
      participants: { some: { playerAccountId: input.playerAccountId } },
      OR: [
        { timeline: null },
        { timeline: { productCoverage: { not: 'STORED' } } },
      ],
    },
    orderBy: [{ gameCreation: 'desc' }, { id: 'desc' }],
    take: input.limit,
    select: { id: true },
  });
}
```

Do **not** filter by queue id.

- [ ] **Step 2: Producer** — copy `ChampionAiInsightProducer` live-state dedupe; job name `ENRICH_MATCH_TIMELINE`; payload `{ matchId }`. Redis errors → `published: false` (search must still 200).

- [ ] **Step 3: Gate search enqueue**

Config:

```ts
matchTimelineSearchBackfillEnabled: parseBoolean(
  env.MATCH_TIMELINE_SEARCH_BACKFILL_ENABLED,
  false,
  'MATCH_TIMELINE_SEARCH_BACKFILL_ENABLED',
)
```

In `enqueueDiscoveredMatches`, after match publication logic:

```ts
if (deps.matchTimelineSearchBackfillEnabled) {
  const missing = await deps.matches.listRecentMatchesMissingProductTimeline({
    playerAccountId: account.id,
    limit: 20,
  });
  for (const row of missing) {
    await deps.timelineProducer.enqueueEnrichment({ matchId: row.id, correlationId });
  }
}
```

When the flag is **false** (default): skip the list query and enqueue entirely. Inline eligible ingest product persist is unchanged (worker path). CLI backfill is unchanged.

Tests:

- Flag false → zero timeline enrich jobs even when 50 matches are missing coverage
- Flag true → linking/search enqueues at most 20 jobs
- GET path is not involved
- Dry-run bootstrap still must not call this helper (existing dry-run tests)

- [ ] **Step 4: Run API unit tests for producer + enqueue-discovered-matches**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(api): gate historical timeline enrichment behind search backfill flag"
```

---



### Task 8: Cheap overview productCoverage + timeline GET

**Files:**

- Modify: `match.repository.ts` (`matchDetailSelect` add `productCoverage`; new timeline detail select for events/frames)
- Modify: `match-detail.mapper.ts` + tests + integration test fixtures (add `productCoverage` / `productAvailable`)
- Modify: `matches.controller.ts`, `matches.module.ts`
- Create: mapper/service/tests listed above
- Create: `matches.timeline.integration.test.ts`

- [ ] **Step 1: Cheap overview fields only**

```ts
timeline: {
  select: {
    fetchStatus: true,
    productCoverage: true,
  },
}
```

Mapper (overview):

```ts
timeline: {
  status: mapTimelineStatus(row.timeline?.fetchStatus),
  metricsAvailable: row.participants.some((p) => participantHasTimelineMetrics(p)),
  productCoverage: row.timeline?.productCoverage ?? 'NONE',
  productAvailable: row.timeline?.productCoverage === 'STORED',
}
```

**Forbidden on overview path:** `MatchTimelineEvent.groupBy`, `MatchTimelineFrame.findFirst`, loading all events, or computing `{ items, skills, kills, objectives, frames }`.

Update every `PublicMatchDetail` fixture with:

```ts
timeline: {
  status: '...',
  metricsAvailable: ...,
  productCoverage: 'NONE', // or STORED / INELIGIBLE as appropriate
  productAvailable: false,
}
```

- [ ] **Step 2:** `GET :matchId/timeline`

Controller:

```ts
@Get(':matchId/timeline')
getMatchTimeline(@Param('matchId', ParseUUIDPipe) matchId: string) {
  return this.matchTimeline.getTimeline(matchId);
}
```

Service:

1. `findDetailById` — if null, `ResourceNotFoundError`
2. Load events + frames by matchId (no `rawPayload`, no `externalAccountId`)
3. Compute exact `coverage` from those loaded rows (`coverageFromEventAndFrameRows`)
4. Map participants with existing static lookups (reuse `loadMatchStaticLookups` + champion/item icons)
5. `assertNoPuuidLeak` + `PublicMatchTimelineDetailSchema.parse`

Mapper rules:

- Join participantId → public ref
- Kill: skip if victim participant missing
- `killerId` 0/null → ENVIRONMENT
- Objectives: skip if `mapPublicObjectiveType` is null
- `BUILDING_KILL.teamId` → `ownerTeamId`; `killerTeamId` from killer participant team when champion killer
- Gold via `deriveTeamGoldSeries` (complete snapshots only)
- Sort events by `timestampMs`, `eventIndex`

Leak test: repository mock with `externalAccountId: 'puuid-looking'` must not appear in JSON.

Integration: seed FETCHED + mixed events + frames → 200 schema parse with exact coverage; unknown uuid → 404; no enqueue; overview request must not hit event/frame tables (mapper/repo unit assertion or spy).

- [ ] **Step 3: Confirm overview integration tests still pass**

```bash
pnpm --filter api test -- src/features/matches
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(api): add match timeline endpoint and cheap overview productCoverage"
```

---



### Task 9: Frontend Timeline tab

**Files:** listed in Create/Modify web section

- [ ] **Step 1:** `useMatchApi().getTimeline(matchId)` parses `PublicMatchTimelineDetailSchema`

- [ ] **Step 2:** `MatchDetailTabs` — two tabs, `role="tablist"`. Selecting Timeline calls `getTimeline` once (cache on the page controller). `#timeline` on load selects Timeline.

- [ ] **Step 3: Empty states** from spec §12. Layout order locked:

1. `MatchGoldGraph`
2. `MatchEventStream` (chips: All | Kills | Objectives | Items | Skills; kill/objective as stream row renderers)
3. `MatchItemProgression` (Build Progression)
4. `MatchSkillProgression`

Overview content remains the current page body.

- [ ] **Step 4: Kill feed format**

`02:14 Blue Top · Tryndamere kills Red Top · Aatrox`

Use `matchTeamSide` + `getNormalizedPositionLabel` + champion name. Environment killer: `02:14 Environment kills Red Top · Aatrox`.

Timestamp: `mm:ss` from `timestampMs` (floor). Same helper as duration formatting if one exists; otherwise a local `formatMatchClock(ms)`.

- [ ] **Step 5: Item/skill sections** — origin participant first when `originPlayerId` matches `playerId`. Use `event.item` (name/icon from API static lookup) and `event.skillLabel`. Do not construct Data Dragon URLs in Vue.

- [ ] **Step 6: Gold graph** — SVG viewBox, two team polylines + difference. Hide entire component when timeline `coverage.frames === false`. `aria-label="Team gold over time"`. No legend color-only: include text labels “Blue”, “Red”.

- [ ] **Step 7: Unit tests** for kill copy, tab selection, graph hidden, event filters, layout order.

- [ ] **Step 8: Playwright** `match-timeline.e2e.ts` — mock both GET overview and GET timeline (extend `match-detail.e2e.ts` pattern). Assert Overview still shows teams; Timeline tab shows kill feed text or the “not stored” empty state from the fixture.

- [ ] **Step 9: Run**

```bash
pnpm --filter web test -- src/components/match src/composables/useMatchTimelinePage.test.ts
pnpm --filter web test -- e2e/match-timeline.e2e.ts
```

Use the repo’s actual web test commands (check `apps/web/package.json`). Playwright may be `pnpm --filter web e2e`.

- [ ] **Step 10: Commit**

```bash
git commit -m "feat(web): add match timeline tab, kill feed, and gold graph"
```

---



### Task 10: Ops CLI backfill

**Files:**

- Create: `apps/worker/src/cli/backfill-match-timeline.ts`
- Modify: worker CLI entry if there is a command index (search `apps/worker/src/cli`); follow `retry-match-ingestion.ts` pattern

- [ ] **Step 1: CLI flags**

`--limit` (required, max 500), `--since` ISO date optional, `--dry-run`. Default `--include-ineligible` off (`includeIneligible=false`).

Select `COMPLETED` matches with a linked participant and `productCoverage != STORED`, oldest or newest — **locked: newest first** (product users). Enqueue `ENRICH_MATCH_TIMELINE`. Dry-run prints counts only (no PUUID, no full Riot ids in logs — use truncated external id if needed, same as ingestion `log-safe`).

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(worker): add match timeline backfill CLI"
```

---



### Task 11: README and env examples

**Files:** `.env.example`, `apps/worker/.env.example`, `apps/api/.env.example` if the API reads queue name, `README.md`

Document:

- `GET /api/matches/:matchId/timeline`
- Timeline tab on `/matches/:matchId#timeline` (gold → event stream → build/skill)
- New env vars and defaults, including `MATCH_TIMELINE_SEARCH_BACKFILL_ENABLED=false` (Riot budget protection; enable later with production capacity)
- Inline eligible ingest still persists product timeline without that flag
- `MATCH_STORE_RAW_PAYLOADS` remains false
- Product coverage is eligible-match only; historical data needs CLI backfill and/or enabling the search flag

- [ ] **Step 1: Update docs**
- [ ] **Step 2: Commit**

```bash
git commit -m "docs: document match timeline API and worker queue"
```

---



### Task 12: Full verification

- [ ] **Step 1: Format / lint / typecheck / tests**

```bash
pnpm -r typecheck
pnpm -r lint
pnpm --filter @league-helper/shared test
pnpm --filter worker test -- src/queues/match-ingestion src/queues/match-timeline src/queues/champion-build-aggregation/rebuild-core.test.ts
pnpm --filter api test -- src/features/matches src/features/players/bootstrap/enqueue-discovered-matches.test.ts src/queues/match-timeline.producer.test.ts
pnpm --filter web test
```

Apply `prisma migrate` against the local compose DB before API integration tests if the suite uses a real Postgres.

Fix only failures caused by this milestone.

- [ ] **Step 2: Manual smoke (report in PR, do not skip)**

1. Search a tracked player, open a completed match overview (M18 still works; overview has `productCoverage`, not per-feature coverage)
2. Open Timeline tab — if the match was ingested after this change and is eligible, kills/items appear
3. Historical match with search backfill off: empty-state, not a crash; no burst of enrich jobs from search
4. Confirm network tab: overview request does not include hundreds of events; timeline request is separate
5. Confirm response JSON has no `puuid` / `externalAccountId`

---



## Dependencies (task order)

```text
Task 1 (shared DTO)
  → Task 2 (migration)
    → Task 3 (extractors)
      → Task 4 (ingest persist)
        → Task 5 (build safety)
        → Task 6 (enrichment worker)
          → Task 7 (API enqueue)
          → Task 8 (HTTP GET)
            → Task 9 (UI)
        → Task 10 (CLI)  // after Task 6
Task 11 docs
Task 12 verify
```

Tasks 5 and 6 can proceed after 4. Task 10 after 6. Task 9 after 8.

---



## Out of scope (do not implement)

AI, VOD, live spectator, ward map, plates, Atakhan/horde UI, population crawler changes, enabling raw payload storage, GET-triggered Riot fetches, chart libraries, Redis caching, `MATCH_TIMELINE_REQUIRED_FOR_COMPLETE=true`, enabling `MATCH_TIMELINE_SEARCH_BACKFILL_ENABLED` by default.