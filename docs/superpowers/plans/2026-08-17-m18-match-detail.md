# Milestone 18 Match Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a dedicated match-detail API and OP.GG-like match page from already-ingested match/participant/team data, and make player match cards navigate there.

**Architecture:** `@league-helper/shared` owns the public DTO, objective parser, and team/participant ordering. Nest `MatchesModule` loads one match (teams + participants + account join + timeline status), maps static identities with the existing Data Dragon + `Patch` static tables, and never reads `rawPayload`. Nuxt adds `/matches/:matchId` with optional `?player=` highlight. Spec: `docs/superpowers/specs/2026-08-17-m18-match-detail-design.md`.

**Tech Stack:** pnpm monorepo, TypeScript, Zod, NestJS, Prisma/PostgreSQL, Nuxt 3, Vue 3, Tailwind, Vitest, Playwright. No Redis cache, no Prisma migration, no AI, no ingestion changes.

**Plan decisions (resolve spec ambiguities):**

1. **No** Prisma migration. **No** worker/normalizer changes.
2. 404 uses existing `ResourceNotFoundError` / `RESOURCE_NOT_FOUND` — do **not** add `MATCH_NOT_FOUND`.
3. Match-detail DTO **omits** `externalMatchId`.
4. Rates use `gameDurationSeconds`. Add `computeGoldPerMinute` next to `computeCsPerMinute` in `player-response.mapper.ts`. Do not change match-card CS/min.
5. `damageShare` is vs **team** damage. Damage **bars** use all-10 max damage.
6. Slot 6 is always the trinket column even when empty.
7. Keystone is `perkIds[0]` when `> 0`.
8. Origin highlight is query-only on the page; API has no `player` param.
9. Match card: one `NuxtLink` to match detail; remove nested champion links from the card.
10. Extract static lookups in the matches feature (copy the `ChampionBuildsService.loadLookups` query shape). Do **not** refactor champion-builds in this milestone unless a 5-line import is enough.
11. `assertNoPuuidLeak` is imported from `player-response.mapper.ts` (move to `apps/api/src/common/puuid-leak.ts` only if the import creates a circular module dependency; prefer the existing function).
12. Invalid page UUID: show `MatchNotFound` (treat 400 and 404 the same in the UI).

---

## File structure (create / modify)

### Create

```text
packages/shared/src/match-detail.ts
packages/shared/src/match-detail.test.ts

apps/api/src/features/matches/matches.module.ts
apps/api/src/features/matches/matches.controller.ts
apps/api/src/features/matches/match-detail.service.ts
apps/api/src/features/matches/match-detail.service.test.ts
apps/api/src/features/matches/match-detail.mapper.ts
apps/api/src/features/matches/match-detail.mapper.test.ts
apps/api/src/features/matches/match-detail-static.ts
apps/api/src/features/matches/match-detail-static.test.ts
apps/api/src/features/matches/matches.integration.test.ts
apps/api/src/persistence/match.repository.detail.test.ts

apps/web/utils/match-links.ts
apps/web/utils/match-links.test.ts
apps/web/composables/useMatchApi.ts
apps/web/composables/useMatchDetailPage.ts
apps/web/composables/useMatchDetailPage.test.ts
apps/web/pages/matches/[matchId].vue
apps/web/components/match/MatchNotFound.vue
apps/web/components/match/MatchHeader.vue
apps/web/components/match/MatchHeader.test.ts
apps/web/components/match/MatchTeamPanel.vue
apps/web/components/match/MatchTeamPanel.test.ts
apps/web/components/match/MatchParticipantRow.vue
apps/web/components/match/MatchParticipantRow.test.ts
apps/web/components/match/MatchObjectiveSummary.vue
apps/web/components/match/MatchObjectiveSummary.test.ts
apps/web/components/match/MatchDamageSection.vue
apps/web/components/match/MatchDamageSection.test.ts
apps/web/components/match/MatchEarlyGameSection.vue
apps/web/components/match/MatchEarlyGameSection.test.ts
apps/web/e2e/match-detail.e2e.ts
```

### Modify

```text
packages/shared/src/index.ts
apps/api/src/persistence/match.repository.ts
apps/api/src/features/players/player-response.mapper.ts
apps/api/src/features/players/player-match-mapper.test.ts
apps/api/src/app.module.ts
apps/web/assets/css/main.css
apps/web/components/player/PlayerMatchCard.vue
apps/web/components/player/PlayerMatchCard.test.ts
apps/web/components/player/PlayerMatchList.vue      # pass playerId into cards if needed
apps/web/pages/players/[playerId].vue               # only if list needs playerId prop
apps/web/e2e/player-search.e2e.ts                   # optional: assert match card is a link
README.md
```

