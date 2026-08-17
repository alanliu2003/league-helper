# Milestone 18 Design: Match Detail / Match Information

**Date:** 2026-08-17  
**Status:** Draft — awaiting external review (not implemented)  
**Branch:** `milestone-18-match-detail` (from `master` @ `702fb3b`, M17 merged)  
**Plan:** `docs/superpowers/plans/2026-08-17-m18-match-detail.md`

---

## 1. Goal

Add an OP.GG-like **specific match detail experience** using only data League Helper already stores.

The player page already lists recent matches. A match card must no longer be a dead end. Clicking a match opens a dedicated page that answers:

> What happened in this specific game?

M18 is **deterministic data + frontend UX**. AI is not required and must not be added.

### User-facing features (this milestone)

1. **Dedicated match-detail page** at `/matches/:matchId`
2. **Dedicated match-detail API** `GET /api/matches/:matchId`
3. **Clickable match cards** on the player page that navigate to that page
4. **Neutral match header** (winning side, queue, patch, duration) plus optional origin-player highlight
5. **Both teams**, all participants, items / runes / spells, team objectives, and compact damage comparison
6. **Early-game diffs** where already persisted — not a full event timeline

### Success criteria

1. Direct paste of `/matches/:matchId` renders without originating-player state
2. Player-page navigation highlights the originating participant when `?player=` is present
3. A completed 10-player match returns both teams and every participant
4. Match history DTOs stay lightweight — detail is a separate contract
5. No PUUID, summoner id, raw payload, or API key appears in the public response or UI
6. Remakes are viewable and labeled; incomplete ingestions do not crash the page
7. No Prisma migration and no ingestion/crawler changes
8. Desktop and mobile remain usable; the participant table is not a shrunken 12-column spreadsheet

---

## 2. Non-goals

- AI match coaching, per-match LLM explanation, or M17 playstyle redesign
- VOD review, live spectating, replay viewer
- Full Riot timeline clone, gold-over-time graph, kill/item/skill/ward event timeline
- General match search by raw Riot match id
- Arbitrary performance scores / MVP unless a deterministic stored metric already exists (none does)
- New ingestion crawler, matchup aggregate rewrite, mainland Chinese servers
- Copying OP.GG branding or exact visual design (`ui.mdc`)
- Inflating `PublicMatchSummary` with full match-detail fields
- Hidden writes (search/import/enrollment) on ordinary match-detail GET/render
- Displaying `rankTierAtIngestion` as historical rank-at-game-time

---

## 3. Repository reality

### 3.1 Public routing and APIs already shipped

| Capability | Location |
| --- | --- |
| Player page | `/players/:playerId` (`apps/web/pages/players/[playerId].vue`) |
| Champion page | `/champions/:championKey` |
| Match history | `GET /api/players/:playerId/matches` → `PublicMatchSummary[]` |
| Match cards | `PlayerMatchCard` inside `PlayerMatchList` — **not a match-detail link** |
| Champion icons/items on cards | Mapped in `mapPublicMatch` using **current** Data Dragon version |
| Player identity | `PublicPlayer.id` is `Player.id` UUID; route uses that id |
| 404 pattern | `ResourceNotFoundError` → HTTP 404 `RESOURCE_NOT_FOUND` |
| PUUID guard | `assertNoPuuidLeak` on player responses |
| Static identities | `ChampionBuildStaticIdentity` `{ id, name, iconUrl }` used by champion builds |
| Queue labels | `getMatchQueueLabel(queueId)` in `@league-helper/shared` |
| Positions | `normalizeParticipantPosition` / `getNormalizedPositionLabel` |

There is **no** `GET /api/matches/:matchId`, **no** `/matches/` page, and **no** `MatchesModule`.

Nuxt pages are file-based. New page: `apps/web/pages/matches/[matchId].vue`.

### 3.2 Public match identifier (already on match cards)

`PublicMatchSummary` already exposes:

| Field | Meaning | Safe for routing? |
| --- | --- | --- |
| `id` | `Match.id` UUID | **Yes — use this** |
| `externalMatchId` | Riot match id (e.g. `NA1_123`) | Already public on cards; **do not use as the route** |

M18 reuses `Match.id`. Do not add a new public id. Do not create a Riot-match-id lookup endpoint.

The match-detail DTO **omits** `externalMatchId` so the new contract does not grow Riot-identifier surface. Leave the match-history DTO unchanged except navigation.

### 3.3 `Match` fields (exact)

From `apps/api/prisma/schema.prisma` model `Match`:

| Field | Stored | Public match-detail? |
| --- | --- | --- |
| `id` | UUID PK | Yes — route id |
| `provider` | string | Yes (`RIOT`) |
| `externalMatchId` | Riot match id | **No** on detail DTO |
| `platformRoute` | nullable | Yes, if present |
| `regionalRoute` | string | Yes |
| `gameId` | BigInt? | **No** (Riot numeric id) |
| `queueId` | int | Yes |
| `mapId` | int? | Yes |
| `gameMode` | string? | Yes |
| `gameType` | string? | Omit from v1 UI (queue label is enough) |
| `gameCreation` | timestamptz | Yes |
| `gameEndTimestamp` | timestamptz? | Yes, nullable |
| `gameDurationSeconds` | int | Yes |
| `gameVersion` | string | Yes |
| `normalizedPatch` | string? | Yes |
| `remake` | bool | Yes |
| `earlySurrender` | bool | Yes |
| `ingestionStatus` | enum PENDING/IN_PROGRESS/COMPLETED/FAILED/SKIPPED | Yes (existing public enum) |
| `normalizationVersion` | string | **No** |
| `rawPayload` | Json? | **Never** |
| `ingestedAt` / `createdAt` / `updatedAt` | timestamps | **No** |

