import { Inject, Injectable } from '@nestjs/common';
import {
  CHAMPION_STATS_DISCLAIMER,
  ChampionBuildsResponseSchema,
  RANK_TIER_SEMANTICS,
  exactTiersForRankScope,
  legacyTierFilterToRankScope,
  serializeRankScopeCacheToken,
  type ChampionBuildsQuery,
  type ChampionBuildsResponse,
  type ChampionStatsGenerationScope,
  type ChampionStatsTierFilter,
  type PlatformRoute,
} from '@league-helper/shared';
import {
  CHAMPION_STATS_CONFIG,
  type ChampionStatsConfig,
} from '../../config/champion-stats.config';
import { DataDragonChampionService } from '../../integrations/data-dragon/data-dragon-champion.service';
import { ChampionAggregateReadRepository } from '../../persistence/champion-aggregate-read.repository';
import {
  ChampionBuildReadRepository,
  mergeBuildRowsBySignature,
} from '../../persistence/champion-build-read.repository';
import { ChampionStaticRepository } from '../../persistence/champion-static.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { ChampionStatsCacheService } from './champion-stats-cache.service';
import { resolveSharedFilters } from './champion-stats-filters';
import { ChampionStaticService } from './champion-static.service';
import {
  eligibleGamesFor,
  mapBoots,
  mapCoreBuilds,
  mapRunes,
  mapSkillOrder,
  mapSpells,
  mapStartingSets,
  type BuildIconBuilders,
  type BuildStaticLookups,
} from './champion-builds.mapper';

const TOP_N = 8;

@Injectable()
export class ChampionBuildsService {
  constructor(
    @Inject(CHAMPION_STATS_CONFIG) private readonly config: ChampionStatsConfig,
    @Inject(ChampionStaticService) private readonly championStatic: ChampionStaticService,
    @Inject(ChampionStaticRepository) private readonly staticRepo: ChampionStaticRepository,
    @Inject(ChampionAggregateReadRepository)
    private readonly aggregates: ChampionAggregateReadRepository,
    @Inject(ChampionBuildReadRepository) private readonly builds: ChampionBuildReadRepository,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(DataDragonChampionService) private readonly media: DataDragonChampionService,
    @Inject(ChampionStatsCacheService) private readonly cache: ChampionStatsCacheService,
  ) {}

  async getBuilds(
    championKey: string,
    query: ChampionBuildsQuery,
  ): Promise<ChampionBuildsResponse> {
    const staticRow = await this.championStatic.requireByKey(championKey);
    const shared = resolveSharedFilters(this.config, query);
    const rankScope = legacyTierFilterToRankScope(shared.tier);

    const resolvedPatch = await this.aggregates.resolveLatestSemanticPatch({
      platform: shared.platform,
      queueId: shared.queueId,
      versions: {
        sourceNormalizationVersion: this.config.sourceNormalizationVersion,
        aggregationVersion: this.config.aggregationVersion,
      },
    });
    const patch = query.patch?.trim() || resolvedPatch;
    if (!patch) {
      return this.emptyResponse({
        platform: shared.platform,
        patch: query.patch ?? 'unavailable',
        queueId: shared.queueId,
        tier: shared.tier,
        position: query.position,
        emptyReason: 'CHAMPION_HAS_NO_BUILDS',
      });
    }

    if (rankScope.kind === 'UNKNOWN') {
      return this.emptyResponse({
        platform: shared.platform,
        patch,
        queueId: shared.queueId,
        tier: shared.tier,
        position: query.position,
        emptyReason: 'UNKNOWN_RANK_HIDDEN',
      });
    }

    const scope = this.buildScope(shared.platform, patch, shared.queueId);
    const generation = await this.cache.getBuildGeneration(scope);
    const rankScopeToken = serializeRankScopeCacheToken(rankScope);
    const cacheKey = this.cache.buildsKey({
      scope,
      generation,
      championKey: staticRow.championKey,
      position: query.position,
      rankScopeToken,
    });
    const cached = await this.cache.getParsed(cacheKey, ChampionBuildsResponseSchema);
    if (cached) {
      return cached;
    }

    const rankTiers = rankScope.kind === 'ALL' ? ['ALL'] : [...exactTiersForRankScope(rankScope)];

    const rows = await this.builds.findByCategories({
      championId: staticRow.championId,
      patch,
      platformRoute: shared.platform,
      queueId: shared.queueId,
      position: query.position,
      rankTiers,
      sourceNormalizationVersion: this.config.sourceNormalizationVersion,
      aggregationVersion: this.config.buildAggregationVersion,
    });

    const lookups = await this.loadLookups(patch);
    const icons: BuildIconBuilders = {
      itemIcon: (itemId, version) => this.media.buildItemIconUrl(itemId, version),
      runeIcon: (iconPath) => this.media.buildRuneIconUrl(iconPath),
      spellIcon: (imageFull, version) => this.media.buildSummonerSpellIconUrl(imageFull, version),
    };

    const starting = mergeBuildRowsBySignature(rows, 'STARTING_ITEMS').slice(0, TOP_N);
    const core = mergeBuildRowsBySignature(rows, 'CORE_BUILD').slice(0, TOP_N);
    const boots = mergeBuildRowsBySignature(rows, 'BOOTS').slice(0, TOP_N);
    const runes = mergeBuildRowsBySignature(rows, 'RUNES').slice(0, TOP_N);
    const spells = mergeBuildRowsBySignature(rows, 'SUMMONER_SPELLS').slice(0, TOP_N);
    const maxOrder = mergeBuildRowsBySignature(rows, 'SKILL_PRIORITY').slice(0, TOP_N);
    const levelSequence = mergeBuildRowsBySignature(rows, 'SKILL_SEQUENCE').slice(0, 1);

    const hasAny =
      starting.length +
        core.length +
        boots.length +
        runes.length +
        spells.length +
        maxOrder.length >
      0;

    const response = ChampionBuildsResponseSchema.parse({
      disclaimer: CHAMPION_STATS_DISCLAIMER,
      rankTierSemantics: RANK_TIER_SEMANTICS,
      sampleScope: {
        kind: 'COLLECTED_SAMPLE',
        platform: shared.platform,
        patch,
        queueId: shared.queueId,
      },
      resolvedFilters: {
        platform: shared.platform,
        patch,
        queueId: shared.queueId,
        tier: shared.tier,
        position: query.position,
      },
      emptyReason: hasAny ? null : 'CHAMPION_HAS_NO_BUILDS',
      eligibility: {
        startingItemsEligibleGames: eligibleGamesFor(starting),
        coreBuildsEligibleGames: eligibleGamesFor(core),
        bootsEligibleGames: eligibleGamesFor(boots),
        runesEligibleGames: eligibleGamesFor(runes),
        summonerSpellsEligibleGames: eligibleGamesFor(spells),
        skillOrderEligibleGames: eligibleGamesFor(maxOrder),
      },
      startingItems: mapStartingSets(starting, lookups, icons),
      coreBuilds: mapCoreBuilds(core, lookups, icons),
      boots: mapBoots(boots, lookups, icons),
      runes: mapRunes(runes, lookups, icons),
      summonerSpells: mapSpells(spells, lookups, icons),
      skillOrder: mapSkillOrder(maxOrder, levelSequence),
    });

    await this.cache.setIfBuildGenerationCurrent({
      scope,
      expectedGeneration: generation,
      buildKey: (gen) =>
        this.cache.buildsKey({
          scope,
          generation: gen,
          championKey: staticRow.championKey,
          position: query.position,
          rankScopeToken,
        }),
      value: response,
    });

    return response;
  }