Do **not** modify Prisma schema, workers, `PublicMatchSummarySchema`, or M17 playstyle files except reusing `assertNoPuuidLeak` / `computePublicKda` / `computeCsPerMinute`.

---

### Task 1: Shared match-detail contracts and objective parser

**Files:**

- Create: `packages/shared/src/match-detail.ts`
- Create: `packages/shared/src/match-detail.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write failing tests** in `match-detail.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import {
  PublicMatchDetailSchema,
  matchTeamSide,
  parseMatchTeamObjectives,
  sortMatchParticipants,
  sortMatchTeams,
  winningSideFromTeams,
} from './match-detail';

describe('parseMatchTeamObjectives', () => {
  it('parses known keys and omits missing types', () => {
    const parsed = parseMatchTeamObjectives({
      dragon: { first: true, kills: 2 },
      baron: { kills: 1 },
      tower: { first: false, kills: 8 },
    });
    expect(parsed.map((o) => o.type)).toEqual(['dragon', 'baron', 'tower']);
    expect(parsed.find((o) => o.type === 'baron')?.first).toBeNull();
    expect(parsed.some((o) => o.type === 'riftHerald')).toBe(false);
  });

  it('ignores unknown keys and invalid kills', () => {
    expect(
      parseMatchTeamObjectives({
        atakhan: { first: true, kills: 1 },
        horde: { kills: 6 },
        dragon: { kills: '3' },
      }),
    ).toEqual([]);
  });

  it('returns [] for null', () => {
    expect(parseMatchTeamObjectives(null)).toEqual([]);
  });
});

describe('ordering', () => {
  it('maps 100/200 to BLUE/RED', () => {
    expect(matchTeamSide(100)).toBe('BLUE');
    expect(matchTeamSide(200)).toBe('RED');
    expect(matchTeamSide(300)).toBe('UNKNOWN');
  });

  it('orders teams 100 then 200 then others', () => {
    expect(sortMatchTeams([{ teamId: 200 }, { teamId: 100 }, { teamId: 300 }]).map((t) => t.teamId)).toEqual([
      100, 200, 300,
    ]);
  });

  it('orders positions TOP…SUPPORT then UNKNOWN by participantId', () => {
    const rows = [
      { participantId: 2, teamPosition: 'UNKNOWN' as const },
      { participantId: 1, teamPosition: 'MIDDLE' as const },
      { participantId: 5, teamPosition: 'TOP' as const },
      { participantId: 3, teamPosition: 'UNKNOWN' as const },
    ];
    expect(sortMatchParticipants(rows).map((r) => r.participantId)).toEqual([5, 1, 2, 3]);
  });
});

describe('PublicMatchDetailSchema', () => {
  it('parses a remake with null winningSide and empty optional metrics', () => {
    const parsed = PublicMatchDetailSchema.parse(validDetail({ remake: true, winningSide: null }));
    expect(parsed.match.remake).toBe(true);
    expect(parsed.match.winningSide).toBeNull();
  });

  it('requires seven item slots', () => {
    const detail = validDetail();
    detail.teams[0].participants[0].items = [];
    expect(() => PublicMatchDetailSchema.parse(detail)).toThrow();
  });
});
```

Include this fixture helper in the test file (extend to 10 participants in one extra test by cloning rows with distinct `participantId`s):

```ts
function slot(slot: number, itemId = 0): PublicMatchItemSlot {
  return { slot, itemId, name: itemId ? `Item ${itemId}` : null, iconUrl: null };
}

function participant(overrides: Partial<PublicMatchParticipant> = {}): PublicMatchParticipant {
  return {
    participantId: 1,
    teamId: 100,
    playerId: null,
    riotId: { gameName: 'Alice', tagLine: 'NA1' },
    championId: 23,
    championKey: 'Tryndamere',
    championName: 'Tryndamere',
    championIconUrl: 'https://ddragon.leagueoflegends.com/cdn/14.11.1/img/champion/Tryndamere.png',
    teamPosition: 'TOP',
    win: true,
    kills: 1,
    deaths: 0,
    assists: 1,
    kda: 2,
    totalCs: 100,
    csPerMinute: 5,
    goldEarned: 8000,
    goldPerMinute: 400,
    totalDamageDealtToChampions: 10000,
    damageShare: 1,
    totalDamageTaken: 8000,
    visionScore: 10,
    wardsPlaced: 5,
    wardsKilled: 1,
    controlWardsPurchased: 2,
    killParticipation: 0.4,
    items: [0, 1, 2, 3, 4, 5, 6].map((s) => slot(s)),
    summonerSpells: [null, null],
    keystone: null,
    primaryPerkStyle: null,
    secondaryPerkStyle: null,
    statShards: [],
    goldAt10: null,
    goldAt15: null,
    csAt10: null,
    csAt15: null,
    xpAt10: null,
    xpAt15: null,
    goldDifferenceAt10: null,
    goldDifferenceAt15: null,
    csDifferenceAt10: null,
    csDifferenceAt15: null,
    xpDifferenceAt10: null,
    xpDifferenceAt15: null,
    deathsBefore10: null,
    deathsBetween10And20: null,
    ...overrides,
  };
}