Winning team is **not** stored on `Match`. Derive from `MatchTeam.win`.

Queue **label** is not stored; map via `getMatchQueueLabel`.

### 3.4 `MatchParticipant` fields (exact)

| Field | Stored | Match-detail v1 |
| --- | --- | --- |
| `id` | UUID | **No** (internal) |
| `matchId` | UUID | **No** (parent) |
| `participantId` | int 1–10 | Yes (ordering only) |
| `playerAccountId` | UUID? | **No**; join to `Player.playerId` when present |
| `externalAccountId` | PUUID | **Never** |
| `riotIdGameName` / `riotIdTagLine` | string? | Yes for untracked display |
| `championId` / `championName` | int / string? | Yes + Data Dragon key/icon/name |
| `teamId` | int | Yes |
| `teamPosition` / `individualPosition` / `lane` / `role` | raw Riot | **Never raw in public DTO**; expose `normalizeParticipantPosition(...)` |
| `rankTierAtIngestion` / `rankDivisionAtIngestion` / `rankResolutionStatus` / `rankResolvedAt` / `rankObservationId` | yes | **Omit from v1** (ingestion-time, not match-start rank) |
| `win` | bool | Yes |
| `kills` / `deaths` / `assists` | int | Yes; `kda` computed with `computePublicKda` |
| `largestKillingSpree` | int? | Omit from v1 (not a full multikill set) |
| `totalMinionsKilled` / `neutralMinionsKilled` | int | Optional secondary; `totalCs` is primary |
| `totalCs` | int | Yes; `csPerMinute` derived |
| `goldEarned` / `goldSpent` | int | Earned yes; spent omit from v1 |
| `totalDamageDealtToChampions` + physical/magic/true splits | int | Total yes; splits expandable/omit (total is enough for bars) |
| `totalDamageTaken` | int | Secondary / expandable |
| `visionScore` / `wardsPlaced` / `wardsKilled` / `controlWardsPurchased` | int / int? | Score always-or-secondary; wards expandable. Note: `controlWardsPurchased` is ingested from Riot `detectorWardsPlaced` |
| `timePlayedSeconds` | int | Not displayed; rates use `Match.gameDurationSeconds` to match match cards |
| `itemIds` | `Int[]` length 7 (`item0`–`item6`, `0` = empty) | Yes; slot 6 treated as trinket |
| `perkIds` | `Int[]` (primary style selections then secondary) | Keystone = `perkIds[0]` when present |
| `statPerkIds` | `Int[]` offense/flex/defense | Expandable only |
| `primaryPerkStyleId` / `secondaryPerkStyleId` | int? | Yes (tree icons/names when resolvable) |
| `summonerSpell1Id` / `summonerSpell2Id` | int (`0` = missing) | Yes |
| `goldAt10/15`, `csAt10/15`, `xpAt10/15` | int? | Expandable / origin early-game; **null means missing — never coerce to 0** |
| `goldDifferenceAt10/15`, `csDifferenceAt10/15`, `xpDifferenceAt10/15` | int? | Same |
| `deathsBefore10` / `deathsBetween10And20` | int? | Expandable |
| `deathsBeforeObjectives` | int? | Always null in current timeline metrics — omit |
| `firstCompletedItemId` / `firstCompletedItemAtSeconds` | int? | Omit from v1 (build timeline is M19) |
| `killParticipation` | float? 0–1 | Secondary |
| `skillOrder` | `Int[]` | **Defer** (skill-order timeline is M19) |
| `rawPayload` | Json? | **Never** |
| `createdAt` / `updatedAt` | timestamps | **No** |

**Not stored as columns** (present on Riot Match-v5 DTO / passthrough, not normalized):

- `champLevel` (champion level)
- healing / shielding (`totalHeal`, `totalHealsOnTeammates`, `totalDamageShieldedOnTeammates`, …)
- first blood / first tower **participant** flags
- double/triple/quadra/penta kills
- objective takedowns as a per-player metric
- live coordinates / per-minute gold series

Do **not** read `rawPayload` on the request path to recover these.

### 3.5 `MatchTeam` fields (exact)

| Field | Stored | Match-detail v1 |
| --- | --- | --- |
| `id` | UUID | **No** |
| `matchId` | UUID | **No** |
| `teamId` | int | Yes (`100` = Blue, `200` = Red; other ids → `Team {id}`) |
| `win` | bool | Yes |
| `earlySurrender` | bool | Available; match-level `earlySurrender` is enough for header |
| `bans` | `Int[]` champion ids (`> 0` already filtered at ingest) | Yes, compact ban icons |
| `objectives` | `Json?` | Parse known keys only (see §8) |
| timestamps | | **No** |

No participant aggregates are stored on the team row. Team gold / damage / kills are **summed from participants**.

### 3.6 Timeline storage reality (critical boundary)

League Helper persists **three** timeline-related things:

1. **`MatchTimeline`**
   - `fetchStatus`: `PENDING | FETCHED | FAILED | SKIPPED`
   - `rawPayload` Json? — **full Riot timeline when `storeRawPayloads` is on; often null**
   - `timelineSchemaVersion`, `fetchedAt`, `failureReason`
   - Must **not** be exposed or parsed on the M18 request path

2. **`MatchTimelineEvent`**
   - Compact **build/skill events only**: `ITEM_PURCHASED`, `ITEM_SOLD`, `ITEM_UNDO`, `ITEM_DESTROYED`, `SKILL_LEVEL_UP`
   - Comment in schema: *not full Riot timeline frames*
   - Historical matches may have **zero** rows
   - No `CHAMPION_KILL`, ward, building, or elite-monster events as typed rows

