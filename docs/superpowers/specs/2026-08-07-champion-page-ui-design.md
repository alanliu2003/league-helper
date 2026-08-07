# Milestone 10 Design: Champion Page UI + Data Binding

**Date:** 2026-08-07
**Status:** Phase 0 approved (visibility minimum corrected to 1); Phase 1 in progress
**Branch:** `milestone-10-champion-page-ui` (from `master` @ `91a019f`, Task 4 merged)
**Plan:** `docs/superpowers/plans/2026-08-07-champion-page-ui.md`

---

## 1. Goals

Make `/champions/:championKey` a polished, League-themed champion detail surface that:

- Treats the champion (splash, portrait, name, title, tags) as the visual subject
- Binds to real collected-sample aggregates already produced by Milestone 8–9
- Shows sample size prominently and communicates low-sample confidence honestly
- Distinguishes **detail data availability** from **ranking eligibility** (30-game floor)
- Reuses existing `--lh-*` design system and champion route helpers
- Keeps metadata, exact stats, position breakdown, and (later) matchups independently stateful

### Success criteria (implementation end-state)

Navigating to `/champions/Ahri` (or another canonical key) yields a page where:

1. Champion identity is immediately recognizable via splash + name/title/icon
2. Patch / position / tier / platform / queue context is clear
3. Available aggregate stats render without fabrication
4. Games/sample size is visible (not a footnote)
5. `sampleSize < 30` shows Limited / low-sample treatment without implying ranking confidence
6. Ranking eligibility remains governed by `CHAMPION_AGGREGATION_MIN_SAMPLE = 30`
7. Position switching updates URL + stats cleanly
8. Supported performance metrics (KDA, CS/min, DPM, etc.) render from backend-derived fields
9. Matchups appear only when a real read path exists; otherwise deferred — never mocked
10. Mobile layout remains usable; no collector/scheduler internals leak

---

## 2. Non-goals

- Redesigning player pages (`PlayerHero`, `RankedOverview`, `MasteryShowcase`, match history)
- Redesigning champion directory beyond tiny navigation fixes if required
- Lowering `CHAMPION_AGGREGATION_MIN_SAMPLE`
- Scraping OP.GG / U.GG or adding external stats providers
- AI-generated champion advice
- Builds / items / runes (unless already present — they are not)
- Public collector / scheduler / discoveryDepth / budget UI
- Parallel routes (`/champion/:id`, `/champ/:name`)
- Fabricating pick rate, ban rate, or matchup numbers
- Committing unless explicitly requested

---

## 3. League UI Concept decisions (locked)

Carried forward from the League UI Concept discussion:

| #   | Decision                                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------- |
| 1   | Strongly League-themed, not a generic analytics dashboard                                                  |
| 2   | Champion splash art is a major visual element                                                              |
| 3   | Use splash/background imagery instead of letter-placeholder identity                                       |
| 4   | Entry from directory, future matchup links, and other internal champion links                              |
| 5   | **No** redundant adjacent-champion header chips (e.g. “Ahri / Aatrox”)                                     |
| 6   | Identity via hero: splash, portrait, name, title, role/tags context                                        |
| 7   | Same visual language as player pages: dark surfaces, restrained gold, strong imagery, clear stat hierarchy |
| 8   | Avoid a grid of generic SaaS cards; champion remains the subject                                           |

---

## 4. Current repository reality

### 4.1 What already ships (Milestone 8)

Functional champion surfaces already exist:

| Surface       | Path                                                                                                                                                                                               |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Directory     | `apps/web/pages/champions/index.vue`                                                                                                                                                               |
| Detail        | `apps/web/pages/champions/[championKey].vue`                                                                                                                                                       |
| Composables   | `useChampionApi`, `useChampionDetailPage`, `useChampionStatsFilters`                                                                                                                               |
| Components    | `ChampionDetailHero`, `ChampionSampleOverview`, `ChampionPerformanceCards`, `ChampionPositionBreakdown`, `ChampionLimitationsPanel`, `ChampionConfidenceIndicator`, filters/ranking/directory grid |
| Route helpers | `buildChampionPath`, case canonicalization, numeric key rejection                                                                                                                                  |

Detail page already:

