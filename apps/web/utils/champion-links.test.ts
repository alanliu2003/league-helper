import { describe, expect, it } from 'vitest';
import { buildChampionPath, buildChampionsDirectoryPath } from './champion-links';

describe('buildChampionPath', () => {
  it('builds a champion detail path with aggregate filters only', () => {
    expect(
      buildChampionPath('Ahri', {
        platform: 'na1',
        queue: 420,
        tier: 'GOLD',
        position: 'MIDDLE',
        patch: '14.11',
      }),
    ).toBe('/champions/Ahri?platform=na1&queue=420&tier=GOLD&position=MIDDLE&patch=14.11');
  });

  it('never puts search or tag onto champion detail links', () => {
    const path = buildChampionPath('Ahri', {
      platform: 'na1',
      queue: 420,
      tier: 'ALL',
      position: 'MIDDLE',
      patch: '14.11',
      search: 'ahri',
      tag: 'Mage',
    } as {
      platform: string;
      queue: number;
      tier: string;
      position: string;
      patch: string;
      search?: string;
      tag?: string;
    });

    expect(path).toContain('/champions/Ahri');
    expect(path).not.toContain('search=');
    expect(path).not.toContain('tag=');
  });

  it('omits empty optional filter values', () => {
    expect(buildChampionPath('Zed', { platform: 'euw1', queue: 420 })).toBe(
      '/champions/Zed?platform=euw1&queue=420',
    );
  });
});

describe('buildChampionsDirectoryPath', () => {
  it('includes directory-only search and tag params', () => {
    expect(
      buildChampionsDirectoryPath({
        platform: 'na1',
        queue: 420,
        tier: 'ALL',
        position: 'TOP',
        patch: '14.11',
        search: 'lux',
        tag: 'Mage',
      }),
    ).toBe(
      '/champions?platform=na1&queue=420&tier=ALL&position=TOP&patch=14.11&search=lux&tag=Mage',
    );
  });

  it('canonicalizes queue as the public param name', () => {
    const path = buildChampionsDirectoryPath({
      platform: 'na1',
      queue: 420,
      tier: 'ALL',
      patch: '14.11',
    });
    expect(path).toContain('queue=420');
    expect(path).not.toContain('queueId=');
  });
});
