import { describe, expect, it } from 'vitest';
import { buildMatchPath } from './match-links';

describe('buildMatchPath', () => {
  it('builds a match path without a player query', () => {
    expect(buildMatchPath('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')).toBe(
      '/matches/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    );
  });

  it('includes the origin player query when provided', () => {
    expect(
      buildMatchPath('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
    ).toBe(
      '/matches/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa?player=bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    );
  });

  it('omits blank player ids', () => {
    expect(buildMatchPath('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '  ')).toBe(
      '/matches/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    );
  });
});