3. **Derived participant metrics** (written by `timeline-metrics.service.ts`)
   - Gold/CS/XP at 10 and 15, lane diffs vs unique same-position opponent
   - Deaths before 10 / 10–20
   - Kill participation
   - `deathsBeforeObjectives` is **always null in v1** of that service
   - `skillOrder` and first completed item (not used in M18 UI)

**There is no cheap, complete event timeline for kills/objectives/wards/gold graphs.** Frames and positions live only inside optional raw JSON.

`ingestionStatus = COMPLETED` does **not** imply timeline metrics exist. Timeline fetch is a separate lifecycle (`MatchTimeline.fetchStatus`).

### 3.7 Static-data infrastructure to reuse

| Need | Existing |
| --- | --- |
| Champion icon / name / key | `DataDragonChampionService.getChampionByNumericId` + `iconUrl` |
| Champion splash | `buildChampionSplashUrl` (optional, not required on rows) |
| Item icon URL | `DataDragonChampionService.buildItemIconUrl` |
| Item **name** | `ItemStaticData` by patch (`ChampionBuildsService.loadLookups` pattern) |
| Rune name / icon path | `RuneStaticData` + `buildRuneIconUrl` (versionless `/cdn/img/…`) |
| Rune tree name | `RuneStaticData.treeId` / `treeName` |
| Summoner spell name / image | `SummonerSpellStaticData` + `buildSummonerSpellIconUrl` |
| Queue label | `getMatchQueueLabel` |
| Role icon | **None** — use text labels |
| Patch static row | `Patch.normalizedMajorMinor` + `dataDragonVersion`; fallback `ChampionStaticRepository.resolveStaticPatch()` |

Champion **builds** resolve names against the **requested patch** with fallback to latest static patch. Player **match cards** currently build item icons from **current** Data Dragon version, not the match patch.

M18 match detail must follow the **champion-builds** convention: match `normalizedPatch` first, then latest static patch. Document the limitation: old matches may show current/fallback assets if that patch was never synced.

There is **no** item tooltip component in `apps/web`. Use `title` + accessible name text. Do not build a new tooltip library.

### 3.8 Player linking reality

- `MatchParticipant.playerAccountId` is set only when a `PlayerAccount` already exists for that PUUID at ingest/link time.
- Unlinked participants still store `riotIdGameName` / `riotIdTagLine` (nullable).
- `PlayerAccount.playerId` is the public `/players/:playerId` UUID.
- `TrackedPlayerEnrollmentSource.MATCH_PARTICIPANT` exists for **collector enrollment**, not for GET handlers.
- `GET /api/players/:playerId` works from `PlayerAccount`; it does not require an ACTIVE `TrackedPlayer` for the profile mapper itself.

M18 GET must **not** create `PlayerAccount` / `TrackedPlayer` rows.

### 3.9 Cache / security reality

- Player profiles: Redis `PlayerCacheService`
- Champion stats/builds: Redis generation keys
- Match detail: **no existing match-detail cache**
- Nest has **no** `@Throttle` / helmet on public HTTP routes today; CORS is restricted in `main.ts`
- `assertNoPuuidLeak` rejects payloads containing `externalAccountId` or `"puuid"`

Completed matches can still receive timeline metric backfills. Redis-caching match detail in M18 would serve stale null early-game fields. **Do not add Redis for M18.**

---

## 4. Data availability matrix

Legend: **NOW** = stored column/JSON we will expose; **DERIVE** = computed at API boundary; **DEFER** = not in M18.

### 4.1 Match header

| UI field | Status | Source |
| --- | --- | --- |
| Winning side | DERIVE | `MatchTeam.win` → “Blue Team Victory” / “Red Team Victory” / “Unknown result” |
| Remake | NOW | `Match.remake` wins over win/loss in the header |
| Queue | DERIVE | `getMatchQueueLabel(queueId)` |
| Patch | NOW | `normalizedPatch` or first two segments of `gameVersion` |
| Game date | NOW | `gameCreation` |
| Duration | DERIVE | `gameDurationSeconds` → `m:ss` |
| Platform | NOW | `platformRoute` (display via existing platform name helper when present) |
| Map / mode | NOW | `mapId` / `gameMode` as secondary text when present |
| Team score (kills) | DERIVE | Sum of participant kills per team, or parsed `objectives.champion.kills` (prefer sum of participants; see §8) |

### 4.2 Participant row — AVAILABLE NOW / DERIVABLE NOW

| Field | Status |
| --- | --- |
| Champion icon + name | NOW + static resolve |
| Champion level | **DEFER** (not a column) |
| Player Riot ID | NOW (account current name if linked, else match-time name) |
| Tracked player link | DERIVE from `playerAccount.playerId` |
| Rank / tier | **DEFER** (ingestion-time semantics) |
| Role | DERIVE `normalizeParticipantPosition` |
| K / D / A / KDA | NOW + `computePublicKda` |
| CS / CS/min | NOW + `computeCsPerMinute(totalCs, gameDurationSeconds)` |
| Gold / gold/min | NOW + duration |
| Damage to champions | NOW |
| Damage share | DERIVE `damage / teamDamage` when teamDamage > 0; else null |
| Vision score | NOW |
| Summoner spells | NOW + static resolve |
| Keystone + primary/secondary trees | NOW (`perkIds[0]`, style ids) + static resolve |
| Items 0–5 + trinket slot 6 | NOW; empty slots stay empty |
| Win/loss (participant) | NOW |

### 4.3 Secondary / expandable