- Loads metadata independently of stats
- Syncs filters to URL (`platform`, `queue`, `tier`, `position`, `patch`)
- Uses splash/icon URLs from API DTOs (no frontend CDN construction)
- Shows sample overview, performance cards, five-role breakdown, limitations panel
- Uses `useHead({ title })` (title only; no rich SEO description yet)

Known UX gaps from the Nuxt / player-pattern audits ([Audit Nuxt champion UI](0dd7f33b-3cba-43e7-851c-b627b5cd6dfe), [Audit player page patterns](5db4d62c-de7b-4b8c-b397-9f44a521dd13)):

- Detail “Back to champions directory” is hardcoded to `/champions` and drops aggregate filter query
- Loading states are text-only; `.lh-skeleton` exists but is unused on champion pages
- Stats refetch currently clears prior metrics immediately (player pages often preserve last-good content + `aria-busy`)
- Detail reimplements filter controls inline rather than sharing `ChampionFilterBar` (optional extract — not required)

### 4.2 Authoritative route

Canonical: `/champions/:championKey`

Preserve:

- Case-insensitive resolution
- Canonical key `replace` (e.g. `ahri` → `Ahri`)
- Numeric-only params rejected
- Links via `buildChampionPath` / directory helpers

### 4.3 Public API endpoints (exact)

| Method | Path                                | Role                                        |
| ------ | ----------------------------------- | ------------------------------------------- |
| `GET`  | `/api/champions`                    | Static directory list                       |
| `GET`  | `/api/champions/:championKey`       | Static metadata                             |
| `GET`  | `/api/champions/:championKey/stats` | Exact stats + five-role `positionBreakdown` |
| `GET`  | `/api/champion-stats`               | Ranking table (**position required**)       |
| `GET`  | `/api/champion-stats/filters`       | Defaults + available filter metadata        |

Shared contracts: `packages/shared/src/champion-api.ts`.

**No public matchup, pick-rate, ban-rate, tier-distribution, or patch-trend endpoints.**

### 4.4 ChampionAggregate metrics exposed today

Public `ChampionAggregateMetrics`:

- `sampleSize`, `wins`, `winRate`, `wilsonInterval`, `sampleConfidence`
- `aggregateKdaRatio`
- `averageCsPerMinute`, `averageDamagePerMinute`, `averageVisionScorePerMinute`
- `averageGoldDifferenceAt10/15`, `averageCsDifferenceAt10/15`
- `latestEligibleMatchAt`, `calculatedAt?`

Stored but not publicly averaged: `totalKills` / `totalDeaths` / `totalAssists` / `totalCs`.

Not stored: pick counts, ban counts, kill participation, total gold / GPM.

### 4.5 MatchupAggregate

Prisma model exists (`MatchupAggregate`) with directional dims + `sampleSize`/`wins` + optional early diffs.

**No worker writer, no Nest read repository/service/controller, no shared public DTO.**
Milestone 8 explicitly deferred matchups. **Not ready for binding.**

### 4.6 Pick / ban reality

- `MatchTeam.bans Int[]` is persisted from Riot match teams
- No champion ban/pick aggregation columns or DTO fields
- No population denominator aggregate for pick/ban rates
- Computing `championGames / arbitrary collectedMatches` in Vue is **forbidden**

### 4.7 Sample floor — confirmed defect for detail product intent

Config: `CHAMPION_AGGREGATION_MIN_SAMPLE` default **30** (`champion-stats.config.ts`).

Default detail read path:

1. `computeEffectiveMinimumSample` → 30 unless `includeInsufficient=true`
2. `findExactAggregate` / `findPositionBreakdown` apply `sampleSize: { gte: minimumSample }`
3. Rows with 1–29 games become `stats: null` + `emptyReason: BELOW_MINIMUM_SAMPLE`
4. Frontend `useChampionDetailPage` does **not** pass `includeInsufficient`

**Verdict:** Detail statistics are currently gated by the ranking floor. This conflicts with the desired product rule:

- Detail: show when `sampleSize >= 1`, with low-sample labeling
- Ranking: remain ineligible below 30
- Zero-sample / missing rows: no detail stats (do **not** use `minimumSample: 0` / `gte 0`, which could surface a persisted zero-sample row)

Static metadata (`GET /api/champions/:key`) is **not** sample-gated.

---

## 5. Data availability matrix