function validDetail(overrides: { remake?: boolean; winningSide?: 'BLUE' | 'RED' | 'UNKNOWN' | null } = {}) {
  return {
    match: {
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      queueId: 420,
      queueLabel: 'Ranked Solo/Duo',
      platform: 'na1',
      regionalRoute: 'americas',
      mapId: 11,
      gameMode: 'CLASSIC',
      gameCreation: '2026-08-01T00:00:00.000Z',
      gameEndTimestamp: '2026-08-01T00:30:00.000Z',
      gameDurationSeconds: 1800,
      gameVersion: '14.11.1.123',
      normalizedPatch: '14.11',
      remake: overrides.remake ?? false,
      earlySurrender: false,
      ingestionStatus: 'COMPLETED',
      winningSide: overrides.winningSide === undefined ? 'BLUE' : overrides.winningSide,
    },
    timeline: { status: 'UNAVAILABLE', metricsAvailable: false },
    teams: [
      {
        teamId: 100,
        side: 'BLUE',
        win: !(overrides.remake ?? false),
        bans: [],
        objectives: [],
        totals: { kills: 1, deaths: 0, assists: 1, goldEarned: 8000, damageDealtToChampions: 10000, visionScore: 10 },
        participants: [participant()],
      },
      {
        teamId: 200,
        side: 'RED',
        win: false,
        bans: [],
        objectives: [],
        totals: { kills: 0, deaths: 1, assists: 0, goldEarned: 7000, damageDealtToChampions: 8000, visionScore: 8 },
        participants: [participant({ participantId: 6, teamId: 200, win: false, teamPosition: 'TOP', riotId: { gameName: 'Bob', tagLine: 'NA1' } })],
      },
    ],
  };
}
```

- [ ] **Step 2: Implement `packages/shared/src/match-detail.ts`**

Include schemas exactly as spec §7.4.

Helpers:

```ts
export const MATCH_OBJECTIVE_DISPLAY_ORDER = [
  'dragon',
  'baron',
  'riftHerald',
  'tower',
  'inhibitor',
] as const;

const KNOWN_OBJECTIVE_TYPES = [
  'baron',
  'champion',
  'dragon',
  'inhibitor',
  'riftHerald',
  'tower',
] as const;

export function matchTeamSide(teamId: number): 'BLUE' | 'RED' | 'UNKNOWN' {
  if (teamId === 100) return 'BLUE';
  if (teamId === 200) return 'RED';
  return 'UNKNOWN';
}

export function parseMatchTeamObjectives(value: unknown): PublicMatchObjective[] {
  // spec §8: skip missing/invalid kills; first missing → null; ignore unknown keys
}

const POSITION_ORDER = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'SUPPORT', 'UNKNOWN'] as const;

export function sortMatchParticipants<T extends { teamPosition: NormalizedPosition; participantId: number }>(
  rows: T[],
): T[] {
  return [...rows].sort((a, b) => {
    const d = POSITION_ORDER.indexOf(a.teamPosition) - POSITION_ORDER.indexOf(b.teamPosition);
    return d !== 0 ? d : a.participantId - b.participantId;
  });
}

export function sortMatchTeams<T extends { teamId: number }>(teams: T[]): T[] {
  return [...teams].sort((a, b) => {
    const rank = (id: number) => (id === 100 ? 0 : id === 200 ? 1 : 2 + id);
    return rank(a.teamId) - rank(b.teamId);
  });
}

export function winningSideFromTeams(
  remake: boolean,
  teams: Array<{ side: 'BLUE' | 'RED' | 'UNKNOWN'; win: boolean }>,
): 'BLUE' | 'RED' | 'UNKNOWN' | null {
  if (remake) return null;
  const winners = teams.filter((t) => t.win);
  if (winners.length !== 1) return null;
  return winners[0]!.side;
}

