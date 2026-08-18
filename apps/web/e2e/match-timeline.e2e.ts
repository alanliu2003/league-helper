import { expect, test } from '@playwright/test';
import { MATCH_DETAIL_ID, matchDetailFixture } from '../components/match/match-detail.fixture';
import { timelineDetailFixture } from '../components/match/match-timeline.fixture';

test.describe('match timeline', () => {
  test('keeps overview teams and lazy-loads a kill feed on the Timeline tab', async ({ page }) => {
    test.setTimeout(60_000);

    await page.route(`**/api/matches/${MATCH_DETAIL_ID}/timeline`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(timelineDetailFixture()),
      });
    });
    await page.route('**/api/matches/**', async (route) => {
      if (route.request().url().includes('/timeline')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(timelineDetailFixture()),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(matchDetailFixture()),
      });
    });

    await page.goto(`/matches/${MATCH_DETAIL_ID}`);
    await expect(page.getByRole('heading', { level: 2, name: /Blue Team/ })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: /Red Team/ })).toBeVisible();

    await page.getByRole('tab', { name: 'Timeline' }).click();
    await expect(
      page.getByText('02:14 Blue Top · Tryndamere kills Red Top · Aatrox'),
    ).toBeVisible();
    await expect(page.getByRole('img', { name: 'Team gold over time' })).toBeVisible();

    const body = await page.locator('#main-content').innerText();
    expect(body.toLowerCase()).not.toContain('puuid');
  });

  test('selects Timeline from the #timeline hash', async ({ page }) => {
    test.setTimeout(60_000);

    await page.route(`**/api/matches/${MATCH_DETAIL_ID}/timeline`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(timelineDetailFixture()),
      });
    });
    await page.route('**/api/matches/**', async (route) => {
      if (route.request().url().includes('/timeline')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(timelineDetailFixture()),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(matchDetailFixture()),
      });
    });

    await page.goto(`/matches/${MATCH_DETAIL_ID}#timeline`);
    await expect(page.getByRole('tab', { name: 'Timeline' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(
      page.getByText('02:14 Blue Top · Tryndamere kills Red Top · Aatrox'),
    ).toBeVisible();
  });
});
