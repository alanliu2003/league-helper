import { describe, expect, it, vi } from 'vitest';
import { matchDetailFixture } from '../components/match/match-detail.fixture';
import { MatchApiError } from './useMatchApi';
import { createMatchDetailPageController } from './useMatchDetailPage';

const MATCH_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PLAYER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('createMatchDetailPageController', () => {
  it('treats a missing player query as no origin highlight', async () => {
    const api = { getMatch: vi.fn(async () => matchDetailFixture()) };
    const page = createMatchDetailPageController(() => MATCH_ID, () => undefined, api);
    await page.load();
    expect(page.originPlayerId.value).toBeNull();
    expect(page.detail.value?.match.id).toBe(MATCH_ID);
    expect(page.notFound.value).toBe(false);
  });

  it('preserves a matching origin player UUID', async () => {
    const api = { getMatch: vi.fn(async () => matchDetailFixture()) };
    const page = createMatchDetailPageController(() => MATCH_ID, () => PLAYER_ID, api);
    await page.load();
    expect(page.originPlayerId.value).toBe(PLAYER_ID);
  });

  it('marks invalid match ids as not found without calling the API', async () => {
    const api = { getMatch: vi.fn() };
    const page = createMatchDetailPageController(() => 'not-a-uuid', () => undefined, api);
    await page.load();
    expect(page.notFound.value).toBe(true);
    expect(api.getMatch).not.toHaveBeenCalled();
  });

  it('marks 404 as not found', async () => {
    const api = {
      getMatch: vi.fn(async () => {
        throw new MatchApiError(404, 'RESOURCE_NOT_FOUND', 'Match not found.');
      }),
    };
    const page = createMatchDetailPageController(() => MATCH_ID, () => undefined, api);
    await page.load();
    expect(page.notFound.value).toBe(true);
    expect(page.errorMessage.value).toBeNull();
  });
});
