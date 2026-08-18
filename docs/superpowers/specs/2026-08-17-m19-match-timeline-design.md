# Milestone 19 Design: Match Timeline / Game Flow

**Date:** 2026-08-17  
**Status:** Draft — awaiting external review (not implemented)  
**Branch:** `milestone-19-match-timeline` (from `master` @ `cc97756`, M18 merged)  
**Plan:** `docs/superpowers/plans/2026-08-17-m19-match-timeline.md`

---

## 1. Goal

M18 shows the **final state** of a stored match (teams, items, runes, damage, early-game 10/15 diffs).

M19 adds a **deterministic match timeline / game-flow** layer on top of Riot Match-v5 timeline data:

1. Kill timeline
2. Objective timeline (dragon, baron, herald, tower, inhibitor only)
3. Item purchase progression
4. Skill upgrade progression
5. Gold progression (player and team difference)
6. Event stream
7. Timeline visualization on the existing match-detail page

M19 is **deterministic data + API + UI**. AI is not required and must not be added.

### Success criteria

1. `/matches/:matchId` keeps the M18 overview and adds a Timeline tab that loads independently.
2. `GET /api/matches/:matchId` remains the overview contract (small payload; cheap `productCoverage` only).
3. `GET /api/matches/:matchId/timeline` returns a public, PUUID-free timeline DTO with exact per-feature coverage.
4. Kill, objective, item, skill, and gold sections render from stored normalized data — not from raw Riot JSON.
5. Matches without product timeline coverage still render overview; the Timeline tab states why data is missing.
6. Champion-build aggregation continues to read `ITEM_*` / `SKILL_LEVEL_UP` rows and ignores new event types.
7. Timeline GET never writes (no hidden ingest, enroll, or Riot fetch on the request path).
8. No PUUID, raw payload, API key, or internal participant UUID appears in the public response or UI.

---

## 2. Non-goals

- AI match analysis, coaching, teamfight AI, or M17 playstyle changes
- VOD / replay viewer, live spectator, or League Client endpoints
- Population crawler redesign
- Enabling global `MATCH_STORE_RAW_PAYLOADS`
- Ward map, turret plates, Atakhan, voidgrubs, dragon soul, or other unlisted objective types as first-class UI
- Champion level-over-time (`LEVEL_UP`), movement heatmaps, or full frame `championStats` / `damageStats`
- Replacing M18 early-game 10/15 diffs
- Search by Riot `externalMatchId`
- Mainland Chinese servers

---

## 3. Repository findings

### 3.1 `MatchTimeline`

**Schema** (`apps/api/prisma/schema.prisma`):

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | UUID PK | Internal |
| `matchId` | UUID unique FK → `Match` | 1:1 |
| `fetchStatus` | `PENDING \| FETCHED \| FAILED \| SKIPPED` | Timeline lifecycle, **independent** of `Match.ingestionStatus` |
| `rawPayload` | `Json?` | Full Riot timeline **only** when `MATCH_STORE_RAW_PAYLOADS=true` (default **false**) |
| `timelineSchemaVersion` | string default `"1"` | Written by `normalizeTimeline` |
| `fetchedAt` | timestamptz? | Set when `FETCHED` |
| `failureReason` | string? | Classified error code, not a stack |
| timestamps | created/updated | Internal |

**Indexes:** unique `matchId`; index on `fetchStatus`.

**Writers:** `persistTimelineAndMetrics` in `apps/worker/src/queues/match-ingestion/match-persistence.ts` (upsert). Called from `match-ingestion.processor.ts` after match persist.

**Readers:**

- M18 match detail: `matchDetailSelect.timeline.fetchStatus` only (`apps/api/src/persistence/match.repository.ts`)
- Tests / seed / persistence integration tests
- **No production reader of `rawPayload`**

**Public mapping today** (`match-detail.mapper.ts`):

| `fetchStatus` | `PublicMatchTimeline.status` |
| --- | --- |
| missing / `PENDING` | `PENDING` |
| `FETCHED` | `AVAILABLE` |
| `FAILED` / `SKIPPED` | `UNAVAILABLE` |

`metricsAvailable` is derived from participant 10/15 / KP columns, not from this row.

### 3.2 `MatchTimelineEvent`

**Schema comment (exact):** *Build/skill-relevant Match-v5 timeline events only (`ITEM_*`, `SKILL_LEVEL_UP`). Historical matches may have zero rows.*

| Field | Type | Used for |
| --- | --- | --- |
| `id` | UUID PK | Internal |
| `matchId` | FK → `Match` | Cascade delete |
| `eventIndex` | int | Stable order among **preserved** events (0-based); unique per match |
| `type` | string | Allowlisted types only |
| `timestampMs` | int | Riot event `timestamp` |
| `participantId` | int? | Riot participant id 1–10 |
| `itemId` / `beforeItemId` / `afterItemId` | int? | Item ops; UNDO maps `beforeId`/`afterId` |
| `skillSlot` / `levelUpType` | int? / string? | Skill ups |
| `createdAt` | timestamptz | Internal |

**Indexes:** unique `(matchId, eventIndex)`; `(matchId, participantId, timestampMs)`.

