# M12-v2 Matchup / Counter Data Readiness Audit

**Date:** 2026-08-12  
**Branch:** `milestone-12-continuous-population-operations-v2`  
**Working DB:** `league_helper_m12v2` (read-only; `league_helper` untouched)  
**Scope:** Pre–Phase 6D audit only — no Riot calls, no MatchupAggregate writer, no API/UI work  
**Artifact:** `apps/api/.local/m12v2-matchup-audit/matchup-readiness-audit.json`

---

## Primary answer

**Given matches already stored in `league_helper_m12v2`, can we derive reliable champion-vs-champion lane matchup statistics now?**

| Question | Answer |
| -------- | ------ |
| 1. Raw source data available? | **Yes** — complete for queue 420 / na1 / current patch |
| 2. `MatchupAggregate` schema exists? | **Yes** — Prisma model + table since init schema |
| 3. `MatchupAggregate` writer exists? | **No** |
| 4. Matchup aggregation triggered? | **No** — table row count **0** |
| 5. Public matchup API/DTO exists? | **No** |
| 6. Frontend consumes matchup data? | **No** — e2e explicitly asserts no matchup/counter copy |
| 7. Why counters are absent | **Combination:** missing writer + missing API + missing FE binding + **pair sample depth far below displayable floors** |

**Verdict:** `DATA_EXISTS_BUT_MORE_SAMPLE_DEPTH_REQUIRED`

Raw lane-matchup observations are derivable today with excellent pairing quality, but the densest directional pairs peak at **n=9**, with **0 pairs ≥10**. Champion-position cells ≥30 do **not** imply opponent-pair depth ≥30.

---

## Raw data availability

Scope measured: `platformRoute=na1`, `queueId=420`, `ingestionStatus=COMPLETED`, `remake=false`, current patch **`16.15`** (435 matches).

| Field | Present on source rows? | Notes |
| ----- | ----------------------- | ----- |
| Match identity | Yes | `Match.id` / `externalMatchId` |
| `championId` | Yes | 4350/4350 participants |
| `teamId` | Yes | 100/200 on all in-scope rows |
| Normalized position | Yes | Via `normalizeParticipantPosition` (teamPosition → individualPosition → lane+role); UTILITY→SUPPORT |
| Win/loss | Yes | `win` boolean on all rows |
| Patch | Yes | `normalizedPatch` |
| Queue | Yes | `queueId=420` |
| Participant rank tier / resolution | Yes | `rankResolutionStatus` + `rankTierAtIngestion`; 4347/4350 `RESOLVED_RANKED` in scope |

**Conclusion:** Required source fields for lane matchups are present. Source data is **not** the blocker.

---

## Opposing-position pairing quality

Pairing rule used for this audit (aligned with existing `findRoleOpponent` in `timeline-metrics.service.ts` + shared `normalizeParticipantPosition`):

1. Exclude remakes and non-COMPLETED matches.
2. Normalize each participant to `TOP | JUNGLE | MIDDLE | BOTTOM | SUPPORT | UNKNOWN`.
3. For each reliable position, require **exactly one** participant on team 100 and **exactly one** on team 200.
4. If UNKNOWN, duplicate on a team, missing opponent, or multiple opponents → **skip** (do not invent pairs).
5. Same-champion mirror (`championId == opponentChampionId`) excluded (DB CHECK on `MatchupAggregate`).
6. Each valid lane slot emits **two** directional observations (A→B and B→A).

### Handling matrix

| Case | Handling |
| ---- | -------- |
| UNKNOWN position | No pair for that participant/slot |
| Duplicate position on a team | Slot skipped (`multipleOpponents`) |
| Missing opposing position | Slot skipped (`missingOpponent`) |
| Remake | Match excluded (same as ChampionAggregate eligibility) |
| Malformed team composition (≠10 participants) | Flagged; no invented pairs |
| Same champion both sides | Excluded (schema forbids) |

### Current-patch results (16.15 / 420 / na1)

| Metric | Value |
| ------ | ----- |
| Eligible matches | **435** |
| Matches with 10 participants | **435** |
| Matches with ≥1 valid opposing pair | **435** |
| Matches with all 5 lane pairs | **435** |
| Matches with zero valid pairs | **0** |
| Valid undirected lane slots | **2175** (435 × 5) |
| Valid directional observations | **4350** |
| UNKNOWN / duplicate / missing / malformed skips | **0** |
| Observations by position | TOP/JUNGLE/MIDDLE/BOTTOM/SUPPORT = **435 each** |

Pairing quality on the current dataset is excellent. Existing ingestion already computes lane-opponent GD/CSD using the same uniqueness rule — further evidence that raw pairing is viable.

---

## Current matchup sample distribution

Derived **directly from `MatchParticipant`** (diagnostic only — **not** written to `MatchupAggregate`).

| Metric | Value |
| ------ | ----- |
| Unique directional champion-vs-champion-position pairs | **3392** |
| Champion-position ALL cells with sampleSize ≥30 (same scope) | **31** (confirms Phase 6C coverage) |
| `MatchupAggregate` live rows | **0** |