export function participantHasTimelineMetrics(p: {
  goldAt10: number | null;
  goldAt15: number | null;
  csAt10: number | null;
  csAt15: number | null;
  xpAt10: number | null;
  xpAt15: number | null;
  goldDifferenceAt10: number | null;
  goldDifferenceAt15: number | null;
  csDifferenceAt10: number | null;
  csDifferenceAt15: number | null;
  xpDifferenceAt10: number | null;
  xpDifferenceAt15: number | null;
  killParticipation: number | null;
}): boolean {
  return Object.values(p).some((v) => v != null);
}
```

For `parseMatchTeamObjectives`, after collecting known types, sort by `MATCH_OBJECTIVE_DISPLAY_ORDER`, then append `champion` only if present (API still parses it; UI omits champion-as-objective-icon per spec — keep it in the array so tests can assert parse fidelity; UI filters `type !== 'champion'`).

- [ ] **Step 3: Export from `packages/shared/src/index.ts`** (schemas, types, helpers).

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @league-helper/shared test -- match-detail
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/match-detail.ts packages/shared/src/match-detail.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): add public match-detail DTOs and objective parser"
```

---

### Task 2: Match-detail repository query

**Files:**

- Modify: `apps/api/src/persistence/match.repository.ts`
- Create: `apps/api/src/persistence/match.repository.detail.test.ts`

- [ ] **Step 1: Add a select that cannot include secrets**

```ts
export const matchDetailParticipantSelect = {
  participantId: true,
  teamId: true,
  riotIdGameName: true,
  riotIdTagLine: true,
  championId: true,
  championName: true,
  teamPosition: true,
  individualPosition: true,
  lane: true,
  role: true,
  win: true,
  kills: true,
  deaths: true,
  assists: true,
  totalMinionsKilled: true,
  neutralMinionsKilled: true,
  totalCs: true,
  goldEarned: true,
  totalDamageDealtToChampions: true,
  totalDamageTaken: true,
  visionScore: true,
  wardsPlaced: true,
  wardsKilled: true,
  controlWardsPurchased: true,
  itemIds: true,
  perkIds: true,
  statPerkIds: true,
  primaryPerkStyleId: true,
  secondaryPerkStyleId: true,
  summonerSpell1Id: true,
  summonerSpell2Id: true,
  goldAt10: true,
  goldAt15: true,
  csAt10: true,
  csAt15: true,
  xpAt10: true,
  xpAt15: true,
  goldDifferenceAt10: true,
  goldDifferenceAt15: true,
  csDifferenceAt10: true,
  csDifferenceAt15: true,
  xpDifferenceAt10: true,
  xpDifferenceAt15: true,
  deathsBefore10: true,
  deathsBetween10And20: true,
  killParticipation: true,
  playerAccount: {
    select: {
      playerId: true,
      currentGameName: true,
      currentTagLine: true,
    },
  },
} as const;

export const matchDetailSelect = {
  id: true,
  provider: true,
  platformRoute: true,
  regionalRoute: true,
  queueId: true,
  mapId: true,
  gameMode: true,
  gameCreation: true,
  gameEndTimestamp: true,
  gameDurationSeconds: true,
  gameVersion: true,
  normalizedPatch: true,
  remake: true,
  earlySurrender: true,
  ingestionStatus: true,
  teams: {
    select: {
      teamId: true,
      win: true,
      bans: true,
      objectives: true,
    },
  },
  participants: { select: matchDetailParticipantSelect },
  timeline: { select: { fetchStatus: true } },
} as const;
```

**Forbidden in this select:** `rawPayload`, `externalAccountId`, `externalMatchId`, `gameId`, rank columns, `skillOrder`.

- [ ] **Step 2: Add `findDetailById(id: string)`** returning `null` when missing. Use `findUnique({ where: { id }, select: matchDetailSelect })`.

