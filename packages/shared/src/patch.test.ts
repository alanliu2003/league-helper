import { describe, expect, it } from 'vitest';
import { parsePatchVersion } from './patch';

describe('parsePatchVersion', () => {
  it.each([
    ['14.1.1.123', { major: 14, minor: 1, label: '14.1' }],
    ['14.1', { major: 14, minor: 1, label: '14.1' }],
    [' 15.6.0 ', { major: 15, minor: 6, label: '15.6' }],
  ])('normalizes %j', (raw, expected) => {
    expect(parsePatchVersion(raw)).toMatchObject({ raw: raw.trim(), ...expected });
  });

  it.each(['', '14', 'abc', '14.x.1', null, 14.1, '14.'])(
    'returns null for unknown/incomplete input %j',
    (input) => {
      expect(parsePatchVersion(input)).toBeNull();
    },
  );
});
