import { describe, expect, it } from 'vitest';
import { formatRiotId, parseRiotId, RiotIdSchema } from './riot-id';
import { InvalidRiotIdError } from './errors';

describe('RiotId', () => {
  it('trims surrounding whitespace and preserves display casing', () => {
    const riotId = parseRiotId({ gameName: '  Faker  ', tagLine: ' KR1 ' });
    expect(riotId).toEqual({ gameName: 'Faker', tagLine: 'KR1' });
    expect(formatRiotId(riotId)).toBe('Faker#KR1');
  });

  it.each([
    [{ gameName: '', tagLine: 'NA1' }],
    [{ gameName: '   ', tagLine: 'NA1' }],
    [{ gameName: 'Hide', tagLine: '' }],
    [{ gameName: 'Hide', tagLine: '   ' }],
    [{ gameName: 'a'.repeat(17), tagLine: 'NA1' }],
    [{ gameName: 'Hide', tagLine: 'TOOLONG' }],
  ])('rejects invalid Riot ID %j', (input) => {
    expect(() => parseRiotId(input)).toThrow(InvalidRiotIdError);
    expect(RiotIdSchema.safeParse(input).success).toBe(false);
  });
});