**Not present:** `killerId`, `victimId`, `assistingParticipantIds`, `teamId`, `position`, `monsterType`, `buildingType`, `towerType`, `laneType`, any JSON metadata blob.

**Writer:** `extractBuildRelevantTimelineEvents` → `persistTimelineAndMetrics` `createMany` after `deleteMany` for that match.

**Allowlist** (`timeline-build-events.ts`):

```text
ITEM_PURCHASED, ITEM_SOLD, ITEM_UNDO, ITEM_DESTROYED, SKILL_LEVEL_UP
```

`CHAMPION_KILL` is **explicitly dropped** (`timeline-build-events.test.ts` asserts `not.toContain('CHAMPION_KILL')`).

**Readers:**

- Champion build aggregation (`rebuild-core.ts` selects type/timestamp/eventIndex/participant/item/skill fields)
- `packages/match-analytics` item reconstruction, starting items, skill order, eligibility
- **M18 match detail does not read this table**

Item reconstruction already `default: break`s unknown types, so adding kill/objective rows to the same table is safe **if tests prove it**.

### 3.3 Derived participant metrics (not an event store)

`timeline-metrics.service.ts` reads Riot frames/events **in memory** during ingest, then writes columns on `MatchParticipant`:

- gold/cs/xp at 10 and 15 + lane diffs
- deaths before 10 / 10–20 (from transient `CHAMPION_KILL`)
- kill participation (from match K/D/A totals, not the kill feed)
- `skillOrder[]`
- `firstCompletedItem*` always null in v1
- `deathsBeforeObjectives` always null in v1

Frames and kill events are discarded after this write unless `rawPayload` is kept.

### 3.4 Timeline ingestion flow (today)

```text
BullMQ match-ingestion / INGEST_MATCH
  → getMatch (Match-v5) via withRiotWorkload('match')
  → normalize + persist Match / MatchTeam / MatchParticipant
  → if MATCH_TIMELINE_FETCH_ENABLED (default true):
       getTimeline  GET /lol/match/v5/matches/{id}/timeline
       → RiotMatchTimelineDtoSchema (passthrough unknown event types)
       → normalizeTimeline (flatten frames → events; rawPayload only if storeRawPayloads)
       → extractBuildRelevantTimelineEvents (ITEM_*/SKILL only)
       → calculateTimelineMetrics (10/15 + death buckets)
       → persistTimelineAndMetrics
  → mark Match COMPLETED (default: even if timeline FAILED)
```

There is **no** `match-timeline` queue. Timeline is inline in match ingestion.

**Retry / failure (verified in processor + tests):**

| Timeline error | `MATCH_TIMELINE_REQUIRED_FOR_COMPLETE=false` (default) | `true` |
| --- | --- | --- |
| 404 / permanent | `fetchStatus=FAILED`, match still `COMPLETED` | FAILED + throw if required path |
| 429 | publish shared cooldown; `FAILED`; match `COMPLETED` (soft-fail) | throw → job delay/retry |
| 5xx / unavailable | `FAILED` + match `COMPLETED` (soft-fail) | throw → retry whole ingest |

Soft-failed timelines are **sticky**. Completing the match does **not** schedule a later timeline retry. Re-ingest with overwrite is the only current recovery.

**Riot call:** `RiotGameDataProvider.getTimeline` — regional Match-v5, schema-validated, `resourceHint: 'timeline'`. Tagged `match` workload (same budget class as match detail).

**Scaling:** every ingested match (tracked-player **and** population collector) already pays one extra Match-v5 call when the flag is on. Phase 7 measured `MatchTimelineEvent` as the **dominant** table (~189 MiB for 1,454 matches / 458k rows). Indexes were larger than heap.

### 3.5 M18 integration

| Piece | Location |
| --- | --- |
| Page | `/matches/:matchId` (`apps/web/pages/matches/[matchId].vue`) |
| API | `GET /api/matches/:matchId` (`MatchesController`) |
| DTO | `PublicMatchDetail` including `timeline: { status, metricsAvailable }` |
| UI | header, team panels, damage bars, origin-only early-game 10/15 |
| Query | `?player=` highlight only; API has no player param |
| Timeline reads | `fetchStatus` only — **no events, no frames, no rawPayload** |

No tabs. No `useMatchApi().getTimeline`. Overview payload is already a full 10-player match.

### 3.6 Public identity rules (reuse)

- Route id = `Match.id` UUID (`ParseUUIDPipe`)
- Public players = `Player.id` UUID via `playerAccount.playerId`
- `externalMatchId` omitted from match-detail DTO; keep omitted on timeline DTO
- `assertNoPuuidLeak` rejects `externalAccountId` / `"puuid"`
- Timeline Riot metadata includes `participants: PUUID[]` — must never be copied

---

## 4. Current timeline reality

**What exists today**

- Timeline **is fetched** for new ingestions (default on).
- Status row always written (`FETCHED` / `FAILED` / `SKIPPED`).
- Compact **item + skill** events persisted for new ingestions since M12-v2 build preservation (`20260811140000`).
- 10/15 gold/cs/xp diffs persisted on participants.
- Death **counts** in two buckets persisted; the kill **list** is not.

