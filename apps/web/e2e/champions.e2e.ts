import { expect, test, type Page } from '@playwright/test';
import { CHAMPION_STATS_DISCLAIMER } from '@league-helper/shared';
import {
  installChampionApiMocks,
  installPlayerProfileMock,
  MOCK_ICON_AHRI,
  type InstalledChampionMocks,
} from './champion-api.mocks';

/**
 * Milestone 8 champion directory + detail e2e.
 *
 * Uses Playwright route fixtures (see champion-api.mocks.ts). Static-data sync /
 * full DB seed + aggregate rebuild for live-local e2e remains future operational work.
 */

/**
 * Prefer commit/DOM ready over full `load` — Nuxt/dev tooling can keep `load` hanging.
 * Generous timeout absorbs slow webServer reuse under parallel agent load.
 */
async function gotoApp(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 90_000 });
}

async function waitForChampionsFilters(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Filters' })).toBeVisible({
    timeout: 30_000,
  });
}

async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
}

async function assertNoPuuidOrDeferredSections(page: Page): Promise<void> {
  const body = await page.locator('#main-content').innerText();
  expect(body).not.toMatch(/puuid/i);
  expect(body).not.toMatch(/\bPUUID\b/);
  expect(body.toLowerCase()).not.toContain('matchup');
  expect(body.toLowerCase()).not.toContain('strong against');
  expect(body.toLowerCase()).not.toContain('weak against');
  expect(body.toLowerCase()).not.toContain('ai coaching');
  expect(body.toLowerCase()).not.toContain('counter pick');
  expect(body.toLowerCase()).not.toContain('pick rate');
  expect(body.toLowerCase()).not.toContain('ban rate');
  expect(body.toLowerCase()).not.toContain('collectorrun');
  expect(body.toLowerCase()).not.toContain('discoverydepth');
  expect(body.toLowerCase()).not.toContain('externalaccountid');
}

async function assertNoChampionFilterLocalStorage(page: Page): Promise<void> {
  const keys = await page.evaluate(() => Object.keys(localStorage));
  const championFilterKeys = keys.filter((key) =>
    /champion.*(filter|stats|position|tier|patch|queue)/i.test(key),
  );
  expect(championFilterKeys).toEqual([]);
}

async function selectPositionMid(
  page: Page,
  scope: 'directory' | 'detail' = 'directory',
): Promise<void> {
  const labelledBy = scope === 'directory' ? 'position-label' : 'detail-position-label';
  const group = page.locator(`[role="radiogroup"][aria-labelledby="${labelledBy}"]`);
  await group.getByRole('radio', { name: 'Mid' }).click();
}