Legend:

- **A** — Available now via public API
- **B** — Available but not currently exposed / needs read or client bind work
- **C** — Model/pipeline partial; needs backend work
- **D** — Not currently supported

| UI field                 | Backend source                              | Current endpoint                             | Available? | Sample semantics                   | Required work                                                                                     |
| ------------------------ | ------------------------------------------- | -------------------------------------------- | ---------- | ---------------------------------- | ------------------------------------------------------------------------------------------------- |
| Champion name            | `ChampionStaticData`                        | `GET /api/champions/:key` (+ stats envelope) | **A**      | n/a                                | Bind (exists)                                                                                     |
| Title                    | static                                      | same                                         | **A**      | n/a                                | Bind (exists)                                                                                     |
| Icon                     | API-built DD URL                            | same                                         | **A**      | n/a                                | Use `iconUrl` only                                                                                |
| Splash                   | API-built DD splash                         | same                                         | **A**      | n/a                                | Elevate hero treatment                                                                            |
| Roles / tags             | `tags[]` (DD classes)                       | same                                         | **A**      | n/a                                | Display as tags; not lane roles                                                                   |
| Patch                    | filters + `resolvedFilters` / `sampleScope` | filters + stats                              | **A**      | aggregate patch, not static-only   | Keep filter bar                                                                                   |
| Position                 | query + dims                                | stats                                        | **A**      | exact five roles                   | Radiogroup URL sync                                                                               |
| Tier filter              | `tier` query                                | stats                                        | **A**      | rank-at-ingestion                  | Keep; show semantics                                                                              |
| Sample size / games      | `metrics.sampleSize`                        | stats                                        | **A***     | *hidden today if &lt;30 by default | **Phase 1: ungate detail**                                                                        |
| Wins                     | `metrics.wins`                              | stats                                        | **A***     | same                               | Phase 1                                                                                           |
| Losses                   | `sampleSize - wins`                         | client derive                                | **B**      | same                               | Keep derive; optional DTO later                                                                   |
| Win rate                 | `metrics.winRate`                           | stats                                        | **A***     | same                               | Phase 1 + low-sample UI                                                                           |
| Pick rate                | —                                           | —                                            | **D**      | no denominator                     | Silently omit from public primary UI (no placeholder copy)                                        |
| Ban rate                 | `MatchTeam.bans` only                       | —                                            | **D**      | bans not aggregated                | Silently omit from public primary UI (no placeholder copy)                                        |
| KDA                      | `aggregateKdaRatio`                         | stats                                        | **A***     | formula in match-analytics         | Bind after ungate                                                                                 |
| Avg K/D/A                | totals in Prisma                            | —                                            | **C**      | would need DTO                     | **Out of scope this milestone** — use `aggregateKdaRatio`                                         |
| CS absolute              | `totalCs`                                   | —                                            | **C**      | only CS/min public                 | Optional                                                                                          |
| CS/min                   | `averageCsPerMinute`                        | stats                                        | **A***     |                                    | Bind                                                                                              |
| DPM                      | `averageDamagePerMinute`                    | stats                                        | **A***     |                                    | Bind                                                                                              |
| Vision/min               | `averageVisionScorePerMinute`               | stats                                        | **A***     |                                    | Bind                                                                                              |
| GD/CSD @10/@15           | averages                                    | stats                                        | **A***     | timeline samples                   | Bind; null = unavailable                                                                          |
| Gold / GPM               | —                                           | —                                            | **D**      |                                    | Omit                                                                                              |
| Kill participation       | —                                           | —                                            | **D**      |                                    | Omit                                                                                              |
| Position breakdown       | `positionBreakdown[5]`                      | stats                                        | **A***     | also sample-floored today          | Phase 1 ungate + responsive polish                                                                |
| Position pick share      | breakdown samples                           | client                                       | **B**      | share among roles with data only   | Optional; never invent zeros                                                                      |
| Tier distribution        | per-tier rows                               | no multi-tier API                            | **D**      |                                    | Out of scope                                                                                      |
| Matchup / counters       | `MatchupAggregate` schema                   | none                                         | **D**      |                                    | Follow-up backend/data milestone; Phase 4 readiness gate only (expected SKIP)                     |
| Ranking position         | table order                                 | `GET /api/champion-stats`                    | **B**      | eligible only ≥30                  | **Omit hero ranking badge** this milestone unless Phase 5 finds an already-available cheap source |
| Ranking eligibility      | floor + confidence                          | table + `sampleConfidence`                   | **A**      | ≥30 eligible for ranking table     | Keep floor; do not imply from detail alone                                                        |
| Patch comparison / trend | —                                           | —                                            | **D**      |                                    | Out of scope                                                                                      |