**What is discarded after ingest**

- `CHAMPION_KILL` (killer, victim, assists, position)
- `ELITE_MONSTER_KILL` / `BUILDING_KILL`
- All other event types
- Per-minute participant frames (gold, xp, cs, level, position)
- Positions
- Full raw JSON (unless the debug flag is on)

**Historical holes**

- Matches ingested before build-event persistence: `FETCHED` possible, **zero** `MatchTimelineEvent` rows
- Matches with `FAILED`/`SKIPPED` timeline: no events, nullable 10/15 metrics
- `rawPayload` is null in production default — **cannot reconstruct M19 features without a new Riot `getTimeline` call**

M18 locked this as deferred. That finding is still true.

---

## 5. Available Riot data

Source: Match-v5 timeline DTO as modeled in `packages/server-riot/src/riot-api.schemas.ts` (passthrough), fixtures, and community Match-v5 timeline types. Unknown future event types must not break parse (already true).

### 5.1 Frames

- `info.frameInterval` — typically **60_000 ms** (fixture and schema require a positive int; do not hard-code 60s in the UI)
- Each frame: `timestamp`, `participantFrames` keyed by participant id, `events[]`
- Participant frame fields we **know** we parse today: `participantId`, `level`, `xp`, `totalGold`, `currentGold`, `minionsKilled`, `jungleMinionsKilled`, `position.{x,y}`
- Riot also sends `championStats`, `damageStats`, `goldPerSecond` — **do not persist** in M19 (size)

A ~30 minute game ≈ 31 frames × 10 participants ≈ **310 compact snapshots**.

### 5.2 Events relevant to M19

| Riot `type` | Fields used | M19 feature |
| --- | --- | --- |
| `CHAMPION_KILL` | `timestamp`, `killerId`, `victimId`, `assistingParticipantIds`, `position`, `teamId?` | Kill timeline; assists; deaths |
| `ELITE_MONSTER_KILL` | `timestamp`, `killerId`, `assistingParticipantIds?`, `monsterType`, `monsterSubType`, `killerTeamId`/`teamId`, `position` | Dragon / baron / herald |
| `BUILDING_KILL` | `timestamp`, `killerId`, `buildingType`, `towerType`, `laneType`, `teamId`, `position` | Tower / inhibitor |
| `ITEM_PURCHASED` / `ITEM_SOLD` / `ITEM_UNDO` / `ITEM_DESTROYED` | existing columns | Item progression |
| `SKILL_LEVEL_UP` | existing columns | Skill progression |

`killerId === 0` is a documented Riot pattern for environmental kills (tower, minion, execution). Treat as non-champion killer.

### 5.3 Known objective mapping (display allowlist)

| Stored Riot value | Public type |
| --- | --- |
| `monsterType = DRAGON` | `dragon` (optional `monsterSubType` when present, e.g. `FIRE_DRAGON`, `ELDER_DRAGON`) |
| `monsterType = BARON_NASHOR` | `baron` |
| `monsterType = RIFTHERALD` | `riftHerald` |
| `buildingType = TOWER_BUILDING` | `tower` (optional `towerType` / `laneType`) |
| `buildingType = INHIBITOR_BUILDING` | `inhibitor` (optional `laneType`) |

Persist `monsterType` / `buildingType` as strings. **Public DTO emits only the table above.** Unknown types (including horde / Atakhan if Riot sends them) are stored and omitted from the public objective list — not invented, not displayed.

`BUILDING_KILL.teamId` is the building owner (the team that lost the structure). Killer side is the opposite 100/200 pair when both are standard teams. Spec tests must lock this with a fixture; if a payload is missing `teamId`, derive owner from `laneType` only when tests prove it, otherwise omit team and still show the event type.

### 5.4 Explicitly unused in M19 (do not persist)

`WARD_PLACED`, `WARD_KILL`, `TURRET_PLATE_DESTROYED`, `CHAMPION_SPECIAL_KILL`, `DRAGON_SOUL_GIVEN`, `LEVEL_UP`, `GAME_END`, `PAUSE_END`, unknown types.

Do **not** persist a catch-all JSON copy of the Riot event. Timeline metadata contains PUUIDs.

---

## 6. Missing data (relative to M19 UI)

| Need | In Riot timeline? | Stored today? |
| --- | --- | --- |
| Kill killer / victim / assists / time | Yes | No (counts only) |
| Kill position | Yes | No |
| Objective events + time | Yes | Team **totals** on `MatchTeam.objectives` only (no timestamps) |
| Item buy/sell/undo/destroy + time | Yes | Yes, new ingestions only |
| Skill level-up + slot + time | Yes | Yes, new ingestions only |
| Gold / XP / CS / level per minute | Yes (frames) | No (only t=10 and t=15) |
| Frame positions | Yes | No |
| Historical matches before M12-v2 events | Yes at ingest time | Usually gone (`rawPayload` null) |
| Sticky `FAILED` timelines | N/A | No retry job |

---

## 7. Storage proposal

### 7.1 Options

**A — Raw Riot timeline only**

Keep / enable `MatchTimeline.rawPayload` and parse at read time.