| Field | Status |
| --- | --- |
| Kill participation | NOW, nullable |
| Damage taken | NOW |
| Wards placed / killed / control wards | NOW / nullable |
| Neutral CS vs lane CS | NOW (`neutralMinionsKilled`, `totalMinionsKilled`) |
| Gold/CS/XP and diffs @10/@15 | NOW, nullable — hide when null |
| Deaths before 10 / 10–20 | NOW, nullable |
| Stat shards | NOW when `statPerkIds` non-empty |
| Physical/magic/true damage split | NOW but **omit from v1 UI** (noise) |

### 4.4 NOT STORED / DEFERRED

Champion level, healing, shielding, first blood (player), multikills, per-player objective takedowns, item purchase timing, skill order UI, gold graph, kill feed, ward map, MVP score, historical rank-at-kickoff, Atakhan/voidgrubs as first-class types (not in our typed Riot team schema; ignore unknown JSON keys).

---

## 5. Timeline decision

**Decision: deferred full timeline; partial early-game from derived columns.**

| Layer | M18 |
| --- | --- |
| Full event timeline / gold graph / kill feed | **Deferred → M19** |
| `MatchTimeline.rawPayload` / `MatchTimelineEvent` reads | **Do not use** |
| Early gold/CS/XP diffs @10/@15 | **Included** in expandable row + origin “Early game” subsection when any non-null value exists |
| Kill participation / vision | **Included** as secondary stats |

Reasoning: typed events are build/skill only; frames are not a public table; pretending a Riot-like timeline exists would be dishonest. Derived 10/15 metrics are real and useful.

Public DTO includes `timeline: { status, metricsAvailable }` so the UI can say “Early-game timeline is still processing” vs “not available” vs hide the section when metrics exist.

Map:

| `MatchTimeline.fetchStatus` | `timeline.status` |
| --- | --- |
| no row / `PENDING` | `PENDING` |
| `FETCHED` | `AVAILABLE` |
| `FAILED` / `SKIPPED` | `UNAVAILABLE` |

`metricsAvailable` is true when any participant has a non-null 10/15 or KP field (same idea as match-card `timelineMetricsAvailable`).

---

## 6. Route and navigation

### 6.1 Routes

| Kind | Path |
| --- | --- |
| Page | `/matches/:matchId` |
| API | `GET /api/matches/:matchId` |
| Origin highlight | `/matches/:matchId?player=:playerId` |

`matchId` and `playerId` are League Helper UUIDs (`ParseUUIDPipe` on the API).

No `/players/:playerId/matches/:matchId` duplicate page.

### 6.2 Origin-player highlight

- Query param is **frontend-only**. The API does not take `player`.
- When `player` equals a participant’s public `playerId`, that row gets a highlight (`aria-current="true"`, distinct background/ring, visible “You” or Riot ID emphasis).
- Missing, invalid, or non-matching `player` is harmless — no highlight, page still renders.
- Do not hardcode the **match header** as Victory/Defeat from one player. Header is side-based. The player page match card already shows that player’s result.

### 6.3 Match-card click behavior

`PlayerMatchCard` currently nests champion `NuxtLink`s. Making the whole card a link would nest `<a>` tags (invalid).

**Locked:** the card’s **primary** action is a single match-detail link wrapping the card content. Champion name/icon on the card are **not** links (champion page remains reachable from match-detail champion icons). Preserve keyboard focus on that one link. `aria-label` includes result, champion, queue.

Queue filters and refresh on `PlayerMatchList` stay unchanged.

Helper: `buildMatchPath(matchId, playerId?: string)` in `apps/web/utils/match-links.ts`.

From the player page, pass the current route `playerId` as `?player=`.

### 6.4 Tracked vs untracked names

| Participant | Name | Click |
| --- | --- | --- |
| `playerAccountId` joined → `playerId` | Prefer `PlayerAccount.currentGameName` + `currentTagLine` | `NuxtLink` to `/players/:playerId` |
| Unlinked, Riot ID present | Match-time `riotIdGameName#riotIdTagLine` | Plain text |
| Neither | `Unknown player` | Plain text |

No search/import CTA in v1 (avoids hidden writes and extra product surface).

Champion icon on a participant row **may** link to `/champions/:championKey` when key is resolved (not nested inside another link).

---

## 7. Match-detail API

### 7.1 Endpoint

```text
GET /api/matches/:matchId
```

- Module: new `MatchesModule` / `MatchesController` (`@Controller('api/matches')`)
- Param: `ParseUUIDPipe`
- 404: `ResourceNotFoundError('Match not found.')` → `RESOURCE_NOT_FOUND`
- Invalid UUID: existing pipe / `VALIDATION_ERROR` (400)
- **No query params in v1**
- One DB read: `Match` + `teams` + `participants` + `playerAccount: { playerId, currentGameName, currentTagLine }` + `timeline: { fetchStatus }`
- **Select lists must omit** `rawPayload`, `externalAccountId`, `gameId`, rank observation internals
- Batch static lookups once per match (champions by id, items/runes/spells for the resolved patch)
- `assertNoPuuidLeak(response)` before return
- Mapper uses Zod `PublicMatchDetailSchema.parse(...)`

Do not fan out to profile/rank/mastery APIs.

### 7.2 Ingestion completeness

If the row exists, return **200** even when `ingestionStatus !== COMPLETED`.

| State | Behavior |
| --- | --- |
| COMPLETED, 10 participants, 2 teams | Full page |
| PENDING / IN_PROGRESS | Header + honest banner; render whatever participants/teams exist |
| FAILED / SKIPPED | Same; banner that ingestion did not complete |
| Zero participants | Header + empty-state copy; do not crash |
| Remake | Full page with Remake header |

