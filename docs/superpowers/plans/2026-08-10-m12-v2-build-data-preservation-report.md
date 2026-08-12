# M12-v2 Build-Data Preservation Checkpoint Report

**Date:** 2026-08-11  
**Branch:** `milestone-12-continuous-population-operations-v2`  
**Working DB:** `league_helper_m12v2` (root / api / worker verified; `league_helper` untouched)  
**Decision:** `READY_TO_RESUME_M12_V2_POPULATION_ACQUISITION`

Build analytics aggregation/API/UI is deferred to a later milestone.

---

## Primary answer

**Before this checkpoint:** ingestion was **lossy for OP.GG-style build analytics**. Final non-empty items, flat perk IDs, summoner spells, and skill order existed, but empty item slots, perk style tree IDs, and all item purchase-path timeline events were discarded (`MATCH_STORE_RAW_PAYLOADS=false`, no event table).

**After this checkpoint (new matches only):** yes — persisted source data is sufficient to later derive final items, rune setup, summoner spells, item purchase path, and skill order **without refetching Riot**, using normalized participant columns + `MatchTimelineEvent` rows (not full raw payload retention).

Historical matches already in `league_helper_m12v2` remain partially lossy (documented below). No Riot backfill was performed.

---

## Current ingestion architecture

```text
Riot Match-v5 detail
  -> RiotGameDataProvider.getMatch (RiotMatchDtoSchema)
  -> normalizeMatch (match-normalizer)
  -> persistNormalizedMatch (Match / MatchParticipant / MatchTeam)

Riot Match-v5 timeline
  -> RiotGameDataProvider.getTimeline (RiotMatchTimelineDtoSchema)
  -> normalizeTimeline (frames + flat events in memory)
  -> extractBuildRelevantTimelineEvents  [NEW]
  -> calculateTimelineMetrics (gold/CS/XP diffs, skillOrder, …)
  -> persistTimelineAndMetrics
       -> MatchTimeline (status; rawPayload only if MATCH_STORE_RAW_PAYLOADS)
       -> MatchTimelineEvent (ITEM_* / SKILL_LEVEL_UP)  [NEW]
       -> MatchParticipant metric columns (incl. skillOrder)
```

`MATCH_STORE_RAW_PAYLOADS` remains **false** by default. Full raw match/timeline JSON is intentionally not required for build preservation (privacy/storage).

---

## Preservation matrix

| Source field/event | Provider has it? | Persisted? | Lossless? | Future use? | Action |
| --- | --- | --- | --- | --- | --- |
| match id / queue / patch / duration | Yes | Yes (`Match`) | Yes | Dimensions | Keep |
| participantId / championId / teamId / win | Yes | Yes | Yes | Join + filters | Keep |
| teamPosition (raw) + normalized position | Yes | Raw persisted; normalize at aggregate/read | Yes for raw | Position filter | Keep |
| item0–item6 incl. empty 0 | Yes | **Was:** filtered `>0` only → **Now:** 7-slot array | New: yes / Hist: partial | Final build slots | Fixed extract |
| perk selections (rune IDs) | Yes | `perkIds[]` | Yes (selection IDs) | Rune pages / WR | Keep |
| primary/secondary style IDs | Yes | **Was:** discarded → **Now:** columns | New: yes / Hist: null | Rune page trees | Added columns |
| stat shards | Yes | `statPerkIds[]` | Yes | Rune page | Keep |
| summoner1Id / summoner2Id | Yes | Yes | Yes | Spell combos | Keep |
| K/D/A, gold, CS, damage | Yes | Yes | Yes | Context | Keep |
| ITEM_PURCHASED / SOLD / UNDO / DESTROYED | Yes | **Was:** transient → **Now:** `MatchTimelineEvent` | New: yes / Hist: absent | Purchase path / cores / boots | Added table |
| ITEM_UNDO beforeId/afterId | Yes | **Now:** `beforeItemId` / `afterItemId` | New: yes | Undo-correct path | Schema fields |
| SKILL_LEVEL_UP (+ skillSlot, levelUpType) | Yes | skillOrder + event rows | New: dual / Hist: skillOrder only | Skill order / max | Events + keep skillOrder |
| firstCompletedItem* | Derived | Always null today | N/A | First-item timing | Reconstruct later from events + ItemStatic |
| Match/participant/timeline `rawPayload` | Yes | Off by default (0/111 matches) | N/A | Reprocess | Keep off; not required |
| Full timeline frames / kills / wards | Yes | Metrics only; frames discarded | Partial | Not build-core | No change |

---

## Existing DB reconstructibility