- Pros: no event-schema work; all future types retained
- Cons: default is off for a reason; payload includes PUUIDs; large JSON; M18/M19 public path must never read it; champion-build already depends on normalized rows; historical rows are null; every GET becomes a parse of a blob

**Reject A** as the product store. Keep the debug flag unchanged (`false`).

**B — Normalized events only (no frames)**

Widen `MatchTimelineEvent` for kills/objectives.

- Pros: matches current table; item/skill already there
- Cons: gold graphs are **not events**; without frames or raw JSON there is no gold series after ingest

**Reject B** as insufficient for the gold-graph requirement.

**C — Hybrid (recommended)**

1. `MatchTimeline` remains the fetch-status row; `rawPayload` stays optional debug-only
2. `MatchTimelineEvent` is the normalized event stream (existing build types **plus** product types)
3. New `MatchTimelineFrame` stores compact per-participant snapshots for graphs

This is the only option that serves kill/objective/item/skill **and** gold graphs without exposing raw Riot JSON.

### 7.2 Recommended schema

**`MatchTimeline` additions**

| Field | Type | Meaning |
| --- | --- | --- |
| `productCoverage` | enum `NONE \| STORED \| INELIGIBLE` default `NONE` | Whether kill/objective/frame persistence ran |
| `frameIntervalMs` | int? | Copied from Riot `info.frameInterval` when fetched |
| `productNormalizedAt` | timestamptz? | When product rows were written |

Do not overload `fetchStatus` for product coverage. `FETCHED` + `NONE` is exactly the historical hole M19 must backfill.

**`MatchTimelineEvent` additions** (nullable; existing rows stay valid)

| Field | Type |
| --- | --- |
| `killerParticipantId` | int? |
| `victimParticipantId` | int? |
| `assistingParticipantIds` | `Int[]` default `[]` |
| `teamId` | int? |
| `positionX` / `positionY` | int? |
| `monsterType` / `monsterSubType` | string? |
| `buildingType` / `towerType` / `laneType` | string? |

Persisted types after M19 extractor:

```text
ITEM_PURCHASED, ITEM_SOLD, ITEM_UNDO, ITEM_DESTROYED, SKILL_LEVEL_UP,
CHAMPION_KILL, ELITE_MONSTER_KILL, BUILDING_KILL
```

`eventIndex` remains unique per match among **persisted** events, assigned in Riot flatten order. Build reconstruction already sorts by `timestampMs` then `eventIndex` and ignores unknown types.

**New `MatchTimelineFrame`**

FK to `Match` only (cascade). Do not also FK to `MatchTimeline` — a match can have frames written in the same transaction as the timeline upsert, but a dual FK is extra coupling if a timeline row is missing.

| Field | Type |
| --- | --- |
| `id` | UUID PK |
| `matchId` | FK → `Match` cascade |
| `timestampMs` | int |
| `participantId` | int |
| `totalGold` | int |
| `xp` | int |
| `cs` | int (minions + jungle, same formula as `timeline-metrics.service`) |
| `level` | int |

Unique `(matchId, timestampMs, participantId)`. Index `(matchId, timestampMs)`.

No position, no `currentGold`, no nested stat blobs.

### 7.3 Are frames worth storing?

**Yes, for eligible matches only.**

- Riot granularity is ~1 minute — enough for a gold graph, not a replay
- 310 int rows per 30-minute game is small versus raw JSON, large versus “all population matches”
- Alternative (re-fetch on every Timeline tab) repeats Match-v5 cost and fails when Riot 404s
- Alternative (raw payload) is rejected in §7.1

Do **not** store frames for every population match. Phase 7 already flagged event-table growth.

---

## 8. Retention strategy

| Data | Who | Why |
| --- | --- | --- |
| Timeline fetch + 10/15 metrics + build events | All matches the worker already timelines (status quo) | Champion aggregates; M18 early game |
| Product events (kills, objectives) + frames | **Eligible matches only** | Product UI; storage cap |
| Raw payload | Debug flag only | PUUID + size |

**Eligibility (locked):** a match is product-timeline eligible if **at least one** `MatchParticipant.playerAccountId` is non-null at persist time.

Rationale:

- Match-detail traffic comes from player pages (`/players/:id` → `/matches/:id?player=`)
- Population-only lobbies are analytics source data; they do not need kill feeds or gold graphs
- Not Ranked-Solo-only: a tracked player's ARAM/Flex match should still timeline if it was ingested
- Not “recent N matches” as a schema rule: if we already paid `getTimeline` during ingest, persist product data for that eligible match
- Backfill **is** window-capped (see §9) because it costs a new Riot call

Ineligible fetched matches: `productCoverage=INELIGIBLE`, build events only, no frames.

---

## 9. Ingestion proposal

### 9.1 Forward path (no extra Riot call)

Keep timeline fetch **inline** in `match-ingestion`. After a successful `getTimeline`:

1. Always: metrics + build events (current)
2. If eligible: also persist product event types + frames; set `productCoverage=STORED`
3. If not eligible: `productCoverage=INELIGIBLE`
4. On timeline failure: `fetchStatus=FAILED`, `productCoverage=NONE` (unchanged soft-fail default)