---

## 6. Sample-size product behavior (locked)

Do **not** lower `CHAMPION_AGGREGATION_MIN_SAMPLE` (default 30).

| Constant                                                   | Value  | Role                                                           |
| ---------------------------------------------------------- | ------ | -------------------------------------------------------------- |
| `detailVisibilityMinimumSample`                            | **1**  | Exact + position-breakdown detail reads (`sampleSize >= 1`)    |
| `rankingMinimumSample` / `CHAMPION_AGGREGATION_MIN_SAMPLE` | **30** | Ranking table eligibility + `insufficientBelow` for confidence |

| `sampleSize`      | Detail UI / API                                                     | Ranking                    |
| ----------------- | ------------------------------------------------------------------- | -------------------------- |
| missing row / `0` | Empty / no-data (`stats: null`); not valid detail data              | Not listed                 |
| `1–29`            | Show stats + **Limited sample** / `sampleConfidence = INSUFFICIENT` | Not ranking-eligible       |
| `≥30`             | Show stats; confidence LOW/MEDIUM/HIGH by existing thresholds       | Eligible for ranking table |

Backend approach (Phase 1):

- Detail exact + breakdown reads use **`detailVisibilityMinimumSample = 1`** (never `0` — `gte 0` could admit a zero-sample row)
- Ranking table continues to use configured ranking minimum (30)
- `sampleConfidence` / Wilson still computed with `insufficientBelow = rankingMinimumSample` (30)
- Envelope `effectiveMinimumSample` remains the **ranking/confidence floor** (typically 30), not the detail visibility threshold — document in tests; do not rename the DTO this milestone
- Detail must not emit `BELOW_MINIMUM_SAMPLE` for visible 1–29 rows
- Backend detail contract is correct by default — do **not** rely on Nuxt passing `includeInsufficient=true`

UI treatment example:

```text
Win Rate
54.2%
18 games · Limited sample
```

Avoid a giant page-level warning banner for every low-sample champion; prefer contextual messaging beside affected stats.

---

## 7. Approaches considered

| Approach                               | Summary                                                                                                  | Trade-off                                                      |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **A — Evolve M8 detail (recommended)** | Keep route/composables/API; fix detail sample floor; restyle hero/primary stats; defer pick/ban/matchups | Fastest path to League-feel; reuses tested URL/state machinery |
| B — Greenfield rewrite                 | New components + new fetch layer                                                                         | High churn; regression risk; little API gain                   |
| C — Skin-only                          | Visual polish without ungate                                                                             | Looks nicer but still blank for 1–29 game champions            |

**Recommendation: Approach A.**

---

## 8. Page architecture

### 8.1 Component tree (target)

```text
ChampionDetailPage ([championKey].vue)
├── ChampionNotFound                    # only CHAMPION_NOT_FOUND
├── ChampionDetailHero                  # splash subject + identity + optional eligible rank badge
├── ChampionContextBar                  # position radiogroup + platform/queue/tier/patch
├── ChampionPrimaryStats                # WR / games / confidence (+ rank when eligible)
├── ChampionPerformancePanel            # KDA, CS/min, DPM, vision, GD/CSD
├── ChampionPositionBreakdown           # five roles; desktop table / mobile stacked
├── ChampionMatchups                    # PHASE 4 ONLY if backend ready
│   ├── StrongAgainst
│   └── WeakAgainst
└── ChampionDataLimitations             # existing limitations + collected-sample copy
```

Deviations from the user’s provisional names:

- Keep `ChampionDetailHero` / `ChampionLimitationsPanel` names where they already exist; evolve in place
- `ChampionSampleOverview` evolves into / is replaced by `ChampionPrimaryStats` (win rate first, sample size first-class)
- **No pick/ban slots** until backend supports correct denominators
- **Matchups** remain a gated later group, not a fake empty section with mock rates

