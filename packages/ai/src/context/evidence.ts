import type {
  ChampionInsightAbility,
  ChampionInsightContext,
  ChampionInsightEvidenceEntry,
  ChampionInsightMatchupRow,
  ChampionInsightPerformance,
} from './types';

function entry(id: string, interpretationAllowed: boolean): ChampionInsightEvidenceEntry {
  return { id, interpretationAllowed };
}

export function buildEvidenceCatalog(args: {
  performance: ChampionInsightPerformance;
  hasPerformanceMetrics: boolean;
  builds: ChampionInsightContext['builds'];
  matchups: ChampionInsightContext['matchups'];
  abilities: ChampionInsightAbility[];
  opponentAbilities: ChampionInsightContext['opponentAbilities'];
}): ChampionInsightEvidenceEntry[] {
  const catalog: ChampionInsightEvidenceEntry[] = [
    entry('SCOPE_PATCH', true),
    entry('SCOPE_POSITION', true),
    entry('SCOPE_RANK', true),
    entry('CONFIDENCE_WARNING', true),
  ];

  if (args.hasPerformanceMetrics) {
    const allowed = args.performance.interpretationAllowed;
    catalog.push(
      entry('CHAMPION_WIN_RATE', allowed),
      entry('CHAMPION_SAMPLE_SIZE', allowed),
      entry('CHAMPION_SAMPLE_CONFIDENCE', allowed),
    );
    if (args.performance.wilsonInterval) {
      catalog.push(entry('CHAMPION_WILSON_INTERVAL', allowed));
    }
    if (args.performance.aggregateKdaRatio !== undefined) {
      catalog.push(entry('CHAMPION_KDA', allowed));
    }
    if (args.performance.averageCsPerMinute !== undefined) {
      catalog.push(entry('CHAMPION_CS_PER_MIN', allowed));
    }
    if (args.performance.averageDamagePerMinute !== undefined) {
      catalog.push(entry('CHAMPION_DPM', allowed));
    }
  }

  if (args.builds.coreBuilds[0]) {
    catalog.push(entry('BUILD_CORE_PRIMARY', args.builds.coreBuilds[0].interpretationAllowed));
  }
  if (args.builds.coreBuilds[1]) {
    catalog.push(entry('BUILD_CORE_SECONDARY', args.builds.coreBuilds[1].interpretationAllowed));
  }
  if (args.builds.startingItems[0]) {
    catalog.push(entry('BUILD_STARTING_PRIMARY', args.builds.startingItems[0].interpretationAllowed));
  }
  if (args.builds.boots[0]) {
    catalog.push(entry('BUILD_BOOTS_PRIMARY', args.builds.boots[0].interpretationAllowed));
  }
  if (args.builds.runes[0]) {
    catalog.push(entry('RUNE_PAGE_PRIMARY', args.builds.runes[0].interpretationAllowed));
  }
  if (args.builds.summonerSpells[0]) {
    catalog.push(entry('SPELL_PAIR_PRIMARY', args.builds.summonerSpells[0].interpretationAllowed));
  }
  if (args.builds.skillOrder[0]) {
    catalog.push(entry('SKILL_ORDER_PRIMARY', args.builds.skillOrder[0].interpretationAllowed));
  }

  const pushMatchups = (rows: ChampionInsightMatchupRow[], side: 'STRONG' | 'WEAK') => {
    for (const row of rows) {
      catalog.push(entry(`MATCHUP_${side}_${row.opponentChampionKey}`, row.interpretationAllowed));
    }
  };
  pushMatchups(args.matchups.strongAgainst, 'STRONG');
  pushMatchups(args.matchups.weakAgainst, 'WEAK');

  const pushAbilities = (abilities: ChampionInsightAbility[]) => {
    for (const ability of abilities) {
      catalog.push(entry(`ABILITY_${ability.championKey}_${ability.slot}`, true));
    }
  };
  pushAbilities(args.abilities);
  for (const group of args.opponentAbilities) {
    pushAbilities(group.abilities);
  }

  return catalog;
}

export function listEvidenceIds(context: ChampionInsightContext): string[] {
  return context.evidenceCatalog.map((item) => item.id);
}