Never 409 for “not ready”. Never 404 for an existing row.

### 7.3 Caching

**None in M18** (no Redis, no `Cache-Control` freshness). Primary-key read is cheap; timeline backfill would stale a cache.

### 7.4 Public DTO (locked shape)

Reuse `ChampionBuildStaticIdentitySchema` for non-empty items, spells, keystone, and rune styles. Empty item slots are a dedicated nullable slot object (identity schema requires `id` positive).

```ts
// packages/shared/src/match-detail.ts

export const PublicMatchTeamSideSchema = z.enum(['BLUE', 'RED', 'UNKNOWN']);

export const PublicMatchTimelineStatusSchema = z.enum([
  'PENDING',
  'AVAILABLE',
  'UNAVAILABLE',
]);

export const PublicMatchItemSlotSchema = z.object({
  slot: z.number().int().min(0).max(6),
  itemId: z.number().int().nonnegative(), // 0 = empty
  name: z.string().min(1).nullable(),
  iconUrl: z.string().url().nullable(),
});

export const PublicMatchObjectiveSchema = z.object({
  type: z.enum(['baron', 'dragon', 'riftHerald', 'tower', 'inhibitor', 'champion']),
  kills: z.number().int().nonnegative(),
  first: z.boolean().nullable(),
});

export const PublicMatchParticipantSchema = z.object({
  participantId: z.number().int().positive(),
  teamId: z.number().int(),
  playerId: z.string().uuid().nullable(),
  riotId: RiotIdSchema.nullable(),
  championId: z.number().int(),
  championKey: z.string().min(1).nullable(),
  championName: z.string().min(1).nullable(),
  championIconUrl: z.string().url().nullable(),
  teamPosition: NormalizedPositionSchema,
  win: z.boolean(),
  kills: z.number().int().nonnegative(),
  deaths: z.number().int().nonnegative(),
  assists: z.number().int().nonnegative(),
  kda: z.number().nonnegative().nullable(),
  totalCs: z.number().int().nonnegative(),
  csPerMinute: z.number().nonnegative().nullable(),
  goldEarned: z.number().int().nonnegative(),
  goldPerMinute: z.number().nonnegative().nullable(),
  totalDamageDealtToChampions: z.number().int().nonnegative(),
  damageShare: z.number().min(0).max(1).nullable(),
  totalDamageTaken: z.number().int().nonnegative(),
  visionScore: z.number().int().nonnegative(),
  wardsPlaced: z.number().int().nonnegative(),
  wardsKilled: z.number().int().nonnegative(),
  controlWardsPurchased: z.number().int().nonnegative().nullable(),
  killParticipation: z.number().min(0).max(1).nullable(),
  items: z.array(PublicMatchItemSlotSchema).length(7),
  summonerSpells: z.tuple([
    ChampionBuildStaticIdentitySchema.nullable(),
    ChampionBuildStaticIdentitySchema.nullable(),
  ]),
  keystone: ChampionBuildStaticIdentitySchema.nullable(),
  primaryPerkStyle: ChampionBuildStaticIdentitySchema.nullable(),
  secondaryPerkStyle: ChampionBuildStaticIdentitySchema.nullable(),
  statShards: z.array(ChampionBuildStaticIdentitySchema),
  goldAt10: z.number().int().nullable(),
  goldAt15: z.number().int().nullable(),
  csAt10: z.number().int().nullable(),
  csAt15: z.number().int().nullable(),
  xpAt10: z.number().int().nullable(),
  xpAt15: z.number().int().nullable(),
  goldDifferenceAt10: z.number().int().nullable(),
  goldDifferenceAt15: z.number().int().nullable(),
  csDifferenceAt10: z.number().int().nullable(),
  csDifferenceAt15: z.number().int().nullable(),
  xpDifferenceAt10: z.number().int().nullable(),
  xpDifferenceAt15: z.number().int().nullable(),
  deathsBefore10: z.number().int().nullable(),
  deathsBetween10And20: z.number().int().nullable(),
});

export const PublicMatchTeamTotalsSchema = z.object({
  kills: z.number().int().nonnegative(),
  deaths: z.number().int().nonnegative(),
  assists: z.number().int().nonnegative(),
  goldEarned: z.number().int().nonnegative(),
  damageDealtToChampions: z.number().int().nonnegative(),
  visionScore: z.number().int().nonnegative(),
});

export const PublicMatchTeamSchema = z.object({
  teamId: z.number().int(),
  side: PublicMatchTeamSideSchema,
  win: z.boolean(),
  bans: z.array(ChampionBuildStaticIdentitySchema),
  objectives: z.array(PublicMatchObjectiveSchema),
  totals: PublicMatchTeamTotalsSchema,
  participants: z.array(PublicMatchParticipantSchema),
});

export const PublicMatchDetailSchema = z.object({
  match: z.object({
    id: z.string().uuid(),
    queueId: z.number().int(),
    queueLabel: z.string().min(1),
    platform: PlatformRouteSchema.nullable(),
    regionalRoute: RegionalRouteSchema,
    mapId: z.number().int().nullable(),
    gameMode: z.string().min(1).nullable(),
    gameCreation: z.string().datetime(),
    gameEndTimestamp: z.string().datetime().nullable(),
    gameDurationSeconds: z.number().int().nonnegative(),
    gameVersion: z.string().min(1),
    normalizedPatch: z.string().nullable(),
    remake: z.boolean(),
    earlySurrender: z.boolean(),
    ingestionStatus: PublicMatchIngestionStatusSchema,
    winningSide: PublicMatchTeamSideSchema.nullable(), // null if remake or neither/both
  }),
  timeline: z.object({
    status: PublicMatchTimelineStatusSchema,
    metricsAvailable: z.boolean(),
  }),
  teams: z.array(PublicMatchTeamSchema),
});
```

