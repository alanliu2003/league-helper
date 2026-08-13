import { describe, expect, it } from 'vitest';
import { classifyItem, type ItemStaticClassificationInput } from './item-classification';

function item(
  overrides: Partial<ItemStaticClassificationInput> & Pick<ItemStaticClassificationInput, 'itemId'>,
): ItemStaticClassificationInput {
  return {
    tags: [],
    goldTotal: 0,
    purchasable: true,
    fromItemIds: [],
    intoItemIds: [],
    consumed: false,
    ...overrides,
  };
}

describe('classifyItem', () => {
  it('classifies boots from the Boots tag', () => {
    expect(classifyItem(item({ itemId: 3006, tags: ['Boots'], goldTotal: 1100 }))).toBe('BOOTS');
  });

  it('classifies trinkets from the Trinket tag', () => {
    expect(classifyItem(item({ itemId: 3340, tags: ['Trinket'], goldTotal: 0 }))).toBe('TRINKET');
  });

  it('classifies consumables from tag or consumed flag', () => {
    expect(classifyItem(item({ itemId: 2003, tags: ['Consumable'], goldTotal: 50 }))).toBe(
      'CONSUMABLE',
    );
    expect(classifyItem(item({ itemId: 2055, consumed: true, goldTotal: 75 }))).toBe('CONSUMABLE');
  });

  it('classifies completed major items vs components', () => {
    expect(
      classifyItem(
        item({
          itemId: 3031,
          goldTotal: 3600,
          fromItemIds: [1038, 1037],
          intoItemIds: [],
        }),
      ),
    ).toBe('COMPLETED_MAJOR');

    expect(
      classifyItem(
        item({
          itemId: 1038,
          goldTotal: 1300,
          fromItemIds: [],
          intoItemIds: [3031],
        }),
      ),
    ).toBe('COMPONENT');
  });

  it('does not treat a completed item with an Ornn into-target as a component', () => {
    expect(
      classifyItem(
        item({
          itemId: 3031,
          goldTotal: 3600,
          fromItemIds: [1038],
          intoItemIds: [7031],
        }),
      ),
    ).toBe('COMPLETED_MAJOR');
  });

  it('classifies starter Lane/Jungle items without a recipe as OTHER', () => {
    expect(
      classifyItem(item({ itemId: 1056, tags: ['Lane'], goldTotal: 400 })),
    ).toBe('OTHER');
    expect(
      classifyItem(item({ itemId: 1103, tags: ['Jungle'], goldTotal: 450 })),
    ).toBe('OTHER');
  });

  it('classifies elixirs as consumables', () => {
    expect(
      classifyItem(item({ itemId: 2138, tags: ['Consumable'], goldTotal: 500, consumed: true })),
    ).toBe('CONSUMABLE');
  });
});