Audited on `league_helper_m12v2` (111 COMPLETED matches, 1110 participants, 111 FETCHED timelines, **0** raw payloads).

| Capability | Verdict | Notes |
| --- | --- | --- |
| Final item build | **PARTIAL** historically / **YES** new | Hist: non-zero items only (slots collapsed). New: full item0–item6 with zeros. |
| Runes | **PARTIAL** historically / **YES** new | Hist: selection + stat IDs only (no style trees). New: + primary/secondary style IDs. Keystone = first primary selection. |
| Summoner spells | **YES** | Both IDs non-zero for 1110/1110. |
| Item sequence | **NO** historically / **YES** new | Hist: timeline events discarded. New: `MatchTimelineEvent`. |
| First-item timing | **NO** historically / **PARTIAL→YES** new | `firstCompletedItem*` still null by design; reconstruct from purchase events + ItemStatic “completed” metadata later. |
| Core 2/3-item sequence | **NO** historically / **YES** new | Needs purchase path + item graph. |
| Boots timing | **NO** historically / **YES** new | Needs purchase path + boots item IDs from static data. |
| Skill order | **YES** | `skillOrder` non-empty for 1109/1110. New also stores SKILL_LEVEL_UP events. |
| Skill max priority | **YES** | Derivable from skillOrder (slot frequency / completion order). |

---

## Minimal fixes made

1. **Final inventory slots:** `extractItemIds` keeps zeros for item0–item6.  
2. **Perk styles:** persist `primaryPerkStyleId` / `secondaryPerkStyleId` on `MatchParticipant`.  
3. **Timeline build events:** `extractBuildRelevantTimelineEvents` + `MatchTimelineEvent` persistence for `ITEM_PURCHASED`, `ITEM_SOLD`, `ITEM_UNDO`, `ITEM_DESTROYED`, `SKILL_LEVEL_UP`.  
4. **DTO clarity:** documented `beforeId` / `afterId` on timeline event schema.  
5. **Did not** enable raw payload retention, implement aggregates/APIs/UI, or refetch Riot.

Riot budget coordinator / pacing: **unchanged**.

---

## Migration

- Migration: `apps/api/prisma/migrations/20260811140000_m12v2_build_data_preservation/migration.sql`
- Applied only to **`league_helper_m12v2`** after active-DB verification
- No historical backfill (style columns null; 0 timeline event rows for existing matches)
- Operator note: `prisma generate` hit Windows `EPERM` rename on `query_engine-windows.dll.node` while a process held the file. Migration SQL applied successfully; regenerate when API/worker are stopped if IDE/types lag.

---

## Tests

Fixture-driven persistence coverage (DB-shaped mock store + normalizer):

| Test | Coverage |
| --- | --- |
| `match-normalizer.test.ts` | 7-slot items, perk styles, summoner IDs |
| `timeline-build-events.test.ts` | purchase / sell / undo(+before/after) / destroy / skill; excludes CHAMPION_KILL |
| `match-persistence.test.ts` (`build-data preservation persistence`) | persisted participant inventory/runes/spells; persisted timeline events joinable by matchId+participantId |
| Existing processor / metrics suites | still green with event persistence wired |

Commands:

```bash
pnpm --filter @league-helper/worker exec vitest run `
  src/queues/match-ingestion/match-normalizer.test.ts `
  src/queues/match-ingestion/timeline-build-events.test.ts `
  src/queues/match-ingestion/match-persistence.test.ts `
  src/queues/match-ingestion/match-ingestion.processor.test.ts
```

Result this session: **55/55 passed** in the match-ingestion suite set above.

---

## Storage impact

Estimates from current COMPLETED corpus (avg ~14.5 skill events/participant):

| Metric | Estimate |
| --- | --- |
| Rows added per match | ~500–600 `MatchTimelineEvent` (skill + item ops; not full frames) |
| Bytes / match (events) | ~70 KB row payload ballpark (excl. index overhead) |
| Bytes / match (new participant cols) | ~240 B (style IDs + denser item arrays) |
| Indexes added | unique `(matchId, eventIndex)`; `(matchId, participantId, timestampMs)` |
| Indexes deliberately **not** added | `itemId`, standalone `type`, standalone `timestampMs`, GIN on arrays |

Compared with enabling full timeline `rawPayload`, this is smaller and avoids retaining unrelated frame/PUUID-heavy JSON.

---

## Historical limitations

For the **111** already-ingested matches:

- Cannot reconstruct item purchase path / boots timing / core sequences without Riot refetch
- Empty inventory slots not recoverable from `itemIds`
- Perk style tree IDs null (selections still present)
- `firstCompletedItem*` remains null everywhere (derivation deferred; needs ItemStatic completeness flags)
- `ItemStaticData` / `RuneStaticData` row counts are currently **0** (champions synced only). IDs are stored; presentation metadata sync is a later static-data task, not a match-source gap for new rows
- No SummonerSpell static table yet — spell **IDs** are preserved and sufficient for later Data Dragon resolution

Do not hide this: historical build-path analytics require optional targeted refetch if product needs them.

---

## UNKNOWN aggregate sanity check

Read-only Phase-4-style audit on queue **420** (position-normalized: `UTILITY` → `SUPPORT`):

| Metric | Value |
| --- | --- |
| `RESOLVED_UNRANKED` participants | **5** |
| Expected UNKNOWN keys (exact + ALL-position) | **10** |
| Existing UNKNOWN aggregate rows | **133** (145 samples) |
| Matched keys / sampleSize | **10 / exact match** |
| Orphan UNKNOWN keys | **123** (135 samples) |
| Current PENDING (420) | **14** (not contributing to UNKNOWN under current rules) |

**Interpretation**

- **Current writes are correct:** live `RESOLVED_UNRANKED` contributors map 1:1 to expected UNKNOWN keys with matching `sampleSize`.
- **Stale/orphan keys confirmed:** mostly champions that are now `RESOLVED_RANKED` (or still PENDING) on 16.15 — leftover UNKNOWN materializations from earlier null→UNKNOWN / transition waves without empty-row cleanup.
- **Not** evidence of PENDING→UNKNOWN conversion in current eligibility code.

**Minimal future repair recommendation (do not implement now):**

1. Recompute UNKNOWN keys from `RESOLVED_UNRANKED` sources only.  
2. Delete UNKNOWN aggregate rows with zero current contributors (same empty-row deletion posture as other rank transitions).  
3. Do not “fix” by deleting source matches or forcing unresolved→UNKNOWN.

---

## Future analytics boundary

Deferred derived families (must read only stored source + static IDs):

| Aggregate | Source inputs | Shared dimensions |
| --- | --- | --- |
| `ItemAggregate` | final `itemIds`, optional purchase events | championId, position, patch, queue, rankTier, platform |
| `BuildAggregate` | purchase path → 2/3-core + final | same |
| `RuneAggregate` | style IDs + `perkIds` + `statPerkIds` | same |
| `SpellAggregate` | summonerSpell1/2 | same |
| `SkillOrderAggregate` | `skillOrder` / SKILL_LEVEL_UP events | same |

Rules:

- Derive entirely from persisted match source (+ Data Dragon static for names/boots/completed flags)
- Always retain sample size; never claim full-population coverage
- No live-match advice; no unofficial MMR

Build analytics aggregation/API/UI is deferred to a later milestone.

---

## Files changed / added

### Production

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260811140000_m12v2_build_data_preservation/migration.sql`
- `apps/worker/src/queues/match-ingestion/match-normalizer.ts`
- `apps/worker/src/queues/match-ingestion/timeline-build-events.ts`
- `apps/worker/src/queues/match-ingestion/match-persistence.ts`
- `apps/worker/src/queues/match-ingestion/match-ingestion.processor.ts`
- `packages/server-riot/src/riot-api.schemas.ts`

### Tests / local audit artifacts

- `apps/worker/src/queues/match-ingestion/match-normalizer.test.ts`
- `apps/worker/src/queues/match-ingestion/timeline-build-events.test.ts`
- `apps/worker/src/queues/match-ingestion/match-persistence.test.ts`
- `apps/worker/src/queues/match-ingestion/match-ingestion.processor.test.ts`
- `apps/api/.local/m12v2-build-preservation/*` (verify/audit scripts + JSON outputs)
- This report

### Untouched (as required)

- Real `.env` / `apps/api/.env` / `apps/worker/.env`
- Old DB `league_helper`
- Riot budget coordinator
- Phase 6C / large acquisition waves
- Build analytics aggregates / APIs / frontend / matchups
- Git commit

---

## Decision

**`READY_TO_RESUME_M12_V2_POPULATION_ACQUISITION`**

Rationale: after the minimal persistence fix, **new** ingestions preserve the source fields needed for later build analytics without Riot refetch, without enabling raw-payload retention, and without changing rank aggregation or Riot pacing. Historical loss and UNKNOWN orphan rows are documented for later optional repair — neither blocks bounded population resume.

**Stop state:** data-preservation checkpoint complete — stopped for review. Do **not** begin Phase 6C or large acquisition until this report is approved.