`winningSide`: if `remake`, null (header uses Remake). Else the side of the unique winning team; null if none/both.

`damageShare` is vs **that team’s** damage total (standard OP.GG-like team share). The all-10 damage chart uses raw `totalDamageDealtToChampions` (see §9).

### 7.5 Team grouping and ordering

1. Partition participants by `teamId`.
2. Ensure a team object exists for every `MatchTeam` row even if participants are missing.
3. Order teams: `100` first (Blue), `200` second (Red), then any other `teamId` ascending.
4. Order participants **within a team**:

```text
TOP → JUNGLE → MIDDLE → BOTTOM → SUPPORT → UNKNOWN (stable by participantId)
```

Use normalized position, never raw `SOLO` / `DUO_*`.

5. Do not drop participants. Incomplete matches may have ≠ 10; the UI states the count.

ARAM / Arena / non-SR queues: `normalizeParticipantPosition` returns `UNKNOWN` for everyone — all ten still render, ordered by `participantId`.

### 7.6 Side mapping

```text
100 → BLUE
200 → RED
other → UNKNOWN
```

---

## 8. Objectives

Riot team `objectives` is stored as JSON. Documented keys (from `RiotMatchTeamDtoSchema`):

```text
baron, champion, dragon, inhibitor, riftHerald, tower
```

Each value: `{ first?: boolean, kills?: number }` (passthrough may contain extra keys).

**Parser rules** (`parseMatchTeamObjectives(json): PublicMatchObjective[]`):

1. If `objectives` is null/non-object → `[]`
2. For each **known** key, if the value is an object:
   - `kills` missing or invalid → skip that type (do **not** show 0 for missing)
   - `first` missing → `null`
3. Ignore unknown keys (`horde`, `atakhan`, `voidGrub`, …) — do not invent UI
4. UI order: dragon, baron, riftHerald, tower, inhibitor (champion kills shown as team score, not an “objective icon” row)

**Reliability:** counts/first flags are whatever Riot stored at ingest. Do not claim completeness of the global League dataset.

**Team kills:** `totals.kills` = sum of participant `kills`. If `objectives.champion.kills` disagrees, still display participant-sum as the score; do not silently mix.

Bans: resolve champion id → `ChampionBuildStaticIdentity` (icon + name). Unresolved id → `{ id, name: "Champion {id}", iconUrl: null }`.

---

## 9. UI architecture

Match existing League-themed surfaces (`--lh-bg`, `--lh-surface`, `--lh-victory`, `--lh-defeat`, `--lh-remake`). Add:

```css
--lh-team-blue: /* readable blue on dark bg */
--lh-team-red:  /* readable red on dark bg */
```

Do not copy OP.GG layout/branding.

### 9.1 Page sections

```text
MatchNotFound                         # 404 / invalid id
MatchIncompleteBanner                 # ingestionStatus !== COMPLETED
MatchRemakeBanner                     # remake (in addition to header)

MatchHeader
  winning side or Remake (text, not color-only)
  queue · patch · duration · played-at · platform
  optional map/mode

MatchTeamPanel × 2 (Blue then Red)
  side + Victory/Defeat text
  compact bans
  MatchObjectiveSummary (icons + counts; omit missing types)
  MatchTeamTotals (kills / gold / damage)
  MatchParticipantRow × N (ordered)

MatchDamageSection                    # all participants, CSS bars
MatchEarlyGameSection                 # only if origin player has any non-null 10/15 field
                                      # otherwise early diffs live in row expand only
```

No per-match AI block.

### 9.2 Participant row hierarchy

**Always visible**

- Champion icon (links to champion page when key exists)
- Riot ID (link or text)
- Role label
- K/D/A and KDA
- CS and CS/min
- Items 0–5 + trinket (empty slots visible)
- Two summoner spells
- Keystone (+ optional small primary/secondary tree icons)

**Secondary (desktop extra columns / mobile wrap)**

- Gold
- Damage to champions (+ optional % share)
- Vision score

**Expandable (`<details>` or button; keyboard accessible)**

- KP, damage taken, wards
- Early gold/CS/XP and diffs (skip nulls; never show `0` as a substitute for missing)
- Deaths before 10 / 10–20 when non-null
- Stat shards when present

**Deferred:** champ level overlay, rank pill, full rune page, skill order, item timings.

### 9.3 Damage visualization

**Included.** `totalDamageDealtToChampions` is stored; a CSS bar chart is deterministic and mobile-friendly.

- One section, all participants, descending damage
- Bar width = `damage / max(damage among participants)`
- Team color on the bar; origin highlight if applicable
- Show the number; no “MVP” label
- On remake: still show bars under the remake banner (no “carry of the game” copy)
- Skip the section if every participant damage is 0 and the match is incomplete

### 9.4 Early-game section

If `?player=` matches a participant **and** that participant has any non-null @10/@15 field, show a compact “Early game” block for **that player only** (gold/CS/XP diffs). Do not dump 10×6 early metrics on the main table.

Other players: same fields inside expand.

If `timeline.status === PENDING` and `metricsAvailable === false`, one line: early-game stats are still processing.

### 9.5 Remakes

Header: **Remake** (not Blue/Red Victory). Existing `--lh-remake`. Team panels list Blue/Red but **omit** Victory/Defeat labels. Still list players, items, objectives. Avoid performance ranking copy. Damage bars allowed without superlatives.