Do not set `MATCH_TIMELINE_REQUIRED_FOR_COMPLETE=true`.

### 9.2 Separate BullMQ queue (required)

New queue `match-timeline` / job `ENRICH_MATCH_TIMELINE`.

Payload (public-safe): `{ matchId: uuid, correlationId? }` — League Helper match UUID, **not** Riot id, not PUUID.

Worker:

1. Load match (`externalMatchId`, `regionalRoute`, ingestion status, eligibility)
2. Skip if `productCoverage=STORED` (idempotent)
3. Skip if ineligible and not forced by CLI `--include-ineligible` (CLI only; default off)
4. `withRiotWorkload('match')` → `getTimeline`
5. Normalize + persist product events + frames + build events (replace match events in one transaction, same as today)
6. 429 → shared cooldown + delay; 404 → `FAILED` + stop; 5xx → retry

**Why a separate queue**

- Soft-failed timelines never retry today
- Historical `FETCHED` + `rawPayload=null` needs a **second** `getTimeline`
- Must not re-run `getMatch` / participant persist
- Isolates backpressure from match ingest and from population collector

Concurrency: default **1** (stricter than match-ingestion’s 2). Attempts/backoff: copy match-ingestion bounds. Env: `MATCH_TIMELINE_QUEUE_NAME`, `MATCH_TIMELINE_WORKER_CONCURRENCY`, `MATCH_TIMELINE_JOB_ATTEMPTS`.

### 9.3 When to enqueue enrichment (no GET writes)

| Trigger | Behavior |
| --- | --- |
| New eligible ingest | Inline persist of product events/frames; **no** extra job (timeline call already paid) |
| Player search/bootstrap `enqueueDiscoveredMatches` | Enqueue up to **20** most recent completed matches linked to that account with `productCoverage != STORED` **only when** `MATCH_TIMELINE_SEARCH_BACKFILL_ENABLED=true` (default **false**). Runs even when `linkedRows === 0` so post-deploy history can be covered once the flag is on |
| Ops CLI | Bounded backfill always available (`--limit` max 500, optional `--since`, `--dry-run`; `--include-ineligible` off by default). Not gated by the search flag |
| `GET /api/matches/:id` or `.../timeline` | **Read only** — never enqueue |

**`MATCH_TIMELINE_SEARCH_BACKFILL_ENABLED` (default false)** protects Riot API limits. Player search must not fire dozens of historical `getTimeline` calls on every lookup. Enable later when production API capacity allows. New eligible ingestions are unaffected — they already call `getTimeline` and persist product rows inline.

When the flag is false, historical matches remain overview-only until ops CLI backfill or a later enablement. Timeline tab empty-states cover that case.

### 9.4 Current vs proposed

```text
Current:  ingest match → (inline) timeline fetch → drop most of it
Proposed: ingest match → (inline) timeline fetch → persist by policy
          + match-timeline job for retry / CLI backfill / optional gated search enrich
```

---

## 10. API proposal

**Decision: Option A** (separate timeline resource).

| Method | Path | Role |
| --- | --- | --- |
| GET | `/api/matches/:matchId` | M18 overview. Add cheap `timeline.productCoverage` + `timeline.productAvailable` (from `MatchTimeline` row only). Do not attach events/frames or run event/frame counts. |
| GET | `/api/matches/:matchId/timeline` | Product timeline DTO + exact per-feature `coverage` flags |

**Why not Option B (single blob)**

- Overview is already a 10-player static-resolved document
- Product timeline adds hundreds of events + ~300 frames
- Timeline tab should load after overview
- Exact feature coverage is paid only when the Timeline tab loads

404: existing `ResourceNotFoundError` / `RESOURCE_NOT_FOUND` when the match UUID does not exist. Invalid UUID: `ParseUUIDPipe` 400. UI treats 400/404 like M18.

200 even when timeline is empty/unavailable — same incomplete-match pattern as M18. Do not 404 a real match because product coverage is `NONE`.

No Redis cache (backfill can fill coverage after first view). No hidden writes.

Reuse `MatchesModule` / `MatchesController`. Add `MatchTimelineService` + mapper. Load participants for identity join; **do not** select `rawPayload`, `externalAccountId`, or `Match.rawPayload`.

---

## 11. DTO proposal

All schemas in `@league-helper/shared`. Validate with Zod on the API boundary. `assertNoPuuidLeak` on both overview and timeline responses.

### 11.1 Overview addition (`PublicMatchTimeline`)

Keep `status` and `metricsAvailable`. Add **only** cheap fields already on `MatchTimeline` (or derived from that one row — **no** `MatchTimelineEvent.groupBy`, **no** `MatchTimelineFrame.findFirst` on overview):

```ts
{
  status: 'PENDING' | 'AVAILABLE' | 'UNAVAILABLE', // from fetchStatus (unchanged)
  metricsAvailable: boolean, // from participant 10/15/KP columns (unchanged)
  productCoverage: 'NONE' | 'STORED' | 'INELIGIBLE', // from MatchTimeline.productCoverage; missing row → NONE
  productAvailable: boolean, // true iff productCoverage === 'STORED'
}
```

