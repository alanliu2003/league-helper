import { expect, test } from '@playwright/test';
import {
  CHAMPION_STATS_DISCLAIMER,
  PLAYER_PLAYSTYLE_AI_DISCLAIMER,
  PlayerPlaystyleResponseSchema,
  RANK_TIER_SEMANTICS,
} from '@league-helper/shared';

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
  mix: [
    {
      championKey: 'Yasuo',
      championName: 'Yasuo',
      position: 'MIDDLE',
      matchCount: 8,
    },
  ],
  overall: {
    comparisons: [
      {
        metric: 'CS_PER_MIN',
        playerValue: null,
        baseline: {
          value: null,
          sampleSize: 1000,
          sampleConfidence: 'HIGH',
          rankTier: 'GOLD',
          usedAllTierFallback: false,
        },
        delta: 0.2,
        comparableMatchCount: 12,
        direction: 'NEAR_BASELINE',
        interpretationAllowed: true,
      },
    ],
  },
  championSlices: [],
  skipped: { remake: 0, incomplete: 0, unknownPosition: 0, noBaseline: 0 },
  ai: {
    status: 'DISABLED',
    emptyReason: 'AI_DISABLED',
    insight: null,
  },
});

/**
 * Happy path with mock Riot provider (API must use RIOT_PROVIDER_MODE=mock).
 * Does not call Riot live APIs.
 */
test.describe('player search happy path', () => {
  async function searchFromHomepage(page: import('@playwright/test').Page): Promise<void> {
    await page.route('**/api/players/*/playstyle', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(PLAYSTYLE_E2E_FIXTURE),
      });
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const home = page.locator('#main-content .lh-container');
    await home.getByLabel('Game name').fill('ExamplePlayer');
    await home.getByLabel('Tag line').fill('NA1');
    await home.getByLabel('Platform').selectOption('na1');

    const searchButton = home.getByRole('button', { name: 'Search player' });
    await expect(searchButton).toBeEnabled();

    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes('/api/players/search') &&
          response.request().method() === 'POST' &&
          response.ok(),
        { timeout: 30_000 },
      ),
      searchButton.click(),
    ]);

    await expect(page).toHaveURL(/\/players\/[0-9a-f-]{36}/i, { timeout: 30_000 });
  }

  test('searches a mock Riot ID and shows redesigned player profile', async ({ page }) => {
    test.setTimeout(60_000);

    await searchFromHomepage(page);

    await expect(page.getByText('Understand your matches')).toBeHidden();
    const hero = page.getByRole('region', { name: 'Player profile' });
    await expect(hero.getByRole('heading', { level: 1 })).toContainText('ExamplePlayer');
    await expect(hero.getByText('North America')).toBeVisible();

    await expect(page.getByRole('heading', { name: 'Ranked' })).toBeVisible();
    await expect(page.getByText('Solo/Duo').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your playstyle' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Champion mastery' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Match history' })).toBeVisible();

    // Named mastery champions with images (icons or splash).
    await expect(page.getByText('Yasuo').first()).toBeVisible();
    const masteryImages = page.locator('main img[alt*="Yasuo"], main img[alt*="Lee"]');
    await expect(masteryImages.first()).toBeVisible({ timeout: 15_000 });

    const processing = page.getByText(/Match ingestion|Updating recent matches/i);
    const matchCards = page.getByText(/Victory|Defeat|Remake/i);
    await expect(processing.or(matchCards.first())).toBeVisible({ timeout: 30_000 });

    const body = await page.locator('#main-content').innerText();
    expect(body.toLowerCase()).not.toContain('puuid');
    expect(body).not.toContain('fake-puuid');

    await expect(page.getByRole('button', { name: 'Refresh matches' }).first()).toBeVisible();

    await page.setViewportSize({ width: 375, height: 812 });
    const overflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(overflow).toBe(false);
  });

  test('queue filter syncs with URL and refresh preserves match cards', async ({ page }) => {
    test.setTimeout(60_000);

    await searchFromHomepage(page);

    const matchCards = page.getByText(/Victory|Defeat|Remake/i);
    await expect(matchCards.first()).toBeVisible({ timeout: 30_000 });
    const cardCountBefore = await matchCards.count();

    await page.getByRole('button', { name: 'Solo/Duo', exact: true }).click();
    await expect(page).toHaveURL(/queue=ranked_solo/);

    await page.getByRole('button', { name: 'All', exact: true }).click();
    await expect(page).not.toHaveURL(/queue=/);

    const refreshButton = page.getByRole('button', { name: 'Refresh matches' }).first();
    await refreshButton.click();
    await expect(matchCards.first()).toBeVisible({ timeout: 10_000 });
    expect(await matchCards.count()).toBeGreaterThanOrEqual(Math.min(cardCountBefore, 1));
  });
});