### 8.2 Per-component contract

#### ChampionDetailHero

| Aspect         | Spec                                                                                                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Responsibility | Splash-backed identity; name, title, icon, tags; patch/position context summary; **no hero ranking badge** this milestone (unless Phase 5 finds a cheap already-available source) |
| Data           | `ChampionDetail` (+ optional rank payload later)                                                                                                                                  |
| Loading        | Skeleton or muted placeholder while metadata pending; do not block whole page forever                                                                                             |
| Empty          | Gradient fallback if splash fails (`@error`)                                                                                                                                      |
| Low-sample     | Not hero’s job; no “Ahri/Aatrox” chips                                                                                                                                            |
| Mobile         | Shorter hero (`min-height` capped); keep overlay contrast; avoid full-viewport splash                                                                                             |

#### ChampionContextBar

| Aspect         | Spec                                                                        |
| -------------- | --------------------------------------------------------------------------- |
| Responsibility | Filters that the backend supports: platform, queue, tier, patch, position   |
| Data           | `ChampionStatsFiltersResponse` + URL-authoritative filter state             |
| Loading        | Disable controls while filters resolving                                    |
| Empty          | Patch “Unavailable” when no aggregate patches                               |
| A11y           | Position = `radiogroup` / `role="radio"` + `aria-checked` (already present) |
| Mobile         | Stacked selects; position wraps                                             |

Do **not** add filters the API cannot honor.

#### ChampionPrimaryStats

| Aspect         | Spec                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| Responsibility | High-priority: Win rate, games/sample, W–L, confidence; ranking placement only if eligible data exists |
| Data           | `stats.metrics` when position selected                                                                 |
| Loading        | Section-local status, not whole-page blank                                                             |
| Empty          | Position required / no data / filters exclude                                                          |
| Low-sample     | Show numbers + Limited sample; do not hide                                                             |
| Mobile         | 2-column or stacked metric blocks; large tabular nums                                                  |

**Silently omit pick rate / ban rate** from primary UI — no placeholders and no “denominator unavailable” messaging.

#### ChampionPerformancePanel

| Aspect                       | Spec                                                              |
| ---------------------------- | ----------------------------------------------------------------- |
| Responsibility               | Present backend-derived performance metrics only                  |
| Data                         | Same `metrics` object                                             |
| Loading / empty / low-sample | Independent section states; null metrics → “unavailable”, not `0` |
| Mobile                       | Responsive grid (existing 2/3 columns pattern)                    |

Frontend formats; does **not** redefine KDA/Wilson formulas.

#### ChampionPositionBreakdown

| Aspect         | Spec                                          |
| -------------- | --------------------------------------------- |
| Responsibility | Five roles with games + win rate + confidence |
| Data           | `positionBreakdown`                           |
| Empty role     | “No data” — never fabricated 0%               |
| Low-sample     | Show with INSUFFICIENT after Phase 1 ungate   |
| Mobile         | Stacked rows/cards; desktop compact table     |

#### ChampionMatchups (gated)

Matchups are a **follow-up backend/data milestone**. Milestone 10 Phase 4 is only a readiness gate and is expected to record `SKIPPED — backend prerequisite` if writer/read API still do not exist. **Do not ship a mock counter section.**

#### ChampionDataLimitations

Keep collected-sample disclaimer, rank-at-ingestion semantics, platform/queue prominence. Contextual, not dominant.

---

## 9. Independent data states

| Concern            | Loading                     | Loaded                | Empty                | Error                                                      | Notes                                                                                                                     |
| ------------------ | --------------------------- | --------------------- | -------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Metadata           | text/skeleton               | hero                  | n/a                  | banner; page may continue if only filters fail differently | `CHAMPION_NOT_FOUND` → full not-found                                                                                     |
| Exact stats        | section status / skeleton   | primary + performance | no position / no row | section error banner                                       | Hero still visible; prefer preserve last-good metrics while refetching when filters unchanged enough to avoid blank flash |
| Position breakdown | with stats response         | table/cards           | all null             | inherits stats error                                       | Same request today                                                                                                        |
| Matchups           | n/a until API               | —                     | —                    | —                                                          | Deferred                                                                                                                  |
| Filters meta       | resolving gate for controls | ready                 | —                    | banner                                                     | Existing pattern                                                                                                          |