### Pair sample-size floors (directional pairs)

| Floor | Unique pairs |
| ----- | ------------ |
| ≥1 | **3392** |
| ≥5 | **18** |
| ≥10 | **0** |
| ≥20 | **0** |
| ≥30 | **0** |
| ≥50 | **0** |

### Proof that champion-position ≥30 ≠ matchup ≥30

Examples from strongest ALL cells:

| Champion | Position | Cell sampleSize | Unique opponents | Max opponent games | Opponents ≥5 | Opponents ≥10 |
| -------- | -------- | --------------- | ---------------- | ------------------ | ------------ | ------------- |
| Thresh | SUPPORT | 59 | 30 | 6 | 1 | 0 |
| Jhin | BOTTOM | 58 | 30 | 9 | 3 | 0 |
| Graves | JUNGLE | 53 | 31 | 5 | 1 | 0 |
| Ahri | MIDDLE | 51 | 32 | 4 | 0 | 0 |
| Kai'Sa | BOTTOM | 49 | 27 | 7 | 2 | 0 |

Opponent mass is spread thinly across many champions.

---

## Highest-volume real matchup examples

No PUUID / player identities. Symmetric pairs shown where both directions appear in the top set.

| Champion | Position | Opponent | Games | Wins | Losses | Win rate |
| -------- | -------- | -------- | ----- | ---- | ------ | -------- |
| Jhin | BOTTOM | Tristana | 9 | 5 | 4 | 55.6% |
| Tristana | BOTTOM | Jhin | 9 | 4 | 5 | 44.4% |
| Ezreal | BOTTOM | Kai'Sa | 7 | 5 | 2 | 71.4% |
| Kai'Sa | BOTTOM | Ezreal | 7 | 2 | 5 | 28.6% |
| Thresh | SUPPORT | Nautilus | 6 | 5 | 1 | 83.3% |
| Nautilus | SUPPORT | Thresh | 6 | 1 | 5 | 16.7% |
| Bard | SUPPORT | Nami | 6 | 4 | 2 | 66.7% |
| Nami | SUPPORT | Bard | 6 | 2 | 4 | 33.3% |
| Jayce | TOP | Olaf | 5 | 5 | 0 | 100% |
| Graves | JUNGLE | Wukong | 5 | 4 | 1 | 80% |

These prove source data can support counter analysis **in principle**. They do **not** meet a serious product display floor.

---

## Existing architecture audit

| Component | Classification | Evidence |
| --------- | -------------- | -------- |
| `MatchupAggregate` Prisma model / table | **EXISTS_BUT_UNUSED** | `schema.prisma` + init migration; live row count **0** |
| DB CHECKs (`championId ≠ opponent`, non-neg samples) | **EXISTS_AND_ACTIVE** | Integration tests enforce constraints |
| Lane-opponent pairing helper (ingestion GD/CSD) | **PARTIAL** | `findRoleOpponent` in timeline metrics — used for early diffs, **not** matchup aggregates |
| Matchup aggregation service / writer | **MISSING** | No worker module; champion-aggregation path only writes `ChampionAggregate` |
| Matchup aggregation queue / job | **MISSING** | No enqueue/processor |
| Public matchup DTO (`packages/shared`) | **MISSING** | No matchup schemas/types |
| Nest matchup read API | **MISSING** | No controller/service/repo beyond truncate-table test cleanup names |
| Frontend composables / Strong Against / Weak Against | **MISSING** | No components; e2e forbids matchup/counter copy |
| Product design intent | **EXISTS_BUT_UNUSED** | M10/M11 docs name matchups as next-boundary work; M12-v2 explicitly excludes matchups |

Prior gate (Milestone 10 Phase 4, 2026-08-07): **SKIPPED — backend prerequisite**. That status is unchanged for writer/API/DTO/UI; what changed is that **raw population depth now makes diagnostic derivation possible**.

### Intended pipeline and where it stops

```text
MatchParticipant  ✅ present
        ↓
lane matchup pairing  ✅ derivable (also used for GD/CSD)
        ↓
MatchupAggregate writer  ❌ STOP — never implemented (table empty)
        ↓
public DTO + Nest read API  ❌ missing
        ↓
Champion page Strong/Weak Against  ❌ missing (intentionally deferred)
```

**Chain stops immediately after source pairing:** schema shell exists; no production writer or read path.

---

## Missing pipeline pieces

To make counters real (still **not** started by this audit):

1. **Writer** — rebuild/incremental `MatchupAggregate` from eligible paired participants (same eligibility family as ChampionAggregate: COMPLETED, non-remake, normalized patch/platform/queue/position).
2. **Trigger** — post-ingestion / reconcile job (or extend aggregation lifecycle) that does not race ChampionAggregate correctness.
3. **Shared DTO + Nest read API** — directional list with sampleSize/wins/winRate + opponent identity (key/name/icon from static data).
4. **Frontend binding** — Strong Against / Weak Against only after API + sample policy exist (M10 rule: no placeholders/mock numbers).
5. **Population depth** — enough matches that many pairs clear the chosen display floor (currently none ≥10).

