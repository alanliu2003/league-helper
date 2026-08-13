import { assessBuildSourceEligibility, type BuildParticipantSource } from './eligibility';
import { classifyItem, type ItemStaticClassificationInput } from './item-classification';
import {
  CORE_BUILD_MAX_ITEMS,
  deriveBootsItemId,
  deriveCoreBuildItemIds,
  coreBuildSignature,
} from './item-builds';
import { toItemTimelineEvents } from './item-reconstruction';
import { deriveRunePage } from './rune-page';
import { deriveSkillPriority, deriveSkillSequence, resolveSkillLevelSlots } from './skill-order';
import { canonicalizeSummonerSpellPair } from './spell-pair';
import { deriveStartingItemIds, startingItemsSignature } from './starting-items';
import type { ChampionBuildCategory } from './categories';

export type BuildContribution = {
  category: ChampionBuildCategory;
  signature: string;
  entityIds: number[];
  auxIds: number[];
  primaryStyleId: number | null;
  secondaryStyleId: number | null;
};

export function deriveParticipantBuildContributions(input: {
  source: BuildParticipantSource;
  itemCatalog: Map<number, ItemStaticClassificationInput>;
}): BuildContribution[] {
  const eligibility = assessBuildSourceEligibility(input.source);
  const events = toItemTimelineEvents(input.source.timelineEvents);
  const rows: BuildContribution[] = [];
  const canClassifyItems = input.itemCatalog.size > 0;

  if (canClassifyItems && eligibility.itemTimelineEligible) {
    const starting = deriveStartingItemIds(events, input.itemCatalog);
    if (starting.length > 0) {
      rows.push({
        category: 'STARTING_ITEMS',
        signature: startingItemsSignature(starting),
        entityIds: starting,
        auxIds: [],
        primaryStyleId: null,
        secondaryStyleId: null,
      });
    }

    const core = deriveCoreBuildItemIds(events, input.itemCatalog);
    if (core.length === CORE_BUILD_MAX_ITEMS) {
      rows.push({
        category: 'CORE_BUILD',
        signature: coreBuildSignature(core),
        entityIds: core,
        auxIds: [],
        primaryStyleId: null,
        secondaryStyleId: null,
      });
    }
  }

  if (canClassifyItems && eligibility.itemFinalStateEligible) {
    const bootsId = deriveBootsItemId(input.source.itemIds, input.itemCatalog);
    if (bootsId !== null) {
      rows.push({
        category: 'BOOTS',
        signature: String(bootsId),
        entityIds: [bootsId],
        auxIds: [],
        primaryStyleId: null,
        secondaryStyleId: null,
      });
    }
  }

  if (eligibility.runeEligible) {
    const page = deriveRunePage({
      perkIds: input.source.perkIds,
      statPerkIds: input.source.statPerkIds,
      primaryPerkStyleId: input.source.primaryPerkStyleId,
      secondaryPerkStyleId: input.source.secondaryPerkStyleId,
    });
    if (page) {
      rows.push({
        category: 'RUNES',
        signature: page.signature,
        entityIds: [...page.primaryPerkIds, ...page.secondaryPerkIds],
        auxIds: page.statPerkIds,
        primaryStyleId: page.primaryPerkStyleId,
        secondaryStyleId: page.secondaryPerkStyleId,
      });
    }
  }

  if (eligibility.spellEligible) {
    const pair = canonicalizeSummonerSpellPair(
      input.source.summonerSpell1Id,
      input.source.summonerSpell2Id,
    );
    rows.push({
      category: 'SUMMONER_SPELLS',
      signature: pair.signature,
      entityIds: [pair.spell1Id, pair.spell2Id],
      auxIds: [],
      primaryStyleId: null,
      secondaryStyleId: null,
    });
  }

  if (eligibility.skillSequenceEligible) {
    const slots = resolveSkillLevelSlots(input.source);
    const sequence = deriveSkillSequence(slots);
    if (sequence.keys.length > 0) {
      rows.push({
        category: 'SKILL_SEQUENCE',
        signature: sequence.signature,
        entityIds: sequence.slots,
        auxIds: [],
        primaryStyleId: null,
        secondaryStyleId: null,
      });
    }
  }

  if (eligibility.skillPriorityEligible) {
    const slots = resolveSkillLevelSlots(input.source);
    const priority = deriveSkillPriority(slots);
    if (priority) {
      rows.push({
        category: 'SKILL_PRIORITY',
        signature: priority.signature,
        entityIds: priority.keys.map((key) => (key === 'Q' ? 1 : key === 'W' ? 2 : 3)),
        auxIds: [],
        primaryStyleId: null,
        secondaryStyleId: null,
      });
    }
  }

  return rows;
}

export function itemCatalogEntryKind(
  itemId: number,
  catalog: Map<number, ItemStaticClassificationInput>,
) {
  const meta = catalog.get(itemId);
  return meta ? classifyItem(meta) : null;
}