- [ ] **Step 3: Test** that the select object does not contain `rawPayload` or `externalAccountId` (static assertion in a unit test: `expect(JSON.stringify(matchDetailSelect)).not.toContain('rawPayload')`).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/persistence/match.repository.ts apps/api/src/persistence/match.repository.detail.test.ts
git commit -m "feat(api): add match-detail persistence select without raw payloads"
```

---

### Task 3: Static-data lookup for a match patch

**Files:**

- Create: `apps/api/src/features/matches/match-detail-static.ts`
- Create: `apps/api/src/features/matches/match-detail-static.test.ts`

Mirror `ChampionBuildsService.loadLookups` (items by `itemId`/`name`, runes with icon/tree, spells with `imageData.full`, `dataDragonVersion`, `styleNames` from rune trees).

- [ ] **Step 1: Failing test** — given prisma mocks returning an item `3031` named `Infinity Edge` for patch `14.11`, `loadMatchStaticLookups(prisma, staticRepo, '14.11')` returns that map; when patch row missing, call `resolveStaticPatch()`.

- [ ] **Step 2: Implement** `loadMatchStaticLookups`. Helper `imageFullFromJson` same as champion-builds (duplicate 8 lines; do not refactor builds).

- [ ] **Step 3: Add identity builders** used by the mapper:

```ts
export function identityFromItem(
  itemId: number,
  lookups: MatchStaticLookups,
  icons: { itemIcon: (id: number, version: string) => string | null },
): { name: string | null; iconUrl: string | null } {
  if (itemId <= 0) return { name: null, iconUrl: null };
  const version = lookups.dataDragonVersion ?? '';
  const name = lookups.items.get(itemId)?.name ?? `Item ${itemId}`;
  return { name, iconUrl: version ? icons.itemIcon(itemId, version) : null };
}
```

Similar for rune id, style id (use `styleNames` + a rune in that tree for icon if one exists; if no icon, `iconUrl` null and `name` from `styleNames` or `Rune ${id}`), and spell id.

- [ ] **Step 4: Run**

```bash
pnpm --filter @league-helper/api test -- match-detail-static
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/features/matches/match-detail-static.ts apps/api/src/features/matches/match-detail-static.test.ts
git commit -m "feat(api): resolve match-detail item/rune/spell static data by patch"
```

---

### Task 4: Match-detail mapper

**Files:**

- Create: `apps/api/src/features/matches/match-detail.mapper.ts`
- Create: `apps/api/src/features/matches/match-detail.mapper.test.ts`

- [ ] **Step 1: Write failing tests**

Cover:

- 10 participants → 2 teams, Blue 100 first, roles ordered
- Untracked: `playerId` null, `riotId` from `riotIdGameName`/`riotIdTagLine`
- Tracked: `playerId` from account; `riotId` from `currentGameName`/`currentTagLine`
- Empty item slots stay `itemId: 0`
- `perkIds[0]` → keystone
- Remake → `winningSide` null
- Null goldAt10 omitted as null (not 0)
- `assertNoPuuidLeak` on mapped output even when input account could theoretically leak — mapper output must not contain `externalAccountId` / `puuid`
- Damage share: team of 1000+3000 → 0.25 and 0.75; team total 0 → null
- UNKNOWN positions retained
- Incomplete: 3 participants still map
- Champion fallback name from participant when Data Dragon missing

Reuse `computePublicKda` / `computeCsPerMinute` from `player-response.mapper.ts`. Add `computeGoldPerMinute` next to `computeCsPerMinute` in that file (same formula) **or** a private function in the match mapper — prefer adding to `player-response.mapper.ts` with a one-line test in `player-match-mapper.test.ts` so CS/min behavior stays untouched.

Timeline status mapping per spec §5.

- [ ] **Step 2: Implement `mapPublicMatchDetail(row, ctx)`** returning `PublicMatchDetail`.

`ctx`:

```ts
{
  champions: Map<number, DataDragonChampion>;
  lookups: MatchStaticLookups;
  icons: {
    itemIcon: (id: number, version: string) => string | null;
    runeIcon: (path: string) => string | null;
    spellIcon: (imageFull: string, version: string) => string | null;
  };
}
```

Normalize position with `normalizeParticipantPosition` using match queue/map/mode/remake.

Pad `itemIds` to 7 with 0 if shorter (historical rows).

Summoner spells: id `<= 0` → null identity.

Bans: map each id through champion numeric lookup → `{ id, name, iconUrl }`.

End with `PublicMatchDetailSchema.parse(...)`.

- [ ] **Step 3: Run**

```bash
pnpm --filter @league-helper/api test -- match-detail.mapper player-match-mapper
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/features/matches/match-detail.mapper.ts apps/api/src/features/matches/match-detail.mapper.test.ts apps/api/src/features/players/player-response.mapper.ts apps/api/src/features/players/player-match-mapper.test.ts
git commit -m "feat(api): map stored matches to the public match-detail DTO"
```

---

### Task 5: Match-detail service, controller, module

**Files:**

- Create: `apps/api/src/features/matches/match-detail.service.ts`
- Create: `apps/api/src/features/matches/match-detail.service.test.ts`
- Create: `apps/api/src/features/matches/matches.controller.ts`
- Create: `apps/api/src/features/matches/matches.module.ts`
- Create: `apps/api/src/features/matches/matches.integration.test.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Service unit tests (mock repo + data dragon + static loader)**

- Missing match → `ResourceNotFoundError`
- Found match → mapper result; `assertNoPuuidLeak` called
- Loads champions for unique `championId`s (participants + bans) in one `getChampionByNumericId` loop (or `getAllChampions` then filter — either is fine; do **not** call player profile APIs)

- [ ] **Step 2: Implement service**

```ts
async getMatch(matchId: string): Promise<PublicMatchDetail> {
  const row = await this.matches.findDetailById(matchId);
  if (!row) throw new ResourceNotFoundError('Match not found.');
  const lookups = await loadMatchStaticLookups(this.prisma, this.staticRepo, row.normalizedPatch);
  // batch champions...
  const response = mapPublicMatchDetail(row, ctx);
  assertNoPuuidLeak(response);
  return response;
}
```