Do **not** collapse the whole page because one analytics request failed.

---

## 10. Route / filter behavior

Public query params (canonical): `platform`, `queue`, `tier`, `position`, `patch`.

- URL is authoritative after filter meta resolve + single `replace`
- Directory `search` / `tag` never carried onto detail
- `queueId` alias → canonicalize to `queue`
- Position change updates URL in place and refetches stats
- Canonical champion key replace focuses `#champion-detail-heading`

---

## 11. Data flow

```text
/champions/:championKey?position=MIDDLE&…
        │
        ▼
useChampionDetailPage + useChampionApi
        │
        ├─ GET /api/champion-stats/filters
        ├─ GET /api/champions/:championKey          → ChampionStaticService
        └─ GET /api/champions/:championKey/stats    → ChampionStatsService
                │
                ├─ ChampionStaticRepository (+ media URL builder)
                └─ ChampionAggregateReadRepository
                        │
                        └─ Prisma ChampionAggregate
```

Matchups (future):

```text
GET /api/champions/:key/matchups  (does not exist)
  → Matchup read service → MatchupAggregate
```

**Rule:** Vue formats and presents; Nest + `match-analytics` own formulas.

### Where changes are needed

| Layer                                                      | Change                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------- |
| `ChampionAggregateReadRepository` / `ChampionStatsService` | Detail visibility vs ranking floor separation             |
| Tests (unit + integration)                                 | Sub-30 detail returns metrics; table still filters        |
| `useChampionDetailPage`                                    | Consume ungated detail; low-sample presentation flags     |
| Hero / PrimaryStats / Performance / Breakdown components   | League UI Concept polish + low-sample UX                  |
| Shared DTO                                                 | Only if exposing avg K/D/A or rank index (optional)       |
| Matchups                                                   | Separate prerequisite — writer + DTO + read API before UI |

---

## 12. Responsive strategy

| Viewport | Behavior                                                                                                                         |
| -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Desktop  | Tall splash hero with overlay; primary metrics in a clear row; breakdown table                                                   |
| Tablet   | Same structure; filters 2×2; metrics wrap                                                                                        |
| Mobile   | Reduced hero height; stacked filters; large primary stats; breakdown as stacked rows; no awkward wide tables without alternative |

Avoid: full-viewport mobile hero, tiny counter cards, gold-on-art low contrast.

Reuse player-page patterns (`PlayerHero` scrim, section `aria-labelledby`, token surfaces) without editing player components.

---

## 13. Accessibility

Required:

- Sufficient overlay contrast over splash
- Semantic headings (`h1` champion name; section `h2`s)
- Keyboard-accessible filters; position radiogroup semantics
- Meaningful link labels (champion names, not “click here”)
- Splash decorative `alt=""`; icon `alt="{name} icon"`
- Selected position via `aria-checked` (not color alone)
- Win/loss not color-only
- Prefer `prefers-reduced-motion` if new transitions are added

---

## 14. Visual design system

Reuse existing tokens and primitives:

- `--lh-*` colors, borders, surfaces, gold accent
- `lh-container`, `lh-surface-raised`, `lh-input`, `font-display`
- Existing spacing / radius conventions

Do **not** introduce a separate champion-page theme. Splash provides personality; panels stay on-system.

---

## 15. Asset rules

- Use API-provided `iconUrl` / `splashUrl` only
- No hard-coded ddcdn URLs in Vue
- No inferring splash from champion name in components
- No third-party champion image CDN
- No shipping copyrighted splash assets into the repo

---

## 16. SEO / metadata

Current: `useHead({ title: '{name} · Champions' })`.

Plan (non-blocking polish):

- Keep title
- Add `useSeoMeta` description from name + title + collected-sample framing when metadata loads
- Do not block milestone on advanced SEO

---

## 17. Performance

- Keep current split: filters + metadata + one stats request (breakdown included)
- Do not fetch all ~173 champions’ stats to render one page
- Abort stale stats requests on filter/position change (already tokenized)
- Prefer eager splash for LCP; avoid layout shift with reserved hero min-height
- Ranking badge, if added, must be a targeted request — not a full table download of all champions unless already cached for directory

---

## 18. Low-data reality

