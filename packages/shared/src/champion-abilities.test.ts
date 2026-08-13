import { describe, expect, it } from 'vitest';
import {
  ChampionAbilitySlotSchema,
  ChampionAbilitySummarySchema,
  ChampionDetailSchema,
} from './champion-api';
import {
  ABILITY_SLOTS,
  extractChampionAbilities,
  normalizeAbilityDescription,
  snapshotDataDragonAbilities,
} from './champion-abilities';

const ICON_VERSION = '16.10.1';

function urls() {
  return {
    version: ICON_VERSION,
    buildPassiveIconUrl: (imageFull: string, version: string) =>
      `https://ddragon.leagueoflegends.com/cdn/${version}/img/passive/${imageFull}`,
    buildSpellIconUrl: (imageFull: string, version: string) =>
      `https://ddragon.leagueoflegends.com/cdn/${version}/img/spell/${imageFull}`,
  };
}

const ahriPassive = {
  name: 'Essence Theft',
  description:
    "Whenever Ahri hits a champion with a spell, she gains a stack of Essence Theft. At 9 stacks, Ahri's next spell that hits an enemy champion heals her.",
  image: { full: 'Ahri_SoulEater2.png', group: 'passive' },
};

const ahriSpells = [
  {
    id: 'AhriQ',
    name: 'Orb of Deception',
    description:
      "Ahri sends out and pulls back her orb, dealing <font color='#99FF99'>magic damage</font> on the way out and <font color='#FF3300'>true damage</font> on the way back.<br /><br>Second line.",
    tooltip: 'Deals {{ e1 }} magic damage. Do not dump this.',
    cooldownBurn: '7',
    costBurn: '55/65/75/85/95',
    rangeBurn: '900',
    image: { full: 'AhriQ.png', group: 'spell' },
  },
  {
    id: 'AhriW',
    name: 'Fox-Fire',
    description: 'Ahri releases fox-fires.',
    cooldownBurn: '9/8/7/6/5',
    costBurn: '30',
    rangeBurn: '700',
    image: { full: 'AhriW.png', group: 'spell' },
  },
  {
    id: 'AhriE',
    name: 'Charm',
    description: 'Ahri blows a kiss.',
    cooldownBurn: '12',
    costBurn: '60',
    rangeBurn: '1000',
    image: { full: 'AhriE.png', group: 'spell' },
  },
  {
    id: 'AhriR',
    name: 'Spirit Rush',
    description: 'Ahri dashes forward and fires essence bolts.',
    cooldownBurn: '130/105/80',
    costBurn: '100',
    rangeBurn: '500',
    image: { full: 'AhriR.png', group: 'spell' },
  },
];

describe('normalizeAbilityDescription', () => {
  it('strips HTML-like tags and converts br tags to line breaks', () => {
    const text = normalizeAbilityDescription(
      "Deals <font color='#99FF99'>magic damage</font>.<br /><br>Second paragraph.",
    );
    expect(text).toBe('Deals magic damage.\n\nSecond paragraph.');
    expect(text).not.toMatch(/<[^>]+>/);
  });

  it('decodes common entities and collapses noisy whitespace', () => {
    const text = normalizeAbilityDescription('A&nbsp;&amp;&nbsp;B<br>C');
    expect(text).toBe('A & B\nC');
  });

  it('does not invent values for template markers', () => {
    const text = normalizeAbilityDescription('Deals {{ e1 }} damage to {{ e2 }} targets.');
    expect(text).toBe('Deals damage to targets.');
    expect(text).not.toContain('{{');
    expect(text).not.toMatch(/\d+/);
  });

  it('returns empty string for missing or non-string input', () => {
    expect(normalizeAbilityDescription(undefined)).toBe('');
    expect(normalizeAbilityDescription(null)).toBe('');
    expect(normalizeAbilityDescription(12)).toBe('');
    expect(normalizeAbilityDescription('   ')).toBe('');
  });
});

describe('snapshotDataDragonAbilities', () => {
  it('extracts a trimmed passive + Q/W/E/R snapshot without tooltip blobs', () => {
    const snapshot = snapshotDataDragonAbilities({
      passive: ahriPassive,
      spells: ahriSpells,
    });
    expect(snapshot.passive).toEqual({
      name: 'Essence Theft',
      description: ahriPassive.description,
      imageFull: 'Ahri_SoulEater2.png',
    });
    expect(snapshot.spells).toHaveLength(4);
    expect(snapshot.spells[0]).toEqual({
      name: 'Orb of Deception',
      description: ahriSpells[0]?.description,
      imageFull: 'AhriQ.png',
      cooldownBurn: '7',
      costBurn: '55/65/75/85/95',
      rangeBurn: '900',
    });
    expect(JSON.stringify(snapshot)).not.toContain('tooltip');
    expect(JSON.stringify(snapshot)).not.toContain('{{ e1 }}');
  });

  it('stores empty passive/spells when Data Dragon fields are missing', () => {
    expect(snapshotDataDragonAbilities({})).toEqual({ passive: {}, spells: [] });
    expect(snapshotDataDragonAbilities({ passive: {}, spells: [] })).toEqual({
      passive: {},
      spells: [],
    });
  });
});

