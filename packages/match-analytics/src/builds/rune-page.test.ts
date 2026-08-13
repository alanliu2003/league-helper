import { describe, expect, it } from 'vitest';
import { deriveRunePage } from './rune-page';

describe('deriveRunePage', () => {
  it('surfaces keystone, remaining perks, styles, and stat shards when present', () => {
    const page = deriveRunePage({
      perkIds: [8112, 8126, 8138, 8135, 8226, 8233],
      statPerkIds: [5008, 5008, 5001],
      primaryPerkStyleId: 8100,
      secondaryPerkStyleId: 8200,
    });
    expect(page).toEqual({
      signature: '8100:8112-8126-8138-8135:8200:8226-8233:5008-5008-5001',
      keystoneId: 8112,
      primaryPerkIds: [8112, 8126, 8138, 8135],
      secondaryPerkIds: [8226, 8233],
      statPerkIds: [5008, 5008, 5001],
      primaryPerkStyleId: 8100,
      secondaryPerkStyleId: 8200,
      stylesComplete: true,
    });
  });

  it('does not fabricate style trees when only perk IDs exist', () => {
    const page = deriveRunePage({
      perkIds: [8112, 8126, 8138, 8135, 8226, 8233],
      statPerkIds: [5008, 5008, 5001],
      primaryPerkStyleId: null,
      secondaryPerkStyleId: null,
    });
    expect(page?.stylesComplete).toBe(false);
    expect(page?.primaryPerkStyleId).toBeNull();
    expect(page?.keystoneId).toBe(8112);
  });

  it('returns null when perk selections are missing', () => {
    expect(
      deriveRunePage({
        perkIds: [],
        statPerkIds: [5008],
        primaryPerkStyleId: 8100,
        secondaryPerkStyleId: 8200,
      }),
    ).toBeNull();
  });
});