### 9.6 Mobile

Do **not** shrink a 12-column table.

- Stack Blue panel then Red panel
- Each participant is a compact card: identity row, KDA/CS row, spells+keystone+items row
- Secondary stats wrap or sit in expand
- Damage bars are full-width stacked rows
- No horizontal page overflow (same assertion as player-search e2e at 375px)

### 9.7 Accessibility

- Semantic headings (`h1` match identity, `h2` per team)
- Win/loss/remake as text, not color alone
- Images: `alt` = champion/item/rune/spell **name** (not “icon” only when name is known)
- Match card: one focusable link, Enter/Space via native `<a>`
- Expand controls are buttons/`<details>` with accessible names
- `title` on items is extra, not the only name
- Footer Riot legal notice already in `default` layout — keep it

---

## 10. Static-data versioning

1. Resolve `Patch` by `Match.normalizedPatch` (`normalizedMajorMinor`), newest `version` if multiple.
2. Else `ChampionStaticRepository.resolveStaticPatch()` (current/latest ready patch).
3. Item/spell CDN URLs use that row’s `dataDragonVersion`.
4. Rune icons use versionless `buildRuneIconUrl`.
5. Champion icons: prefer Data Dragon current champion metadata (stable keys) with icon URL built from the resolved patch version when available; if version missing, service `iconUrl` from current cache is acceptable (same as match cards).

**Limitation (honest):** League Helper does not guarantee a full Data Dragon snapshot for every historical patch. Icons/names may be best-effort fallback. Do not claim patch-perfect historical assets.

Do **not** parse match/participant `rawPayload` for assets.

---

## 11. Builds, runes, spells (v1 presentation)

**Items:** always 7 slots in stored order. Slot `6` = trinket column. `itemId === 0` → empty box, `name`/`iconUrl` null. Do not infer purchase order from timeline events.

**Spells:** resolve ids `> 0`; `0` → null identity.

**Runes:** show keystone (`perkIds[0]`) and primary/secondary **style** identities. Do **not** render a full 6-rune page. Stat shards only in expand.

If a perk/style/spell/item id has no static row: fallback name `Item 3031` / `Rune 8005` / `Spell 4`, `iconUrl` null (items/spells can still get a CDN URL from id+version even without a name row).

---

## 12. Rank decision

**Omit participant rank from M18.**

`rankTierAtIngestion` is rank observed during ingestion/enrichment, **not** guaranteed rank at game start (M17). Showing it without a long caveat is misleading; showing it with a caveat clutters every row. Revisit in a later milestone if a true historical snapshot exists.

---

## 13. Schema / ingestion impact

```text
none
```

No Prisma migration. No worker/normalizer changes. No new collector behavior.

### 13.1 Explicitly rejected for M18 (document only)

| Field | Why not now |
| --- | --- |
| `champLevel` | In Riot DTO, not a column. Useful overlay, not required to understand the game. Adding it needs ingest + backfill. |
| Healing / shielding / multikills | Same — optional future ingest, not essential for v1. |

If review later demands champion level, that is a **separate** ingest/schema change with justification — not silent scope creep.

---

## 14. Security / privacy

Public match detail must never include:

- PUUID / `externalAccountId` / summoner id / Riot `gameId`
- `rawPayload` of match, participant, or timeline
- `failureReason` from timeline fetch (may be internal)
- API keys
- Internal participant UUID / `playerAccountId`

Allowed: `Match.id`, public `playerId`, Riot **display** ID (`gameName` + `tagLine`) as already used on player pages.

`assertNoPuuidLeak` on the mapped payload. Mapper tests must include a linked participant whose account has a PUUID in the DB fixture and assert it does not appear in JSON.

Logging: do not log Riot IDs or PUUIDs (existing player-logging practice).

---

## 15. Frontend files (planned)

```text
apps/web/pages/matches/[matchId].vue
apps/web/composables/useMatchDetailPage.ts
apps/web/composables/useMatchApi.ts
apps/web/utils/match-links.ts
apps/web/components/match/MatchHeader.vue
apps/web/components/match/MatchTeamPanel.vue
apps/web/components/match/MatchParticipantRow.vue
apps/web/components/match/MatchObjectiveSummary.vue
apps/web/components/match/MatchDamageSection.vue
apps/web/components/match/MatchEarlyGameSection.vue
apps/web/components/match/MatchNotFound.vue
```

Plus tests beside each non-trivial unit. Visual language matches player/champion pages (`lh-container`, surface cards, Cinzel/Source Sans).

---

## 16. Testing strategy

### Shared DTOs (`packages/shared/src/match-detail.test.ts`)

- Full valid match
- Remake → `winningSide` null
- Unknown position preserved
- Empty item slots
- Null timeline metrics
- Objective parser: missing types omitted; unknown keys ignored; invalid kills skipped

### API

- Found COMPLETED 10-player match
- Unknown UUID → 404 `RESOURCE_NOT_FOUND`
- All participants returned, teams separated, position order
- Untracked participant: `playerId` null, riotId present, no PUUID
- Tracked participant: `playerId` set, names from account
- Incomplete ingestion 200
- Remake 200
- `assertNoPuuidLeak`
- Objectives JSON parsed
- No N+1: one match query (assert via repository test / select shape)

### Frontend unit

- Team panels render; 10 rows when fixture has 10
- Origin highlight when `player` matches; none when absent
- Item/rune/spell images when URLs present
- Remake header copy
- Missing timeline metrics hidden (not `0`)
- Match card is a link to `/matches/:id?player=`
- Champion links removed from the card (moved to detail)

### E2E (no live Riot)

