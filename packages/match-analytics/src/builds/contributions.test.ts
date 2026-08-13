import { describe, expect, it } from 'vitest';
import { deriveParticipantBuildContributions } from './contributions';
import type { BuildParticipantSource } from './eligibility';
import type { ItemStaticClassificationInput } from './item-classification';

function item(
  itemId: number,
  kind: 'BOOTS' | 'TRINKET' | 'CONSUMABLE' | 'COMPLETED_MAJOR' | 'COMPONENT' | 'OTHER',
): ItemStaticClassificationInput {
  return {
    itemId,
    tags:
      kind === 'BOOTS'
        ? ['Boots']
        : kind === 'TRINKET'
          ? ['Trinket']
          : kind === 'CONSUMABLE'
            ? ['Consumable']
            : [],
    goldTotal: kind === 'COMPLETED_MAJOR' ? 3200 : kind === 'BOOTS' ? 1100 : 50,
    purchasable: true,
    fromItemIds: kind === 'COMPLETED_MAJOR' ? [1038] : [],
    intoItemIds: kind === 'COMPONENT' ? [3031] : [],
    consumed: false,
  };
}

const catalog = new Map<number, ItemStaticClassificationInput>([
  [1056, item(1056, 'OTHER')],
  [2003, item(2003, 'CONSUMABLE')],
  [3340, item(3340, 'TRINKET')],
  [3006, item(3006, 'BOOTS')],
  [3031, item(3031, 'COMPLETED_MAJOR')],
  [3089, item(3089, 'COMPLETED_MAJOR')],
  [3135, item(3135, 'COMPLETED_MAJOR')],
]);

function source(overrides: Partial<BuildParticipantSource> = {}): BuildParticipantSource {
  return {
    itemIds: [3031, 3089, 3006, 0, 0, 0, 3340],
    perkIds: [8112, 8126, 8138, 8135, 8226, 8233],
    statPerkIds: [5008, 5008, 5001],
    primaryPerkStyleId: 8100,
    secondaryPerkStyleId: 8200,
    summonerSpell1Id: 12,
    summonerSpell2Id: 4,
    skillOrder: [1, 3, 2, 1, 1, 4],
    timelineEvents: [
      {
        type: 'ITEM_PURCHASED',
        timestampMs: 0,
        eventIndex: 0,
        participantId: 1,
        itemId: 1056,
      },
      {
        type: 'ITEM_PURCHASED',
        timestampMs: 0,
        eventIndex: 1,
        participantId: 1,
        itemId: 2003,
      },
      {
        type: 'ITEM_PURCHASED',
        timestampMs: 200_000,
        eventIndex: 2,
        participantId: 1,
        itemId: 3031,
      },
      {
        type: 'ITEM_PURCHASED',
        timestampMs: 400_000,
        eventIndex: 3,
        participantId: 1,
        itemId: 3089,
      },
      {
        type: 'ITEM_PURCHASED',
        timestampMs: 600_000,
        eventIndex: 4,
        participantId: 1,
        itemId: 3135,
      },
      {
        type: 'SKILL_LEVEL_UP',
        timestampMs: 0,
        eventIndex: 5,
        participantId: 1,
        skillSlot: 1,
      },
    ],
    ...overrides,
  };
}