describe('extractChampionAbilities', () => {
  it('orders abilities as PASSIVE, Q, W, E, R', () => {
    const snapshot = snapshotDataDragonAbilities({
      passive: ahriPassive,
      spells: ahriSpells,
    });
    const abilities = extractChampionAbilities(snapshot, urls());
    expect(abilities.map((ability) => ability.slot)).toEqual([...ABILITY_SLOTS]);
    expect(abilities.map((ability) => ability.name)).toEqual([
      'Essence Theft',
      'Orb of Deception',
      'Fox-Fire',
      'Charm',
      'Spirit Rush',
    ]);
  });

  it('builds passive and spell icon URLs from image filenames and version', () => {
    const snapshot = snapshotDataDragonAbilities({
      passive: ahriPassive,
      spells: ahriSpells,
    });
    const abilities = extractChampionAbilities(snapshot, urls());
    expect(abilities[0]?.iconUrl).toBe(
      `https://ddragon.leagueoflegends.com/cdn/${ICON_VERSION}/img/passive/Ahri_SoulEater2.png`,
    );
    expect(abilities[1]?.iconUrl).toBe(
      `https://ddragon.leagueoflegends.com/cdn/${ICON_VERSION}/img/spell/AhriQ.png`,
    );
    expect(abilities[4]?.iconUrl).toBe(
      `https://ddragon.leagueoflegends.com/cdn/${ICON_VERSION}/img/spell/AhriR.png`,
    );
  });

  it('normalizes descriptions and omits raw tooltip markup', () => {
    const snapshot = snapshotDataDragonAbilities({
      passive: ahriPassive,
      spells: ahriSpells,
    });
    const q = extractChampionAbilities(snapshot, urls())[1];
    expect(q?.description).toBe(
      'Ahri sends out and pulls back her orb, dealing magic damage on the way out and true damage on the way back.\n\nSecond line.',
    );
    expect(q?.description).not.toMatch(/<[^>]+>/);
    expect(q).not.toHaveProperty('tooltip');
  });

  it('exposes cooldown, cost, and range only when source data has values', () => {
    const snapshot = snapshotDataDragonAbilities({
      passive: ahriPassive,
      spells: ahriSpells,
    });
    const [passive, q] = extractChampionAbilities(snapshot, urls());
    expect(passive?.cooldown).toBeUndefined();
    expect(passive?.cost).toBeUndefined();
    expect(passive?.range).toBeUndefined();
    expect(q?.cooldown).toBe('7');
    expect(q?.cost).toBe('55/65/75/85/95');
    expect(q?.range).toBe('900');
  });

  it('returns an empty list when stored ability data is missing', () => {
    expect(extractChampionAbilities({ passive: {}, spells: [] }, urls())).toEqual([]);
    expect(extractChampionAbilities({ passive: undefined, spells: undefined }, urls())).toEqual([]);
  });

  it('degrades missing optional fields without dropping the slot order', () => {
    const abilities = extractChampionAbilities(
      {
        passive: { name: 'Only Passive' },
        spells: [{ name: 'Q Name' }, {}, { name: 'E Name', description: 'Charm.' }],
      },
      urls(),
    );
    expect(abilities.map((ability) => ability.slot)).toEqual([...ABILITY_SLOTS]);
    expect(abilities[0]?.name).toBe('Only Passive');
    expect(abilities[1]?.name).toBe('Q Name');
    expect(abilities[2]?.name).toBe('W');
    expect(abilities[2]?.iconUrl).toBeNull();
    expect(abilities[2]?.description).toBe('');
    expect(abilities[3]?.name).toBe('E Name');
    expect(abilities[4]?.name).toBe('R');
    expect(abilities[1]?.cooldown).toBeUndefined();
  });

  it('returns null icon URLs when version or image filename is missing', () => {
    const abilities = extractChampionAbilities(
      {
        passive: { name: 'Essence Theft', imageFull: 'Ahri_SoulEater2.png' },
        spells: [{ name: 'Orb of Deception', imageFull: 'AhriQ.png' }],
      },
      {
        version: null,
        buildPassiveIconUrl: () => {
          throw new Error('should not build without version');
        },
        buildSpellIconUrl: () => {
          throw new Error('should not build without version');
        },
      },
    );
    expect(abilities[0]?.iconUrl).toBeNull();
    expect(abilities[1]?.iconUrl).toBeNull();
  });

  it('validates extracted abilities against the public DTO', () => {
    const snapshot = snapshotDataDragonAbilities({
      passive: ahriPassive,
      spells: ahriSpells,
    });
    const abilities = extractChampionAbilities(snapshot, urls());
    expect(abilities.map((ability) => ChampionAbilitySummarySchema.parse(ability))).toEqual(
      abilities,
    );
    expect(ChampionAbilitySlotSchema.options).toEqual(['PASSIVE', 'Q', 'W', 'E', 'R']);
    const detail = ChampionDetailSchema.parse({
      championId: 103,
      championKey: 'Ahri',
      name: 'Ahri',
      title: 'the Nine-Tailed Fox',
      tags: ['Mage'],
      iconUrl: 'https://example.com/ahri.png',
      abilities,
    });
    expect(detail.abilities).toHaveLength(5);
  });
});