test.describe('champions directory and detail', () => {
  let mocks: InstalledChampionMocks;

  test.beforeEach(async ({ page }) => {
    mocks = await installChampionApiMocks(page);
  });

  test.afterEach(async () => {
    await mocks.dispose();
  });

  test('directory loads without ranking until position is selected', async ({ page }) => {
    test.setTimeout(60_000);

    await gotoApp(page, '/champions');

    await expect(page.getByRole('heading', { name: 'Champions', level: 1 })).toBeVisible();
    await expect(page.getByRole('note')).toContainText(CHAMPION_STATS_DISCLAIMER);
    await expect(page.getByRole('heading', { name: 'Filters' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Champion directory' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Ahri/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Select a position' })).toBeVisible();

    // Filters + directory list only — no ranking table request yet.
    expect(mocks.hasRankingTableRequest()).toBe(false);
    expect(mocks.requests.some((r) => r.pathname.includes('/api/champion-stats/filters'))).toBe(
      true,
    );
    expect(mocks.requests.some((r) => r.pathname.endsWith('/api/champions'))).toBe(true);

    await assertNoPuuidOrDeferredSections(page);

    const ahriIcon = page.locator(`img[alt="Ahri icon"]`).first();
    await expect(ahriIcon).toBeVisible();
    await expect(ahriIcon).toHaveAttribute('src', MOCK_ICON_AHRI);
  });

  test('selecting Mid updates URL, fetches ranking, and shows collected sample table', async ({
    page,
  }) => {
    test.setTimeout(60_000);

    await gotoApp(page, '/champions');
    await expect(page.getByRole('heading', { name: 'Champion directory' })).toBeVisible();
    expect(mocks.hasRankingTableRequest()).toBe(false);

    await selectPositionMid(page, 'directory');

    await expect(page).toHaveURL(/position=MIDDLE/);
    await expect(page.getByRole('heading', { name: 'Collected sample ranking' })).toBeVisible({
      timeout: 15_000,
    });

    await expect.poll(() => mocks.hasRankingTableRequest(), { timeout: 10_000 }).toBe(true);
    expect(mocks.rankingRequests.some((r) => r.searchParams.get('position') === 'MIDDLE')).toBe(
      true,
    );

    // Default mocks return ranking rows — assert real content, not loading/updating status.
    const rankingSection = page.locator('[aria-labelledby="collected-sample-ranking-heading"]');
    await expect(rankingSection.getByRole('link', { name: /Ahri/i }).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('empty ranking shows empty guidance without treating loading status as success', async ({
    page,
  }) => {
    test.setTimeout(90_000);

    // Routes already installed in beforeEach; toggle empty ranking before navigation.
    mocks.setEmptyRanking(true);
    await gotoApp(page, '/champions');
    await waitForChampionsFilters(page);

    await selectPositionMid(page, 'directory');
    await expect(page).toHaveURL(/position=MIDDLE/, { timeout: 15_000 });

    const rankingSection = page.locator('[aria-labelledby="collected-sample-ranking-heading"]');
    await expect(
      rankingSection.getByRole('heading', { name: 'Collected sample ranking' }),
    ).toBeVisible({
      timeout: 15_000,
    });
    await expect(rankingSection.getByRole('link', { name: /Ahri/i })).toHaveCount(0);
    await expect(
      rankingSection.getByRole('status').filter({
        hasText: /No collected-sample ranking rows for these filters/i,
      }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('filter changes keep URL authoritative and avoid localStorage filter keys', async ({
    page,
  }) => {
    test.setTimeout(90_000);

    await gotoApp(page, '/champions');
    await waitForChampionsFilters(page);

    const filters = page.locator('[aria-labelledby="champion-filters-heading"]');
    // Rapid selects (same as real UI: void setters). Product must not drop mid-flight patches.
    await filters.getByLabel('Platform').selectOption('euw1');
    await filters.getByLabel('Queue').selectOption('440');
    await filters.getByLabel('Tier').selectOption('GOLD');
    await filters.getByLabel('Patch').selectOption('14.10');
    await selectPositionMid(page, 'directory');

    await expect(page).toHaveURL(/platform=euw1/, { timeout: 15_000 });
    await expect(page).toHaveURL(/queue=440/, { timeout: 15_000 });
    await expect(page).toHaveURL(/tier=GOLD/, { timeout: 15_000 });
    await expect(page).toHaveURL(/patch=14\.10/, { timeout: 15_000 });
    await expect(page).toHaveURL(/position=MIDDLE/, { timeout: 15_000 });

    await assertNoChampionFilterLocalStorage(page);
  });

  test('directory champion link preserves aggregate query without search/tag', async ({ page }) => {
    test.setTimeout(60_000);

    await gotoApp(
      page,
      '/champions?platform=na1&queue=420&tier=ALL&patch=14.11&position=MIDDLE&search=Ah&tag=Mage',
    );
    await expect(page.getByRole('link', { name: /Ahri/i }).first()).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole('link', { name: /Ahri/i }).first().click();
    await expect(page).toHaveURL(/\/champions\/Ahri/);
    await expect(page).toHaveURL(/platform=na1/);
    await expect(page).toHaveURL(/queue=420/);
    await expect(page).toHaveURL(/position=MIDDLE/);
    await expect(page).not.toHaveURL(/search=/);
    await expect(page).not.toHaveURL(/tag=/);

    await expect(page.getByRole('heading', { name: 'Ahri', level: 1 })).toBeVisible();
  });

  test('detail page loads hero and stats; Mid selection scopes stats without ranking table', async ({
    page,
  }) => {
    test.setTimeout(60_000);

    await gotoApp(page, '/champions/Ahri?platform=na1&queue=420&tier=ALL&patch=14.11');

    await expect(page.getByRole('heading', { name: 'Ahri', level: 1 })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText('the Nine-Tailed Fox')).toBeVisible();
    await expect(page.locator('img[alt="Ahri icon"]').first()).toHaveAttribute(
      'src',
      MOCK_ICON_AHRI,
    );
    await expect(page.locator('img[alt=""]').first()).toHaveAttribute('src', /Ahri_0/);

    // Stats load for breakdown without requiring position (no invented ALL-position exact metrics).
    await expect.poll(() => mocks.statsRequests.length, { timeout: 10_000 }).toBeGreaterThan(0);
    const initialStats = mocks.statsRequests[mocks.statsRequests.length - 1];
    expect(initialStats?.searchParams.get('position')).toBeNull();

    await expect(page.getByRole('heading', { name: 'Primary stats' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Position breakdown' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Data limitations' })).toBeVisible();
    await expect(
      page.getByText(/Select a position to load exact-position collected-sample statistics/i),
    ).toBeVisible();
    // Performance panel mounts only after a position is selected.
    await expect(page.getByRole('heading', { name: 'Performance' })).toHaveCount(0);

    const rankingBefore = mocks.rankingRequests.length;
    await selectPositionMid(page, 'detail');

    await expect(page).toHaveURL(/position=MIDDLE/);
    await expect
      .poll(() => mocks.statsRequests.some((r) => r.searchParams.get('position') === 'MIDDLE'), {
        timeout: 10_000,
      })
      .toBe(true);

    // Detail must not request directory ranking table.
    expect(mocks.rankingRequests.length).toBe(rankingBefore);

    const primary = page.locator('[aria-labelledby="primary-stats-heading"]');
    await expect(primary.getByText('55.0%')).toBeVisible();
    await expect(primary.getByText(/80\s*games/i)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Performance' })).toBeVisible();
    await expect(page.getByText('KDA')).toBeVisible();

    await assertNoPuuidOrDeferredSections(page);

    // Filter-preserving directory back link.
    const back = page.getByRole('link', { name: /Back to champions directory/i });
    await expect(back).toHaveAttribute('href', /\/champions\?/);
    await expect(back).toHaveAttribute('href', /platform=na1/);
    await expect(back).toHaveAttribute('href', /position=MIDDLE/);
  });

  test('limited sample (n=18) shows win rate, games, and Limited sample without empty shell', async ({
    page,
  }) => {
    test.setTimeout(60_000);

    mocks.setLimitedSample(true);
    await gotoApp(
      page,
      '/champions/Ahri?platform=na1&queue=420&tier=ALL&patch=14.11&position=MIDDLE',
    );

    await expect(page.getByRole('heading', { name: 'Ahri', level: 1 })).toBeVisible({
      timeout: 15_000,
    });

    const primary = page.locator('[aria-labelledby="primary-stats-heading"]');
    await expect(primary.getByTestId('primary-stats-metrics')).toBeVisible({
      timeout: 10_000,
    });
    await expect(primary.getByText(/55\.6%/)).toBeVisible();
    await expect(primary.getByText(/18\s*games/i)).toBeVisible();
    await expect(primary.getByText(/10\s*[–-]\s*8/)).toBeVisible();
    await expect(primary.getByText(/Limited sample/i)).toBeVisible();
    await expect(
      primary.getByText(/Not enough collected matches meet the minimum sample size/i),
    ).toHaveCount(0);
    await expect(
      primary.getByText(/No collected-sample statistics for this champion/i),
    ).toHaveCount(0);

    const performance = page.locator('[aria-labelledby="performance-cards-heading"]');
    await expect(performance.getByText('KDA')).toBeVisible();
    await expect(performance.getByText('-115')).toBeVisible();
    await expect(performance.getByText('Unavailable').first()).toBeVisible();

    await assertNoPuuidOrDeferredSections(page);
  });

  test('empty stats shows guidance without fake zeros', async ({ page }) => {
    test.setTimeout(60_000);

    mocks.setEmptyStats(true);
    await gotoApp(
      page,
      '/champions/Ahri?platform=na1&queue=420&tier=ALL&patch=14.11&position=MIDDLE',
    );

    await expect(page.getByRole('heading', { name: 'Ahri', level: 1 })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/No collected-sample statistics for this champion/i)).toBeVisible({
      timeout: 10_000,
    });

    const overview = page.locator('[aria-labelledby="primary-stats-heading"]');
    await expect(overview.getByText('0%')).toHaveCount(0);
    await expect(overview.getByText(/^0$/)).toHaveCount(0);
    await expect(overview.getByTestId('primary-stats-metrics')).toHaveCount(0);

    const performance = page.locator('[aria-labelledby="performance-cards-heading"]');
    await expect(performance.getByText(/appear when a position is selected/i)).toBeVisible();
  });

  test('unknown champion key shows not-found', async ({ page }) => {
    test.setTimeout(45_000);

    await gotoApp(page, '/champions/UnknownChampion');
    await expect(page.getByRole('heading', { name: 'Champion not found' })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('numeric champion route shows not-found without inventing id lookup', async ({ page }) => {
    test.setTimeout(45_000);

    await gotoApp(page, '/champions/23');
    await expect(page.getByRole('heading', { name: 'Champion not found' })).toBeVisible({
      timeout: 15_000,
    });
    // Numeric keys are rejected client-side before detail API.
    expect(mocks.requests.some((r) => /\/api\/champions\/23/.test(r.pathname))).toBe(false);
  });

  test('lowercase champion key replaces to canonical without duplicate history entry', async ({
    page,
  }) => {
    test.setTimeout(90_000);

    await gotoApp(page, '/champions');
    await expect(page.getByRole('heading', { name: 'Champions', level: 1 })).toBeVisible();

    await gotoApp(page, '/champions/ahri?platform=na1&queue=420&patch=14.11');
    await expect(page).toHaveURL(/\/champions\/Ahri/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Ahri', level: 1 })).toBeVisible();

    // router.replace for case canonicalization must not leave a lowercase history entry.
    await page.goBack();
    await expect(page).toHaveURL(/\/champions\/?(\?|$)/, { timeout: 15_000 });
    await expect(page).not.toHaveURL(/\/champions\/ahri(?:\?|$)/);
  });

  test('keyboard can activate Mid position radio', async ({ page }) => {
    test.setTimeout(60_000);

    await gotoApp(page, '/champions');
    await expect(page.getByRole('radiogroup', { name: 'Position' })).toBeVisible();

    const mid = page.getByRole('radio', { name: 'Mid' });
    await mid.focus();
    await expect(mid).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/position=MIDDLE/);
    await expect(mid).toHaveAttribute('aria-checked', 'true');
  });

  test('responsive: no overflow at 375px; ranking table usable at 1280px', async ({ page }) => {
    test.setTimeout(120_000);

    await page.setViewportSize({ width: 375, height: 812 });
    await gotoApp(page, '/champions');
    await waitForChampionsFilters(page);
    await expect(page.getByRole('heading', { name: 'Champion directory' })).toBeVisible();
    expect(await hasHorizontalOverflow(page)).toBe(false);

    await selectPositionMid(page, 'directory');
    await expect(page.getByRole('heading', { name: 'Collected sample ranking' })).toBeVisible({
      timeout: 20_000,
    });
    expect(await hasHorizontalOverflow(page)).toBe(false);

    await gotoApp(page, '/champions/Ahri?platform=na1&queue=420&patch=14.11&position=MIDDLE');
    await expect(page.getByRole('heading', { name: 'Ahri', level: 1 })).toBeVisible({
      timeout: 30_000,
    });
    expect(await hasHorizontalOverflow(page)).toBe(false);

    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoApp(page, '/champions?platform=na1&queue=420&patch=14.11&position=MIDDLE');
    await expect(page.getByRole('heading', { name: 'Collected sample ranking' })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator('table').first()).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Win rate' })).toBeVisible();
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });

  test('async regions expose aria-live / status roles', async ({ page }) => {
    test.setTimeout(60_000);

    await gotoApp(page, '/champions');
    await selectPositionMid(page, 'directory');
    await expect(page.getByRole('heading', { name: 'Collected sample ranking' })).toBeVisible({
      timeout: 15_000,
    });

    const liveRegions = page.locator('[aria-live="polite"], [role="status"]');
    await expect(liveRegions.first()).toBeAttached();

    await gotoApp(page, '/champions/Ahri?platform=na1&queue=420&patch=14.11');
    await expect(page.getByRole('heading', { name: 'Ahri', level: 1 })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('[aria-live="polite"]').first()).toBeAttached();
  });

  test('ability row renders for Ahri, Aatrox, and Zed with keyboard-accessible details', async ({
    page,
  }) => {
    test.setTimeout(90_000);

    await gotoApp(page, '/champions/Ahri?platform=na1&queue=420&patch=14.11');
    await expect(page.getByRole('heading', { name: 'Ahri', level: 1 })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('toolbar', { name: 'Champion abilities' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Passive: Essence Theft' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Q: Orb of Deception' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'R: Spirit Rush' })).toBeVisible();

    await page.getByRole('button', { name: 'Q: Orb of Deception' }).click();
    const ahriDetail = page.getByTestId('champion-ability-popover');
    await expect(ahriDetail).toBeVisible();
    await expect(ahriDetail).toContainText('Orb of Deception');
    await expect(ahriDetail).toContainText('Cooldown');
    await expect(page.getByRole('heading', { name: 'Primary stats' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(ahriDetail).toHaveCount(0);

    await gotoApp(page, '/champions/Aatrox?platform=na1&queue=420&patch=14.11');
    await expect(page.getByRole('heading', { name: 'Aatrox', level: 1 })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('button', { name: 'Passive: Deathbringer Stance' })).toBeVisible();
    await page.getByRole('button', { name: 'R: World Ender' }).click();
    await expect(page.getByTestId('champion-ability-popover')).toContainText('World Ender');

    await gotoApp(page, '/champions/Zed?platform=na1&queue=420&patch=14.11');
    await expect(page.getByRole('heading', { name: 'Zed', level: 1 })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('button', { name: 'Q: Razor Shuriken' })).toBeVisible();
    await page.getByRole('button', { name: 'Q: Razor Shuriken' }).click();
    await expect(page.getByTestId('champion-ability-popover')).toContainText('Razor Shuriken');
    await page.getByRole('button', { name: 'E: Shadow Slash' }).click();
    await expect(page.getByTestId('champion-ability-popover')).toContainText('Shadow Slash');
    await expect(page.getByTestId('champion-ability-popover')).not.toContainText('Razor Shuriken');

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('toolbar', { name: 'Champion abilities' })).toBeVisible();
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(page.getByRole('toolbar', { name: 'Champion abilities' })).toBeVisible();
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByRole('toolbar', { name: 'Champion abilities' })).toBeVisible();
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });

  test('missing abilities do not break champion identity or analytics chrome', async ({ page }) => {
    test.setTimeout(60_000);

    await gotoApp(page, '/champions/Annie?platform=na1&queue=420&patch=14.11');
    await expect(page.getByRole('heading', { name: 'Annie', level: 1 })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText('the Dark Child')).toBeVisible();
    await expect(page.getByRole('toolbar', { name: 'Champion abilities' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Context' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Back to champions directory/i })).toBeVisible();
  });
});

test.describe('player → champion links', () => {
  const PLAYER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

  test('mastery card links to champion detail when championKey is present', async ({ page }) => {
    test.setTimeout(120_000);

    // Install all routes before any navigation.
    const disposePlayer = await installPlayerProfileMock(page, PLAYER_ID);
    const championMocks = await installChampionApiMocks(page);

    try {
      await gotoApp(page, `/players/${PLAYER_ID}`);
      await expect(page.getByRole('heading', { name: 'Champion mastery' })).toBeVisible({
        timeout: 30_000,
      });

      const masteryLink = page.locator(`a[href^="/champions/Ahri"]`).first();
      await expect(masteryLink).toBeVisible({ timeout: 15_000 });
      await masteryLink.click();
      await expect(page).toHaveURL(/\/champions\/Ahri/, { timeout: 15_000 });
      await expect(page.getByRole('heading', { name: 'Ahri', level: 1 })).toBeVisible({
        timeout: 30_000,
      });
    } finally {
      await championMocks.dispose();
      await disposePlayer();
    }
  });
});
