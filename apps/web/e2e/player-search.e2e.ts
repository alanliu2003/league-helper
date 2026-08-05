import { expect, test } from '@playwright/test';

/**
 * Happy path with mock Riot provider (API must use RIOT_PROVIDER_MODE=mock).
 * Does not call Riot live APIs.
 */
test.describe('player search happy path', () => {
  test('searches a mock Riot ID and shows player profile', async ({ page }) => {
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
    await expect(
      page.getByText(
        'Recent matches are being queued for ingestion. Match details will appear after the ingestion worker is implemented.',
      ),
    ).toBeVisible();

    const body = await page.locator('main').innerText();
    expect(body.toLowerCase()).not.toContain('puuid');
    expect(body).not.toContain('fake-puuid');

    // Jobs wait for Milestone 6, so refresh stays PROCESSING and the button stays disabled.
    await expect(page.getByRole('button', { name: /Refresh profile/i })).toBeDisabled();
    await expect(page.getByText(/processing|queued/i).first()).toBeVisible();
  });
});