Extend or add Playwright:

```text
search player → player page → click match card
→ /matches/:uuid?player=:playerId
→ both team headings visible
→ origin participant highlighted
→ click a tracked Riot ID → /players/:id
→ open /matches/:id without query → page still renders
```

Mock `GET /api/matches/:id` if the local DB is empty in that environment; if mock-provider search already ingested a match, prefer the real local API like current player-search e2e.

---

## 17. Documentation

Update README API list with `GET /api/matches/:matchId` and the player-page navigation note. No new env vars.

---

## 18. Locked decisions

1. Public route id = `Match.id` UUID; already on match cards as `id`.
2. Dedicated `GET /api/matches/:matchId`; do not inflate `PublicMatchSummary`.
3. New `MatchesModule` — not a method on `PlayersController`.
4. Header is side-based, not origin-player Victory/Defeat.
5. Origin highlight = `?player=` frontend-only.
6. Untracked names are plain text; no enroll-on-view.
7. Rank omitted.
8. Champion level omitted (no migration).
9. Damage CSS bars included; no MVP score.
10. Full timeline deferred to M19; early diffs from participant columns only.
11. Do not read raw timeline/match payloads in M18.
12. No Redis / HTTP cache.
13. Incomplete matches: 200 + banner.
14. Remakes viewable; header and team panels do not present Victory/Defeat.
15. Objectives: known Riot keys only; missing → omit.
16. Item slots: stored `item0`–`item6`; empty stays empty; slot 6 = trinket.
17. Runes v1: keystone + two trees, not a full page.
18. Static data: match patch then latest static patch (builds convention).
19. Rates use `gameDurationSeconds` (match-card consistency).
20. Match card becomes one match-detail link; nested champion links removed from the card.
21. Team order 100 then 200; roles TOP…SUPPORT then UNKNOWN.
22. No Prisma migration; no ingestion changes.
23. No AI.
24. 404 uses existing `RESOURCE_NOT_FOUND` (no new domain error code).
25. `externalMatchId` omitted from the new DTO.

---

## 19. Deferred to M19+

Candidates (do not implement now):

- M19 Match Timeline / gold graph / kill feed
- Item purchase timeline, skill order timeline, ward/objective event timeline
- Teamfight breakdown
- Per-match AI explanation
- Player-vs-opponent lane review beyond stored 10/15 diffs
- Champion level / healing / shielding / multikill ingest
- Historical rank-at-kickoff
- Atakhan / voidgrub first-class objectives
- Match search by Riot match id
- Untracked-player “import this player” CTA
- Redis cache after timeline status is terminal
- Full rune page / stat-shard art in the main row

---

## 20. Risks / unresolved issues

1. **Historical assets:** patch static data may be missing; fallback icons can be wrong for removed items. Accepted and labeled in §10.
2. **Linked-player coverage:** many lobby players will be untracked; the page will show plain Riot IDs. Accepted.
3. **E2E data:** player-search e2e may not have a COMPLETED 10-player match in every environment. Plan mocks a detail payload if needed.
4. **Public API rate limit:** repo still has no Nest throttle on public HTTP. M18 does not add a one-off limiter; residual process risk, not match-specific.
5. **`externalMatchId` already on match cards:** out of scope to remove; new DTO omits it.
6. **Objective JSON drift:** Riot may add keys; parser ignores them until a future spec.
7. **Review question (non-blocking):** whether `champLevel` is worth a follow-up ingest. Default for M18 is no.

---

## 21. Answers to the spec questions

1. **Match fields:** see §3.3.  
2. **Participant fields:** see §3.4.  
3. **Team fields:** see §3.5.  
4. **Timeline persisted:** raw optional JSON + build/skill events + derived 10/15 metrics; no full event table.  
5. **Show immediately:** identity, champ, role, KDA, CS, gold, damage, vision, items, spells, keystone/trees, team objectives, bans.  
6. **Derivable now:** KDA, CS/min, gold/min, damage share, team totals, winning side, queue label, normalized position, damage bars.  
7. **Unavailable:** champ level, rank-at-game, healing, shielding, multikills, player first-blood, full timeline, skill order UI.  
8. **Public id:** `Match.id` UUID.  
9. **Already on match-card DTO:** yes, `PublicMatchSummary.id`.  
10. **API:** `GET /api/matches/:matchId` + `PublicMatchDetailSchema` (§7.4).  
11. **Grouping:** teamId 100/200, positions TOP→SUPPORT then UNKNOWN.  
12. **Tracked links:** `playerAccount.playerId` → `/players/:playerId`.  
13. **Untracked:** plain Riot ID or “Unknown player”; no writes.  
14. **Rank:** omit.  
15. **Items:** `itemIds[0..6]` + patch static name + `buildItemIconUrl`.  
16. **Runes:** `perkIds[0]` keystone + style ids via `RuneStaticData` / `buildRuneIconUrl`.  
17. **Spells:** spell ids + `SummonerSpellStaticData` / `buildSummonerSpellIconUrl`.  
18. **Objectives:** parse known JSON keys; omit missing; ignore unknown.  
19. **Damage viz:** yes, CSS bars.  
20. **Timeline:** partial early-game only; full timeline deferred.  
21. **Remakes:** viewable, Remake header.  
22. **Incomplete:** 200 + banner + partial render.  
23. **Origin highlight:** `?player=` on the page, not the API.  
24. **Mobile:** stacked team cards, wrap/expand stats, no 12-column squeeze.  
25. **Caching:** none.  
26. **Prisma migration:** none.  
27. **Ingestion changes:** none.  
28. **Deferred:** §19 (M19+ timeline and related).