Inject `MatchRepository`, `PrismaService`, `ChampionStaticRepository`, `DataDragonChampionService`.

- [ ] **Step 3: Controller**

```ts
@Controller('api/matches')
@UseInterceptors(CorrelationIdInterceptor)
export class MatchesController {
  @Get(':matchId')
  getMatch(@Param('matchId', ParseUUIDPipe) matchId: string) {
    return this.matchDetail.getMatch(matchId);
  }
}
```

No other routes. No query schema.

- [ ] **Step 4: `MatchesModule`** imports `PersistenceModule`, `DataDragonModule`, `PrismaModule` as needed. Register in `AppModule`.

- [ ] **Step 5: Integration test** (follow `players.integration.test.ts` / champions pattern: test Nest module with mocked prisma or sqlite — **use the same style as existing API integration tests**).

Must cover:

- 200 COMPLETED 10-player body parses with `PublicMatchDetailSchema`
- 404 unknown id
- response JSON string does not include `puuid` or `externalAccountId`
- remake 200
- incomplete 200

- [ ] **Step 6: Run**

```bash
pnpm --filter @league-helper/api test:unit -- match-detail
pnpm --filter @league-helper/api test:integration -- matches.integration
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/features/matches apps/api/src/app.module.ts
git commit -m "feat(api): add GET /api/matches/:matchId"
```

---

### Task 6: Player match-card navigation

**Files:**

- Create: `apps/web/utils/match-links.ts`
- Create: `apps/web/utils/match-links.test.ts`
- Modify: `apps/web/components/player/PlayerMatchCard.vue`
- Modify: `apps/web/components/player/PlayerMatchCard.test.ts`
- Modify: `apps/web/components/player/PlayerMatchList.vue`
- Modify: `apps/web/pages/players/[playerId].vue` if the list does not already know `playerId`

- [ ] **Step 1: `buildMatchPath(matchId: string, playerId?: string)`**

```ts
export function buildMatchPath(matchId: string, playerId?: string | null): string {
  const base = `/matches/${encodeURIComponent(matchId)}`;
  if (!playerId?.trim()) return base;
  return `${base}?player=${encodeURIComponent(playerId.trim())}`;
}
```

Test with and without player.

- [ ] **Step 2: Update `PlayerMatchCard`**

Props: `match`, `playerId?: string | null`.

Wrap the `<article>` content in a single `NuxtLink` `:to="buildMatchPath(match.id, playerId)"` with `:aria-label` like `View match details, Victory as Tryndamere`.

Remove champion `NuxtLink`s (icon and name become `<img>`/`<span>`). Keep champion alt text.

Do not wrap interactive toolbar controls — those stay in `MatchHistoryToolbar`.

- [ ] **Step 3: Tests**

- `href` is `/matches/<uuid>?player=<playerId>` when playerId passed
- `href` has no query when playerId omitted
- no `/champions/` links on the card
- remake card still says Remake
- keyboard: the link exists (`a[href]`)

- [ ] **Step 4: Pass `playerId` from the player page into `PlayerMatchList` → each card.**

- [ ] **Step 5: Run**

```bash
pnpm --filter @league-helper/web test -- PlayerMatchCard match-links
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/utils/match-links.ts apps/web/utils/match-links.test.ts apps/web/components/player/PlayerMatchCard.vue apps/web/components/player/PlayerMatchCard.test.ts apps/web/components/player/PlayerMatchList.vue apps/web/pages/players/[playerId].vue
git commit -m "feat(web): link player match cards to match detail"
```

---

### Task 7: Match page shell, API client, header

**Files:**

- Create: `apps/web/composables/useMatchApi.ts`
- Create: `apps/web/composables/useMatchDetailPage.ts`
- Create: `apps/web/composables/useMatchDetailPage.test.ts`
- Create: `apps/web/pages/matches/[matchId].vue`
- Create: `apps/web/components/match/MatchNotFound.vue`
- Create: `apps/web/components/match/MatchHeader.vue`
- Create: `apps/web/components/match/MatchHeader.test.ts`
- Modify: `apps/web/assets/css/main.css`

- [ ] **Step 1: CSS**

```css
--lh-team-blue: #4c8dff;
--lh-team-red: #ff6b6b;
```

- [ ] **Step 2: `useMatchApi().getMatch(matchId)`** — `$fetch` `${apiBase}/api/matches/${matchId}`, parse `PublicMatchDetailSchema`, throw a small `MatchApiError` (copy `PlayerApiError` pattern: statusCode, code, message).

- [ ] **Step 3: `useMatchDetailPage`**