  private buildScope(
    platform: PlatformRoute,
    patch: string,
    queueId: number,
  ): ChampionStatsGenerationScope {
    return {
      sourceNormalizationVersion: this.config.sourceNormalizationVersion,
      aggregationVersion: this.config.buildAggregationVersion,
      platform,
      patch,
      queueId,
    };
  }

  private emptyResponse(input: {
    platform: PlatformRoute;
    patch: string;
    queueId: number;
    tier: ChampionStatsTierFilter;
    position: ChampionBuildsQuery['position'];
    emptyReason: ChampionBuildsResponse['emptyReason'];
  }): ChampionBuildsResponse {
    return ChampionBuildsResponseSchema.parse({
      disclaimer: CHAMPION_STATS_DISCLAIMER,
      rankTierSemantics: RANK_TIER_SEMANTICS,
      sampleScope: {
        kind: 'COLLECTED_SAMPLE',
        platform: input.platform,
        patch: input.patch,
        queueId: input.queueId,
      },
      resolvedFilters: {
        platform: input.platform,
        patch: input.patch,
        queueId: input.queueId,
        tier: input.tier,
        position: input.position,
      },
      emptyReason: input.emptyReason,
      eligibility: {
        startingItemsEligibleGames: 0,
        coreBuildsEligibleGames: 0,
        bootsEligibleGames: 0,
        runesEligibleGames: 0,
        summonerSpellsEligibleGames: 0,
        skillOrderEligibleGames: 0,
      },
      startingItems: [],
      coreBuilds: [],
      boots: [],
      runes: [],
      summonerSpells: [],
      skillOrder: [],
    });
  }

  private async loadLookups(patch: string): Promise<BuildStaticLookups> {
    const patchRow = await this.prisma.patch.findFirst({
      where: { normalizedMajorMinor: patch },
      orderBy: { version: 'desc' },
    });
    const fallback = patchRow ?? (await this.staticRepo.resolveStaticPatch());
    if (!fallback) {
      return {
        dataDragonVersion: null,
        items: new Map(),
        runes: new Map(),
        spells: new Map(),
        styleNames: new Map(),
      };
    }

    const [items, runes, spells] = await Promise.all([
      this.prisma.itemStaticData.findMany({
        where: { patchId: fallback.id },
        select: { itemId: true, name: true },
      }),
      this.prisma.runeStaticData.findMany({
        where: { patchId: fallback.id },
        select: { runeId: true, name: true, icon: true, treeId: true, treeName: true },
      }),
      this.prisma.summonerSpellStaticData.findMany({
        where: { patchId: fallback.id },
        select: { spellId: true, name: true, imageData: true },
      }),
    ]);

    const styleNames = new Map<number, string>();
    for (const rune of runes) {
      if (rune.treeId && rune.treeName && !styleNames.has(rune.treeId)) {
        styleNames.set(rune.treeId, rune.treeName);
      }
    }

    return {
      dataDragonVersion: fallback.dataDragonVersion,
      items: new Map(items.map((row) => [row.itemId, { name: row.name }])),
      runes: new Map(
        runes.map((row) => [
          row.runeId,
          { name: row.name, icon: row.icon, treeId: row.treeId, treeName: row.treeName },
        ]),
      ),
      spells: new Map(
        spells.map((row) => [
          row.spellId,
          {
            name: row.name,
            imageFull: imageFullFromJson(row.imageData),
          },
        ]),
      ),
      styleNames,
    };
  }
}

function imageFullFromJson(imageData: unknown): string | null {
  if (!imageData || typeof imageData !== 'object') {
    return null;
  }
  const full = (imageData as { full?: unknown }).full;
  return typeof full === 'string' && full.length > 0 ? full : null;
}
