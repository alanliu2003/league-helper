import { expect, test } from '@playwright/test';
import {
  CHAMPION_STATS_DISCLAIMER,
  PLAYER_PLAYSTYLE_AI_DISCLAIMER,
  PlayerPlaystyleResponseSchema,
  PlayerSearchResponseSchema,
  RANK_TIER_SEMANTICS,
} from '@league-helper/shared';
import {
  MATCH_DETAIL_ID,
  ORIGIN_PLAYER_ID,
  matchDetailFixture,
} from '../components/match/match-detail.fixture';

const OTHER_PLAYER_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const PLAYSTYLE_E2E_FIXTURE = PlayerPlaystyleResponseSchema.parse({
  disclaimer: CHAMPION_STATS_DISCLAIMER,
  aiDisclaimer: PLAYER_PLAYSTYLE_AI_DISCLAIMER,
  rankSemantics: RANK_TIER_SEMANTICS,
  sampleScope: {
    kind: 'COLLECTED_SAMPLE',
    queueId: 420,
    matchWindow: 20,
    windowSize: 20,
    matchesAnalyzed: 18,
    comparableMatchCount: 16,
    wins: 10,
    playerSampleBand: 'CREDIBLE',
    patchRange: { min: '16.14', max: '16.15' },
  },
  mix: [],
  overall: { comparisons: [] },
  championSlices: [],
  skipped: { remake: 0, incomplete: 0, unknownPosition: 0, noBaseline: 0 },
  ai: {
    status: 'DISABLED',
    emptyReason: 'AI_DISABLED',
    insight: null,
  },
});

const PLAYER_PROFILE = PlayerSearchResponseSchema.parse({
  player: {
    id: ORIGIN_PLAYER_ID,
    accountId: '11111111-1111-4111-8111-111111111111',
    provider: 'RIOT',
    platform: 'na1',
    regionalRoute: 'americas',
    riotId: { gameName: 'ExamplePlayer', tagLine: 'NA1' },
    profileIconId: 1,
    profileIconUrl: 'https://ddragon.leagueoflegends.com/cdn/14.11.1/img/profileicon/1.png',
    summonerLevel: 100,
    lastResolvedAt: '2026-08-01T00:00:00.000Z',
  },
  ranks: [],
  mastery: [],
  matches: [
    {
      id: MATCH_DETAIL_ID,
      externalMatchId: 'NA1_1',
      queueId: 420,
      gameCreation: '2026-08-01T00:00:00.000Z',
      gameDurationSeconds: 1800,
      gameVersion: '14.11.1.123',
      normalizedPatch: '14.11',
      remake: false,
      earlySurrender: false,
      result: 'victory',
      championId: 23,
      championKey: 'Tryndamere',
      championName: 'Tryndamere',
      championIconUrl: 'https://ddragon.leagueoflegends.com/cdn/14.11.1/img/champion/Tryndamere.png',
      teamPosition: 'TOP',
      role: 'TOP',
      win: true,
      kills: 5,
      deaths: 2,
      assists: 7,
      kda: 6,
      totalCs: 200,
      csPerMinute: 6.6,
      killParticipation: 0.55,
      itemIds: [],
      itemIconUrls: [],
      summonerSpell1Id: 4,
      summonerSpell2Id: 12,
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
      timelineMetricsAvailable: false,
      ingestionStatus: 'COMPLETED',
    },
  ],
  refresh: {
    state: 'COMPLETE',
    requestedMatchCount: 20,
    discoveredMatchCount: 1,
    knownMatchCount: 1,
    queuedMatchCount: 0,
    activeMatchCount: 0,
    delayedMatchCount: 0,
    completedMatchCount: 1,
    failedMatchCount: 0,
    lastResolvedAt: '2026-08-01T00:00:00.000Z',
    lastRefreshStartedAt: '2026-08-01T00:00:00.000Z',
    lastRefreshCompletedAt: '2026-08-01T00:00:00.000Z',
    lastRefreshedAt: '2026-08-01T00:00:00.000Z',
    isStale: false,
    warnings: [],
  },
});

function matchDetailPayload() {
  const detail = matchDetailFixture();
  detail.teams[0]!.participants[0]!.playerId = ORIGIN_PLAYER_ID;
  detail.teams[1]!.participants[0]!.playerId = OTHER_PLAYER_ID;
  return detail;
}

test.describe('match detail', () => {
  test('navigates from a player match card and renders both teams', async ({ page }) => {
    test.setTimeout(60_000);

    await page.route('**/api/players/search', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(PLAYER_PROFILE),
      });
    });
    await page.route('**/api/players/*/playstyle', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(PLAYSTYLE_E2E_FIXTURE),
      });
    });
    await page.route(`**/api/players/${ORIGIN_PLAYER_ID}/matches**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: PLAYER_PROFILE.matches, nextCursor: null }),
      });
    });
    await page.route(`**/api/players/${ORIGIN_PLAYER_ID}/refresh-status`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(PLAYER_PROFILE.refresh),
      });
    });
    await page.route(`**/api/players/${ORIGIN_PLAYER_ID}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(PLAYER_PROFILE),
      });
    });
    await page.route('**/api/matches/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(matchDetailPayload()),
      });
    });

    await page.goto('/');
    const home = page.locator('#main-content .lh-container');
    await home.getByLabel('Game name').fill('ExamplePlayer');
    await home.getByLabel('Tag line').fill('NA1');
    await home.getByLabel('Platform').selectOption('na1');
    const searchButton = home.getByRole('button', { name: 'Search player' });
    await expect(searchButton).toBeEnabled();
    await searchButton.click();

    await expect(page).toHaveURL(new RegExp(`/players/${ORIGIN_PLAYER_ID}`), { timeout: 15_000 });

    const matchLink = page.locator(`a[href*="/matches/${MATCH_DETAIL_ID}"]`).first();
    await expect(matchLink).toBeVisible();
    await matchLink.click();

    await expect(page).toHaveURL(
      new RegExp(`/matches/${MATCH_DETAIL_ID}\\?player=${ORIGIN_PLAYER_ID}`),
    );
    await expect(page.getByRole('heading', { level: 2, name: /Blue Team/ })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: /Red Team/ })).toBeVisible();
    await expect(page.locator('[aria-current="true"]')).toHaveCount(1);

    await page.getByRole('link', { name: 'Bob#NA1' }).click();
    await expect(page).toHaveURL(new RegExp(`/players/${OTHER_PLAYER_ID}`));

    await page.goto(`/matches/${MATCH_DETAIL_ID}`);
    await expect(page.getByRole('heading', { level: 2, name: /Blue Team/ })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: /Red Team/ })).toBeVisible();
    await expect(page.locator('[aria-current="true"]')).toHaveCount(0);

    const body = await page.locator('#main-content').innerText();
    expect(body.toLowerCase()).not.toContain('puuid');

    await page.setViewportSize({ width: 375, height: 812 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });
});