- Read `route.params.matchId` and `route.query.player` (string | undefined)
- Load match on `matchId` change
- `notFound` when 404 or 400 or invalid uuid
- `originPlayerId` = query player if it is a uuid, else null
- Expose `detail`, `pending`, `errorMessage`, `reload`

Test: missing player query → origin null; matching uuid preserved; 404 → notFound.

- [ ] **Step 4: `MatchHeader`**

Remake: heading text contains `Remake`, not `Victory`.  
Else: `Blue Team Victory` / `Red Team Victory` / `Unknown result`.  
Also queue label, patch, `m:ss`, relative or locale date, platform display name when present.

Test remake vs blue win. Color is extra; text must be present.

- [ ] **Step 5: Page shell**

`lh-container` layout like champion/player pages. States: loading status, `MatchNotFound`, `PlayerErrorBanner` for non-404 errors, incomplete banner when `ingestionStatus !== 'COMPLETED'`, then header. Teams can be placeholders until Task 8.

- [ ] **Step 6: Run web tests; commit**

```bash
pnpm --filter @league-helper/web test -- useMatchDetailPage MatchHeader
git add apps/web/composables/useMatchApi.ts apps/web/composables/useMatchDetailPage.ts apps/web/composables/useMatchDetailPage.test.ts apps/web/pages/matches/[matchId].vue apps/web/components/match/MatchNotFound.vue apps/web/components/match/MatchHeader.vue apps/web/components/match/MatchHeader.test.ts apps/web/assets/css/main.css
git commit -m "feat(web): add match-detail page shell and header"
```

---

### Task 8: Team panels and participant rows

**Files:**

- Create: `apps/web/components/match/MatchTeamPanel.vue`
- Create: `apps/web/components/match/MatchTeamPanel.test.ts`
- Create: `apps/web/components/match/MatchParticipantRow.vue`
- Create: `apps/web/components/match/MatchParticipantRow.test.ts`
- Create: `apps/web/components/match/MatchObjectiveSummary.vue`
- Create: `apps/web/components/match/MatchObjectiveSummary.test.ts`
- Modify: `apps/web/pages/matches/[matchId].vue`

- [ ] **Step 1: `MatchObjectiveSummary`**

Render objectives with `type !== 'champion'`, in array order (already display-sorted). Missing types absent. Counts as text (`Dragon 2`). `first === true` may add visually hidden “first” text. No fake Atakhan.

- [ ] **Step 2: `MatchParticipantRow`**

Always-visible fields per spec §9.2.  
`playerId` → `NuxtLink` `/players/:playerId`; else `<span>`.  
Champion icon → `/champions/:key` when key present.  
Highlight class + `aria-current="true"` when `highlighted`.  
Items: 7 boxes; empty slot has `aria-label="Empty item slot"`.  
Expand `<details>` for secondary/early stats; **do not render a metric whose value is null** (no `Gold diff @10: 0` for null).

- [ ] **Step 3: `MatchTeamPanel`**

Heading: `Blue Team` / `Red Team` / `Team {id}` plus `Victory` or `Defeat` (and not Victory when parent match is remake — pass `remake` prop; if remake, omit Victory/Defeat on the panel or show `Remake`).  
Bans as small champion icons.  
Totals: kills / gold / damage.  
List participants (already ordered by API).

- [ ] **Step 4: Page renders both panels from `detail.teams`.**

- [ ] **Step 5: Tests** — 5+5 rows, highlight one, untracked name not a link, empty item slot, null early metric absent.

- [ ] **Step 6: Run and commit**

```bash
pnpm --filter @league-helper/web test -- MatchTeamPanel MatchParticipantRow MatchObjectiveSummary
git add apps/web/components/match apps/web/pages/matches/[matchId].vue
git commit -m "feat(web): render match teams, objectives, and participant rows"
```

---

### Task 9: Damage bars and origin early-game section

**Files:**

- Create: `apps/web/components/match/MatchDamageSection.vue`
- Create: `apps/web/components/match/MatchDamageSection.test.ts`
- Create: `apps/web/components/match/MatchEarlyGameSection.vue`
- Create: `apps/web/components/match/MatchEarlyGameSection.test.ts`
- Modify: `apps/web/pages/matches/[matchId].vue`

- [ ] **Step 1: Damage section**

Flatten all participants, sort descending `totalDamageDealtToChampions`. Bar width `%` = `damage / maxDamage` (0 if max is 0). Label with Riot ID or champion name. Team color via `teamId`. Highlight origin. No “MVP” string. Hide section if `maxDamage === 0` && ingestion not COMPLETED.

- [ ] **Step 2: Early-game section**