---

## Rank semantics

M12-v2 locked rule: ranked stats use **participant** resolution — never root/TrackedPlayer rank.

`MatchupAggregate.rankTier` is a **single** dimension on a directional row `(championId → opponentChampionId)`. Existing docs do **not** spell an explicit matchup rank policy beyond that shape.

### Recommended definition (compatible with ChampionAggregate)

For a matchup observation **Ahri MIDDLE vs Syndra MIDDLE**:

| Bucket | Uses |
| ------ | ---- |
| `ALL` | Observation counted regardless of Ahri’s resolution state (same ALL independence rule) |
| Exact tier (e.g. `GOLD`) | Only when **Ahri** (subject / `championId`) is `RESOLVED_RANKED` to that tier |
| `UNKNOWN` | Only when **Ahri** is `RESOLVED_UNRANKED` |
| Opponent Syndra’s rank | **Does not** select Ahri’s rank bucket |

**Rationale:** Viewing “Ahri · Middle · Gold” should mean “Ahri games where Ahri’s resolved rank was Gold,” including whatever opponent she faced. Filtering on both participants’ ranks (or only the opponent) would silently diverge from ChampionAggregate and shrink samples further.

**Not assumed as locked product law until review accepts it.** Alternative (same-rank-only matchups) would need an explicit product decision and likely a different key or filter.

Do **not** use TrackedPlayer / product-root rank for matchup filtering.

---

## Matchup semantics

### Observation

One **directional** observation:

> Subject champion **C** in normalized position **P** played a valid non-remake ranked match against exactly one opposing champion **O** also in **P**, and **C**’s win/loss is recorded.

Example: Ahri MIDDLE vs Syndra MIDDLE → one observation for Ahri’s outcome in that match.

### Symmetry (no double-count of the same direction)

From one valid lane slot:

- Ahri vs Syndra → Ahri win (or loss)
- Syndra vs Ahri → Syndra loss (or win)

Writer must emit **both** directions once each. It must **not** increment `Ahri vs Syndra` twice for the same match.

### Denominator / win rate

```text
sampleSize = count of directional observations for
             (patch, platform, regional, queue, rankTier, position, championId, opponentChampionId)

wins       = count of those observations where subject.win = true
losses     = sampleSize - wins
winRate    = wins / sampleSize
```

Optional early diffs (`goldDifferenceAt*` / `csDifferenceAt*`) already exist on the schema and can reuse lane-opponent metrics when present; null samples must not invent averages.

---

## Recommended matchup sample floor

Do **not** reuse ChampionAggregate ranking floor **30** as the matchup display floor without measuring pair sparsity — current DB has **0** pairs ≥10, let alone ≥30.

| Floor | Current DB support | Product note |
| ----- | ------------------ | ------------ |
| ≥5 | 18 pairs | Bare exploratory / “limited sample” only — still thin |
| ≥10 | **0** | Not yet available |
| ≥20 | **0** | Not yet available |
| ≥30 | **0** | Same as champion ranking floor — not reachable yet |

### Counter eligibility status

| Option | Fits now? |
| ------ | --------- |
| A. Already statistically displayable for some champions | **No** (if honest floors ≥10 or ≥20) |
| B. Technically derivable but mostly low-sample | **Yes** |
| C. Impossible because required source fields missing | **No** |

**Recommendation:**

- Treat matchup **display** floor as a separate constant from champion ranking floor 30.
- Candidate product policy for a future matchup milestone: show pairs at `sampleSize ≥ 10` with strong limited-sample labeling below a higher confidence bar (e.g. 20/30); **do not** ship Strong/Weak lists on n&lt;10 just to fill UI.
- Today even ≥10 is empty — population / pair depth must grow before UI is useful.

---

## Can counter analysis be shown now?

**No — not as trustworthy product counters.**

Absence is a **combination** of:

1. Missing aggregate writer (table empty)
2. Missing public API / DTO
3. Missing frontend binding
4. Pair sample depth too low for honest floors (≥10/≥20/≥30 all empty)

It is **not** caused by missing Match/MatchParticipant fields or unusable role pairing on current patch.

---

## Recommendation

**`DATA_EXISTS_BUT_MORE_SAMPLE_DEPTH_REQUIRED`**

Operational guidance for review (no implementation started):

1. **Do not** begin Phase 6D solely to “unlock counters”; 6D is population representation, not the matchup milestone.
2. **Do not** implement Strong/Weak UI until writer + API exist **and** a non-trivial set of pairs clears the chosen floor.
3. Pipeline implementation can be planned as a **follow-up milestone** (schema already reserved); pairing rules and rank semantics above should be approved first.
4. Continue representative population if the goal is pair depth — champion-position ≥30 is necessary but far from sufficient for counters.

---

## STOP FOR REVIEW

No MatchupAggregate writer, API, frontend, historical UNKNOWN repair, or new Riot acquisition was performed in this audit.