Do **not** put per-feature `{ items, skills, kills, objectives, frames }` on the overview DTO.

`status` remains fetch-lifecycle so M18 early-game copy stays correct. The Overview tab may use `productAvailable` only as a soft hint that a Timeline tab is worth opening; empty-state detail still comes from the timeline endpoint.

### 11.2 `PublicMatchTimelineDetail`

```ts
{
  matchId: uuid,
  status: 'PENDING' | 'AVAILABLE' | 'UNAVAILABLE',
  coverage: { items, skills, kills, objectives, frames },
  frameIntervalMs: number | null,
  participants: PublicMatchTimelineParticipant[], // compact join table
  events: PublicMatchTimelineEvent[],
  frames: PublicMatchTimelineFrame[],
  derived: {
    kills: PublicMatchKillEvent[],
    objectives: PublicMatchObjectiveEvent[],
    gold: {
      timestampsMs: number[],
      teams: { teamId: number; side: 'BLUE' | 'RED' | 'UNKNOWN'; gold: number[] }[],
      participants: { participantId: number; gold: number[] }[],
      difference: number[] | null, // blue total − red total when both sides exist
    }
  }
}
```

**Participant ref (no PUUID, no row UUID):**

`participantId`, `teamId`, `side`, `playerId | null`, `riotId | null`, `championId`, `championKey | null`, `championName | null`, `championIconUrl | null`, `teamPosition`.

**Event (normalized, public):**

`eventIndex`, `timestampMs`, `type` (enum of persisted types; never emit unknown), plus nullable kill/item/skill/objective fields using **participantId** not internal ids. `position: { x, y } | null`.

Item events include `item: ChampionBuildStaticIdentity | null` (id/name/iconUrl from match-patch static lookup, same as M18). Skill events include `skillLabel: 'Q' \| 'W' \| 'E' \| 'R' | null` from `skillSlot`.

**Kill view:** `timestampMs`, `killer` (participant ref or `null` if `killerParticipantId` is 0/missing), `killerKind: 'CHAMPION' | 'ENVIRONMENT'`, `victim` (required ref when `victimParticipantId` resolves), `assists` (refs), `position`.

Drop kills whose victim cannot be joined (do not invent).

**Objective view:** `timestampMs`, `type` in `dragon | baron | riftHerald | tower | inhibitor`, `killer` / `killerKind`, `assists`, `teamId` (owner or killer team — field name `ownerTeamId` for buildings, `killerTeamId` for monsters), `monsterSubType | null`, `towerType | null`, `laneType | null`, `position`.

**Frames:** `timestampMs`, `participantId`, `totalGold`, `xp`, `cs`, `level`.

**Gold derived** is computed in the mapper from frames (sum by `teamId`). Do not store a third gold table.

**Incomplete frames (locked):** never treat a missing participant frame as `0` gold.

`deriveTeamGoldSeries` includes a timestamp in the team / difference graph **only** when that timestamp has a complete snapshot for every participant required by the graph (standard ranked lobby: all participants present in the `participants` join set for that match; if a side has zero participants, omit that side and set `difference` null). Malformed or incomplete timestamps are **omitted** from `timestampsMs`, team series, and `difference`. Per-player series may still list a participant’s own observed points, but team totals / difference must not invent zeros for absent teammates.

Item/skill progression in the UI is a **filter of `events`** plus participant join — no extra stored aggregate. Exact `coverage` flags on this DTO are computed from the loaded events/frames (timeline GET only).

Never include: PUUID, `externalMatchId`, `rawPayload`, `failureReason` internals, `MatchParticipant.id`.

---

## 12. UI proposal

Stay on `/matches/:matchId` (no `/timeline` route). Preserve `?player=` highlight.

### 12.1 Tabs

| Tab | Source | Default |
| --- | --- | --- |
| Overview | existing M18 page body | Yes |
| Timeline | `GET /api/matches/:id/timeline` | Lazy on select |

Hash optional: `#timeline` selects the Timeline tab so match cards can deep-link later; M19 does not require changing match-card URLs.

### 12.2 Timeline tab layout (presentation order, locked)

1. **Gold graph** at the top (`MatchGoldGraph.vue`) — hidden when timeline `coverage.frames === false`
2. **One chronological, filterable event stream** (`MatchEventStream.vue`) with chips: **All | Kills | Objectives | Items | Skills**
3. **Participant Build Progression** (`MatchItemProgression.vue`) below the stream
4. **Participant Skill Progression** (`MatchSkillProgression.vue`) below builds

Kill/objective components remain specialized **renderers inside** the event stream (not separate top-level timeline sections competing with the stream). This is presentation clarification only — same API/DTO.

### 12.3 Components (`apps/web/components/match/`)

