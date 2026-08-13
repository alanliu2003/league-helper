import { expect, test } from '@playwright/test';

/**
 * Live local API smoke for Milestone 10 Phase 5.
 * Skipped unless PLAYWRIGHT_LIVE_SMOKE=1 (uses real collected aggregates).
 */
const live = process.env.PLAYWRIGHT_LIVE_SMOKE === '1';

test.describe('champion detail live smoke', () => {
  test.skip(!live, 'Set PLAYWRIGHT_LIVE_SMOKE=1 against local API with collected aggregates');

  test('Ahri no-data + Diana limited sample + position switch + mobile', async ({ page }) => {
    test.setTimeout(120_000);

    // A. Ahri / no data
    await page.goto('/champions/Ahri?platform=na1&queue=420&tier=ALL&patch=16.15&position=MIDDLE', {
      waitUntil: 'domcontentloaded',
      timeout: 90_000,
    });
    await expect(page.getByRole('heading', { name: 'Ahri', level: 1 })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('heading', { name: 'Context' })).toBeVisible();
    await expect(page.getByText(/No collected-sample statistics for this champion/i)).toBeVisible();
    const ahriPrimary = page.locator('[aria-labelledby="primary-stats-heading"]');
    await expect(ahriPrimary.getByTestId('primary-stats-metrics')).toHaveCount(0);
    await expect(ahriPrimary.getByText('0%')).toHaveCount(0);
    const ahriBody = await page.locator('#main-content').innerText();
    expect(ahriBody.toLowerCase()).not.toContain('pick rate');
    expect(ahriBody.toLowerCase()).not.toContain('ban rate');
    expect(ahriBody.toLowerCase()).not.toContain('puuid');
    expect(ahriBody.toLowerCase()).not.toContain('discoverydepth');

    // B. Diana low sample
    await page.goto(
      '/champions/Diana?platform=na1&queue=420&tier=ALL&patch=16.15&position=MIDDLE',
      { waitUntil: 'domcontentloaded', timeout: 90_000 },
    );
    await expect(page.getByRole('heading', { name: 'Diana', level: 1 })).toBeVisible({
      timeout: 30_000,
    });
    const primary = page.locator('[aria-labelledby="primary-stats-heading"]');
    await expect(primary.getByTestId('primary-stats-metrics')).toBeVisible({ timeout: 15_000 });
    await expect(primary.getByText('0.0%')).toBeVisible();
    await expect(primary.getByText(/1\s*game/i)).toBeVisible();
    await expect(primary.getByText(/0\s*[–-]\s*1/)).toBeVisible();
    await expect(primary.getByText(/Limited sample/i)).toBeVisible();

    const performance = page.locator('[aria-labelledby="performance-cards-heading"]');
    await expect(performance.getByText('KDA')).toBeVisible();
    await expect(performance.getByText('-115')).toBeVisible();
    await expect(performance.getByText('-1592')).toBeVisible();

    // MIDDLE visible; other roles No data
    await expect(page.getByText(/1\s*game/i).first()).toBeVisible();
    await expect(page.getByText('No data').first()).toBeVisible();

    // C. position switch → TOP clears exact stats
    const group = page.locator('[role="radiogroup"][aria-labelledby="detail-position-label"]');
    await group.getByRole('radio', { name: 'Top' }).click();
    await expect(page).toHaveURL(/position=TOP/);
    await expect(page.getByText(/No collected-sample statistics for this champion/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(primary.getByTestId('primary-stats-metrics')).toHaveCount(0);
    // Stale Middle WR / Limited sample from prior position must not remain in primary.
    await expect(primary.getByText('0.0%')).toHaveCount(0);

    // D. mobile viewport
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(
      '/champions/Diana?platform=na1&queue=420&tier=ALL&patch=16.15&position=MIDDLE',
      { waitUntil: 'domcontentloaded', timeout: 90_000 },
    );
    await expect(page.getByRole('heading', { name: 'Diana', level: 1 })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('primary-stats-metrics')).toBeVisible();
    await expect(page.getByTestId('position-breakdown-mobile')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflow).toBe(false);

    const heroBox = await page.locator('.champion-detail-hero').boundingBox();
    expect(heroBox).not.toBeNull();
    expect(heroBox!.height).toBeLessThan(400);
  });
});
