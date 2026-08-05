import { expect, test } from '@playwright/test';

/**
 * Happy path with mock Riot provider (API must use RIOT_PROVIDER_MODE=mock).
 * Does not call Riot live APIs.
 *
 * Full worker ingestion (match cards from completed jobs) is not started by Playwright
 * because spinning up API + worker + Redis job processing is heavier than this suite.
 * Prefer: run `pnpm --filter @league-helper/worker start` alongside `pnpm dev`, then
 * search ExamplePlayer#NA1 and wait for cards. Unit/integration tests cover card mapping
 * and polling stop conditions.
 */
test.describe('player search happy path', () => {
  test('searches a mock Riot ID and shows processing match UI', async ({ page }) => {
    test.setTimeout(60_000);

    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByLabel('Game name')).toBeVisible();
    // Wait for client hydration + API health so the Vue submit handler is attached.
    await expect(page.getByText('Development status')).toBeVisible();
    await expect(page.getByText('Provider mode')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('mock')).toBeVisible();

    await page.getByLabel('Game name').fill('ExamplePlayer');
    await page.getByLabel('Tag line').fill('NA1');
    await page.getByLabel('Platform').selectOption('na1');

    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes('/api/players/search') && response.request().method() === 'POST',
        { timeout: 30_000 },
      ),
      page.getByRole('button', { name: 'Search player' }).click(),
    ]);

    await expect(page).toHaveURL(/\/players\/[0-9a-f-]{36}/i, { timeout: 30_000 });

    await expect(page.getByRole('heading', { level: 1 })).toContainText('ExamplePlayer');
    await expect(page.getByText(/North America/i).first()).toBeVisible();
    await expect(page.getByText('Refresh status')).toBeVisible();
    await expect(page.getByText('Match ingestion is in progress.')).toBeVisible();
    await expect(page.getByText(/queued/i).first()).toBeVisible();

    const body = await page.locator('main').innerText();
    expect(body.toLowerCase()).not.toContain('puuid');
    expect(body).not.toContain('fake-puuid');
    expect(body).not.toContain('worker is implemented');

    // Jobs wait for the worker; refresh stays PROCESSING while queued/active/delayed remain.
    await expect(page.getByRole('button', { name: /Refresh profile/i })).toBeDisabled();
    await expect(page.getByText(/processing|queued/i).first()).toBeVisible();
  });
});