| Component | Responsibility |
| --- | --- |
| `MatchDetailTabs.vue` | Overview / Timeline; keyboard tabs |
| `MatchTimelineSection.vue` | Load state, empty states; composes layout §12.2 |
| `MatchGoldGraph.vue` | Team gold + difference; optional per-player series. SVG polyline; no new chart library |
| `MatchEventStream.vue` | Single chronological stream; filter chips All / Kills / Objectives / Items / Skills |
| `MatchKillFeed.vue` | Kill row renderer used by the stream (`02:14 Blue Top kills Red Top`) |
| `MatchObjectiveTimeline.vue` | Objective row renderer used by the stream |
| `MatchItemProgression.vue` | Per-participant purchase/sell/undo/destroy; origin player first when `?player=` |
| `MatchSkillProgression.vue` | Skill slots 1–4 as Q/W/E/R; evolve text without inventing a 5th ability |

Empty states (exact product copy can be tuned at implement time, meaning is locked):

- Fetch `PENDING`: “Timeline is still processing.”
- `UNAVAILABLE` / FAILED: “Timeline is not available for this match.”
- `AVAILABLE` but timeline `coverage.kills=false`: “Kill timeline was not stored for this match.” (historical / ineligible / pre-M19)
- Remake: still show whatever events exist; do not invent a winner in the feed

Overview early-game section **stays**. Do not move 10/15 diffs into the Timeline tab.

No minimap. Positions may be in the DTO for later; v1 UI does not plot them.

---

## 13. Feature analysis (required data)

### Kill timeline

Example: `02:14 Blue Top kills Red Top`

| Need | Source |
| --- | --- |
| Timestamp | `CHAMPION_KILL.timestamp` |
| Killer | `killerId` → participant (or ENVIRONMENT if 0) |
| Victim | `victimId` → participant |
| Assists | `assistingParticipantIds` |
| Team / side | participant `teamId` → `matchTeamSide` |
| Role label | `normalizeParticipantPosition` |

Not stored today. Requires product event persist + backfill for history.

### Objective timeline

Only dragon, baron, herald, tower, inhibitor. Team objective **counts** on M18 overview stay as totals; this is the **timed** list.

### Item progression

Existing `ITEM_*` rows + timestamps. Works for post-M12-v2 ingestions even when `productCoverage=INELIGIBLE`. Undo must use `beforeItemId` / `afterItemId` (already stored).

### Skill progression

Existing `SKILL_LEVEL_UP` + `skillSlot` (1=Q, 2=W, 3=E, 4=R). Same as champion-build skill order. Historical matches may only have `MatchParticipant.skillOrder` without timestamps — Timeline tab shows untimed order as a fallback **only when** no `SKILL_LEVEL_UP` rows exist; label it as sequence-without-clock, not a fake clock.

### Gold graph

| Series | Source |
| --- | --- |
| Player gold | `MatchTimelineFrame.totalGold` |
| Team gold | sum frames by `teamId` **only at complete snapshot timestamps** |
| Team difference | blue sum − red sum at those same timestamps |

Requires frames. 10/15 columns are **not** a substitute graph. Missing participant frames must not become zero gold (see §11.2).

---

## 14. Performance concerns

1. **`MatchTimelineEvent` is already the largest table.** Adding ~20–50 product events per eligible match is modest; adding ~300 frames per **population** match is not. Eligibility exists to prevent that.
2. **Indexes:** keep `(matchId, eventIndex)` unique; add `(matchId, type, timestampMs)` only if explain plans need it. Do not index JSON. Frame unique key is enough for graph reads (`WHERE matchId=`).
3. **Overview GET** must not query `MatchTimelineEvent` or `MatchTimelineFrame` for flags. **Timeline GET** loads events + frames by `matchId` only (point lookup) when the Timeline tab is opened.
4. **Riot:** forward path adds **zero** extra calls. Search historical enqueue is **off by default** (`MATCH_TIMELINE_SEARCH_BACKFILL_ENABLED=false`). CLI backfill and (when enabled) capped search enqueue share concurrency 1, shared 429 cooldown, `Retry-After`.
5. **Payload size:** separate endpoint. Consider omitting `events` duplicates that are already in `derived.kills` — **keep both** in v1 (events = source of truth; derived = UI convenience). If payload is too large in review, drop raw `events` from v1 and keep derived + item/skill filters only — default is keep `events`.
6. **Champion aggregation** must not load new columns it does not need (keep its `select` list). Mixed event types on a match must not change build eligibility counts.

---

## 15. Security

- `RIOT_API_KEY` stays on the worker/API. Timeline GET does not call Riot.
- Never put PUUID, `externalAccountId`, `externalMatchId`, or raw timeline JSON in the DTO or logs beyond existing truncated match-id logging.
- `assertNoPuuidLeak` on timeline mapper output.
- Do not persist Riot `metadata.participants`.
- Do not persist raw event passthrough objects.
- CORS remains `API_CORS_ORIGIN`. M18 noted no Nest `@Throttle` on public HTTP; M19 does not add a one-off limiter unless a repo-wide limiter already exists (it does not). Residual process risk, same as M18.
- GET is read-only (no enroll, no ingest, no queue).
- Job payload uses internal `matchId` UUID.

---

## 16. Tests

### Shared