UI must look intentional for 0 / 1 / 8 / 29 / 30+ games.

A 2-game page is still a valid champion page: hero + context + limited stats + clear confidence — never a blank “error” shell.

---

## 19. Directory → detail navigation

Directory grid + ranking rows already use `buildChampionPath`. Preserve that. Future matchup cards must use the same helper. No duplicate identity/router logic.

Detail → directory back link should use `buildChampionsDirectoryPath` with current aggregate filters (not a bare `/champions` that drops context).

---

## 20. Backend prerequisites

### Phase 1 required (this milestone)

1. Separate detail visibility (`detailVisibilityMinimumSample = 1`) from ranking eligibility (`CHAMPION_AGGREGATION_MIN_SAMPLE = 30`)
2. Tests proving table still filters at 30; detail shows 1–29 with `INSUFFICIENT`; zero/missing → no stats
3. Do **not** expand DTO with average K/D/A — `aggregateKdaRatio` is sufficient

### Explicitly deferred / later groups

| Item                             | Status                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------- |
| Pick rate                        | Needs denominator model + aggregation                                                 |
| Ban rate                         | Needs ban aggregation from `MatchTeam.bans` + denominator                             |
| Matchup writer + public read API | Schema-only today — follow-up milestone; M10 Phase 4 = readiness gate (expected SKIP) |
| Patch trend / comparison         | Deferred since M8                                                                     |
| Tier distribution endpoint       | Not present                                                                           |
| Public collector UI              | Forbidden                                                                             |

---

## 21. Frontend changes required (summary)

1. Evolve hero toward League UI Concept (stronger splash hierarchy; no adjacent chips)
2. Elevate primary stats (WR + games first-class; low-sample treatment)
3. Wire post-Phase-1 ungated metrics into overview/performance/breakdown
4. Responsive/a11y polish pass
5. Basic SEO description
6. E2E updates for low-sample detail visibility
7. Do not redesign directory or player pages

---

## 22. Implementation phases (gates)

Each phase **STOP FOR REVIEW**. Do not commit unless explicitly requested.

| Phase | Focus                                                                                                 |
| ----- | ----------------------------------------------------------------------------------------------------- |
| **0** | Audit + this spec + plan (current)                                                                    |
| **1** | Backend detail/ranking floor separation + tests                                                       |
| **2** | Hero + context bar + primary stats (League visual + low-sample)                                       |
| **3** | Performance panel + position breakdown responsive polish                                              |
| **4** | **SKIPPED — backend prerequisite** (2026-08-07 review: schema-only; no writer/read API/DTO/semantics) |
| **5** | Responsive/a11y/SEO polish, Playwright, real-data smoke                                               |

---

## 23. Locked Phase 0 decisions (approved)

1. **Hero ranking badge:** Omit this milestone unless Phase 5 finds an already-available cheap source. Do not add a rankings-table request just for the hero.
2. **Pick / ban rates:** Silently omit from public primary UI. No placeholders or internal “denominator unavailable” messaging.
3. **Average K/D/A:** Do not expand the DTO this milestone. `aggregateKdaRatio` is sufficient.
4. **Matchups:** Follow-up backend/data milestone. Milestone 10 Phase 4 is only a readiness gate; expected `SKIPPED — backend prerequisite` if writer/read API still absent.
5. **Detail visibility minimum:** `detailVisibilityMinimumSample = 1` (not 0).

---

## 24. Success criteria checklist (spec-level)

- [ ] Detail returns stats for `1 <= sampleSize < 30` with `INSUFFICIENT`; zero/missing → no stats
- [ ] Ranking table still excludes `< 30`
- [ ] Splash-led hero without adjacent champion chips
- [ ] Sample size visible beside primary win rate
- [ ] No fabricated pick/ban/matchup numbers
- [ ] Position URL sync + radiogroup a11y preserved
- [ ] Independent section error/empty states
- [ ] Mobile usable
- [ ] No collector internals on public UI

---

## 25. Spec self-review notes

- No intentional placeholders for required product decisions; open questions are explicit
- Sample-floor defect and pick/ban/matchup gaps are consistent across matrix and phases
- Scope stays on champion detail (+ minimal backend readiness); player pages untouched
- Approach A selected; Phase 4 matchups gated rather than ambiguous