describe('deriveParticipantBuildContributions', () => {
  it('emits only categories the source can support', () => {
    const rows = deriveParticipantBuildContributions({ source: source(), itemCatalog: catalog });
    const categories = rows.map((row) => row.category).sort();
    expect(categories).toEqual([
      'BOOTS',
      'CORE_BUILD',
      'RUNES',
      'SKILL_SEQUENCE',
      'STARTING_ITEMS',
      'SUMMONER_SPELLS',
    ]);
    expect(rows.find((row) => row.category === 'CORE_BUILD')?.entityIds).toEqual([
      3031, 3089, 3135,
    ]);
  });

  it('emits W>E>Q max order from timeline even when stored skillOrder is first-learned E W Q', () => {
    const sylasSlots = [3, 2, 1, 2, 2, 4, 2, 3, 2, 3, 4, 3, 3, 1, 1, 4, 1, 1];
    const rows = deriveParticipantBuildContributions({
      source: source({
        skillOrder: [3, 2, 1],
        timelineEvents: sylasSlots.map((skillSlot, eventIndex) => ({
          type: 'SKILL_LEVEL_UP',
          timestampMs: eventIndex * 1000,
          eventIndex,
          skillSlot,
        })),
      }),
      itemCatalog: catalog,
    });
    const maxOrder = rows.find((row) => row.category === 'SKILL_PRIORITY');
    const sequence = rows.find((row) => row.category === 'SKILL_SEQUENCE');
    expect(maxOrder?.signature).toBe('W>E>Q');
    expect(sequence?.signature.startsWith('E-W-Q')).toBe(true);
    expect(maxOrder?.signature).not.toBe('E>W>Q');
  });

  it('emits complete Q>W>E priority from Q4 W3 E1 without requiring rank 5', () => {
    const rows = deriveParticipantBuildContributions({
      source: source({
        skillOrder: [1, 2, 3, 1, 1, 1, 2, 2],
        timelineEvents: [],
      }),
      itemCatalog: catalog,
    });
    expect(rows.find((row) => row.category === 'SKILL_PRIORITY')?.signature).toBe('Q>W>E');
  });

  it('omits purchase-order categories when timeline is missing but keeps final-state boots', () => {
    const rows = deriveParticipantBuildContributions({
      source: source({ timelineEvents: [], skillOrder: [1, 3, 2] }),
      itemCatalog: catalog,
    });
    const categories = new Set(rows.map((row) => row.category));
    expect(categories.has('STARTING_ITEMS')).toBe(false);
    expect(categories.has('CORE_BUILD')).toBe(false);
    expect(categories.has('BOOTS')).toBe(true);
    expect(categories.has('SUMMONER_SPELLS')).toBe(true);
    expect(categories.has('SKILL_SEQUENCE')).toBe(true);
    expect(categories.has('SKILL_PRIORITY')).toBe(false);
  });

  it('does not emit CORE_BUILD when only one completed major exists', () => {
    const rows = deriveParticipantBuildContributions({
      source: source({
        timelineEvents: [
          {
            type: 'ITEM_PURCHASED',
            timestampMs: 200_000,
            eventIndex: 0,
            participantId: 1,
            itemId: 3031,
          },
        ],
      }),
      itemCatalog: catalog,
    });
    expect(rows.some((row) => row.category === 'CORE_BUILD')).toBe(false);
  });

  it('emits only the first three completed majors when four exist', () => {
    const rows = deriveParticipantBuildContributions({
      source: source({
        timelineEvents: [
          {
            type: 'ITEM_PURCHASED',
            timestampMs: 200_000,
            eventIndex: 0,
            participantId: 1,
            itemId: 3031,
          },
          {
            type: 'ITEM_PURCHASED',
            timestampMs: 400_000,
            eventIndex: 1,
            participantId: 1,
            itemId: 3089,
          },
          {
            type: 'ITEM_PURCHASED',
            timestampMs: 600_000,
            eventIndex: 2,
            participantId: 1,
            itemId: 3135,
          },
          {
            type: 'ITEM_PURCHASED',
            timestampMs: 800_000,
            eventIndex: 3,
            participantId: 1,
            itemId: 3031,
          },
        ],
      }),
      itemCatalog: catalog,
    });
    expect(rows.find((row) => row.category === 'CORE_BUILD')?.entityIds).toEqual([
      3031, 3089, 3135,
    ]);
  });

  it('does not emit CORE_BUILD when only two completed majors exist', () => {
    const rows = deriveParticipantBuildContributions({
      source: source({
        timelineEvents: [
          {
            type: 'ITEM_PURCHASED',
            timestampMs: 200_000,
            eventIndex: 0,
            participantId: 1,
            itemId: 3031,
          },
          {
            type: 'ITEM_PURCHASED',
            timestampMs: 400_000,
            eventIndex: 1,
            participantId: 1,
            itemId: 3089,
          },
        ],
      }),
      itemCatalog: catalog,
    });
    expect(rows.some((row) => row.category === 'CORE_BUILD')).toBe(false);
  });

  it('does not emit SKILL_PRIORITY when SKILL_LEVEL_UP events are missing', () => {
    const rows = deriveParticipantBuildContributions({
      source: source({ skillOrder: [], timelineEvents: [] }),
      itemCatalog: catalog,
    });
    expect(rows.some((row) => row.category === 'SKILL_PRIORITY')).toBe(false);
    expect(rows.some((row) => row.category === 'SKILL_SEQUENCE')).toBe(false);
  });

  it('does not emit partial Q or Q>W skill-priority signatures', () => {
    const rows = deriveParticipantBuildContributions({
      source: source({ skillOrder: [1, 1, 1, 1, 1], timelineEvents: [] }),
      itemCatalog: catalog,
    });
    const priority = rows.find((row) => row.category === 'SKILL_PRIORITY');
    expect(priority).toBeUndefined();
  });

  it('ignores malformed skill slots instead of inventing a priority', () => {
    const rows = deriveParticipantBuildContributions({
      source: source({ skillOrder: [0, 9, 4, 4], timelineEvents: [] }),
      itemCatalog: catalog,
    });
    expect(rows.some((row) => row.category === 'SKILL_PRIORITY')).toBe(false);
  });

  it('canonicalizes summoner spell order', () => {
    const rows = deriveParticipantBuildContributions({ source: source(), itemCatalog: catalog });
    const spells = rows.find((row) => row.category === 'SUMMONER_SPELLS');
    expect(spells?.signature).toBe('4-12');
    expect(spells?.entityIds).toEqual([4, 12]);
  });
});