- Public timeline Zod: happy path; rejects PUUID-shaped fields
- Objective mapper: known types only; unknown `monsterType` omitted
- Gold derivation: complete 10-player / two-team snapshots; missing side → `difference` null
- Gold derivation: incomplete timestamp (one participant missing a frame) is **omitted** — team gold must not fake a drop via zero-fill
- Kill mapper: `killerId=0` → ENVIRONMENT; missing victim dropped
- Timeline-endpoint coverage flags from loaded rows; overview exposes only `productCoverage` / `productAvailable`

### Worker

- Extractor keeps ITEM_*/SKILL and adds CHAMPION_KILL / ELITE_MONSTER / BUILDING; drops wards/plates/unknown
- Ineligible match: no frames, `INELIGIBLE`, build events still written
- Eligible match: frames + product events, `STORED`
- `persistTimelineAndMetrics` replace semantics (deleteMany + createMany) still unique on `eventIndex`
- Champion-build reconstruction fixture with mixed kill rows still eligible
- Timeline 404/429 behavior unchanged on match ingest; enrichment job retries 429 and dead-letters 404
- Enrichment is idempotent when `productCoverage=STORED`

### API

- `GET /timeline` 404 unknown UUID; 200 empty coverage for real match
- Overview parses `PublicMatchDetailSchema` with `productCoverage` / `productAvailable` only (no per-feature coverage; no event/frame queries)
- Search path enqueues timeline jobs only when `MATCH_TIMELINE_SEARCH_BACKFILL_ENABLED=true`
- Leak test: fixture with PUUID in raw row is not selected / not emitted
- Does not enqueue jobs from GET

### Web

- Tabs; Timeline lazy fetch
- Layout: gold graph → filterable event stream → build → skill
- Kill feed copy with sides/roles
- Gold graph hidden when timeline `coverage.frames=false`
- Item/skill sections when those coverage flags are true
- Playwright: overview still works; Timeline tab shows empty-state or mocked feed

---

## 17. Locked decisions

1. Storage **C** (hybrid): status row + expanded events + compact frames. Raw payload stays debug-off.
2. API **Option A**: overview GET + `GET /api/matches/:id/timeline`.
3. Product persistence **eligible matches only** (any linked `playerAccountId`).
4. Build events + 10/15 metrics remain **global** for timeline-fetched matches.
5. Frames stored for eligible matches; not for population-only matches.
6. Separate `match-timeline` queue for retry/CLI backfill/(optional) search enrich; ingest keeps inline fetch + inline product persist for eligible matches.
7. GET is read-only.
8. `MATCH_TIMELINE_SEARCH_BACKFILL_ENABLED` defaults **false**. When true, search enqueue cap is 20 most recent incomplete-coverage matches. CLI backfill remains available regardless.
9. Public objectives: dragon, baron, herald, tower, inhibitor only.
10. No AI, VOD, live, ward map, plates, Atakhan/horde UI.
11. No `MATCH_STORE_RAW_PAYLOADS=true`.
12. Public ids: `Match.id` + participant `participantId` + optional `playerId`.
13. `killerId=0` is environment, not a fake participant.
14. Gold series derived at read time from frames; **complete snapshots only** for team/difference — never zero-fill missing participants.
15. Overview DTO: cheap `productCoverage` / `productAvailable` only. Exact per-feature coverage only on timeline GET.
16. UI: tabs on existing match page; gold graph → one filterable event stream → build/skill progression; SVG graph; no new chart library.
17. Prisma **migration is required**.
18. `MATCH_TIMELINE_REQUIRED_FOR_COMPLETE` stays **false**.

---

## 18. Deferred features

- Ward / vision timeline and minimap
- Turret plates, dragon soul, Atakhan, voidgrubs as first-class types
- Teamfight clustering / AI
- Frame positions / movement
- Champion `LEVEL_UP` clock
- Per-second gold (Riot does not provide it)
- Redis cache of timeline DTO
- Population-wide product events
- On-demand GET→enqueue
- Replay / spectator
- Changing population collector match volume

---

## 19. Risks

1. **Storage:** eligible-match frames are the new volume. If “linked participant” is too broad (many population PUUIDs already linked), frame growth will surprise ops — monitor row counts after ship; tighten eligibility to `TrackedPlayer` ACTIVE if needed in a follow-up (not M19 default, because match detail works for searched players who may not be collector-tracked).
2. **Riot limits:** historical backfill re-fetches timelines that were already fetched once and discarded. Search historical enqueue stays **off by default**. Caps and concurrency 1 are mandatory when enrichment runs. Production key vs population `match` workload already contends — enrichment must share cooldown, not bypass it.
3. **Sticky FAILED / 404:** old matches outside Match-v5 retention stay `UNAVAILABLE`. UI must not look broken.
4. **eventIndex rewrite** on enrichment replace: build aggregation uses timestamp + index; tests must show ITEM order stable when kills are interleaved.
5. **Building `teamId` semantics** must be fixture-locked; wrong owner team would invert the objective feed.

---

## 20. Documentation

Update README with `GET /api/matches/:matchId/timeline` and the Timeline tab. Document new env vars on `.env.example`, `apps/api/.env.example`, and `apps/worker/.env.example` (no secrets), including `MATCH_TIMELINE_SEARCH_BACKFILL_ENABLED=false` and why it stays off until production Riot capacity allows.