Show only if origin participant exists AND any of their @10/@15 fields is non-null. Title “Early game”. List only non-null diffs/values. If `timeline.status === 'PENDING' && !metricsAvailable`, show processing copy instead of zeros.

- [ ] **Step 3: Wire into page.**

- [ ] **Step 4: Tests and commit**

```bash
pnpm --filter @league-helper/web test -- MatchDamageSection MatchEarlyGameSection
git add apps/web/components/match/MatchDamageSection.vue apps/web/components/match/MatchDamageSection.test.ts apps/web/components/match/MatchEarlyGameSection.vue apps/web/components/match/MatchEarlyGameSection.test.ts apps/web/pages/matches/[matchId].vue
git commit -m "feat(web): add match damage bars and origin early-game stats"
```

---

### Task 10: Responsive layout and accessibility polish

**Files:**

- Modify: participant row, team panel, page, `main.css` if needed

- [ ] **Step 1:** Mobile stacked cards: `flex-col` by default; `lg:grid` extra columns only at large breakpoints. Items wrap. No table element required.

- [ ] **Step 2:** Focus styles `focus-visible:outline` on links/buttons matching champion page.

- [ ] **Step 3:** Ensure win/loss/remake text exists in header tests (already) and team panels.

- [ ] **Step 4:** Image alts use names (`Infinity Edge`, `Flash`, `Press the Attack`) from DTO, not `Item 3031` when name is present.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/match apps/web/pages/matches/[matchId].vue apps/web/assets/css/main.css
git commit -m "feat(web): make match detail usable on mobile and keyboard"
```

---

### Task 11: E2E

**Files:**

- Create: `apps/web/e2e/match-detail.e2e.ts`
- Optional modify: `apps/web/e2e/player-search.e2e.ts`

- [ ] **Step 1:** Add a `PublicMatchDetail` fixture (2 teams, 10 participants, one with `playerId` equal to the searched player). Route `**/api/matches/**` to fulfill JSON if the environment has no ingested 10-player match; if player-search already shows a real card, clicking through without mock is preferred.

Pattern: same mock-provider homepage search as `player-search.e2e.ts`.

Assertions:

- Click first match card → URL `/matches/<uuid>` with `player` query
- Visible Blue Team and Red Team headings
- Highlighted origin (`aria-current` or “You” / ring)
- Navigate to a tracked participant player page
- `goto(/matches/<uuid>)` without query still shows both teams
- `#main-content` text has no `puuid`
- Viewport 375: no horizontal overflow

- [ ] **Step 2: Run**

```bash
pnpm --filter @league-helper/web test:e2e -- match-detail.e2e.ts
```

Expected: PASS without live Riot.

- [ ] **Step 3: Commit**

```bash
git add apps/web/e2e/match-detail.e2e.ts apps/web/e2e/player-search.e2e.ts
git commit -m "test(web): add match-detail navigation e2e"
```

---

### Task 12: Docs and full verification

**Files:**

- Modify: `README.md`

- [ ] **Step 1:** Document `GET /api/matches/:matchId` next to player match history. Note: public id is League Helper UUID; page `/matches/:matchId`; match cards navigate there; no Riot match-id search.

- [ ] **Step 2: Run verification**

```bash
pnpm --filter @league-helper/shared test -- match-detail
pnpm --filter @league-helper/api test:unit -- match-detail
pnpm --filter @league-helper/api test:integration -- matches.integration
pnpm --filter @league-helper/web test -- Match PlayerMatchCard match-links useMatchDetailPage
pnpm --filter @league-helper/api typecheck
pnpm --filter @league-helper/web typecheck
pnpm --filter @league-helper/api lint
pnpm --filter @league-helper/web lint
pnpm --filter @league-helper/shared lint
```

Fix any failures caused by this milestone.

Confirm `git grep` in changed API files: no `rawPayload` on the public mapper path.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document match-detail API and page"
```

---

## Spec coverage checklist

| Spec item | Task |
| --- | --- |
| Public DTO + objective parser + ordering | 1 |
| Repository select / no secrets | 2 |
| Patch static data | 3 |
| Mapper, KDA/CS/gold/min, leak | 4 |
| GET endpoint, 404, incomplete 200 | 5 |
| Match-card navigation | 6 |
| Page shell, header, `?player=` | 7 |
| Teams, rows, objectives, items/runes/spells | 8 |
| Damage + early-game | 9 |
| Mobile / a11y | 10 |
| E2E | 11 |
| README | 12 |
| No migration / no ingest / no AI / no Redis | all (do not add) |
| Timeline deferred | 4/5 expose status only; no event UI |

---

## Out of scope during implementation

Do not implement gold graphs, kill feeds, `MatchTimelineEvent` reads, `champLevel` ingest, rank pills, AI copy, or Riot match-id search — even if they look easy.
