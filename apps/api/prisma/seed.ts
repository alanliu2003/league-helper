import {
  IngestionJobStatus,
  MatchIngestionStatus,
  PrismaClient,
  StaticDataStatus,
  TimelineFetchStatus,
} from '@prisma/client';

const prisma = new PrismaClient();

const SEED_PUUID = 'seed-fake-puuid-00000000-0000-4000-8000-000000000001';
const SEED_MATCH_ID = 'SEED_NA1_0000000001';
const SEED_PATCH_VERSION = '14.1.1.seed';

const AHRI_SEED_PASSIVE = {
  name: 'Essence Theft',
  description:
    "Whenever Ahri hits a champion with a spell, she gains a stack of Essence Theft. At 9 stacks, Ahri's next spell that hits an enemy champion heals her.",
  imageFull: 'Ahri_SoulEater2.png',
};

const AHRI_SEED_SPELLS = [
  {
    name: 'Orb of Deception',
    description:
      'Ahri sends out and pulls back her orb, dealing magic damage on the way out and true damage on the way back.',
    imageFull: 'AhriQ.png',
    cooldownBurn: '7',
    costBurn: '55/65/75/85/95',
    rangeBurn: '900',
  },
  {
    name: 'Fox-Fire',
    description: 'Ahri releases fox-fires that seek and damage nearby enemies.',
    imageFull: 'AhriW.png',
    cooldownBurn: '9/8/7/6/5',
    costBurn: '30',
    rangeBurn: '700',
  },
  {
    name: 'Charm',
    description: 'Ahri blows a kiss that damages and charms the first enemy hit.',
    imageFull: 'AhriE.png',
    cooldownBurn: '12',
    costBurn: '60',
    rangeBurn: '1000',
  },
  {
    name: 'Spirit Rush',
    description: 'Ahri dashes forward and fires essence bolts at nearby enemies.',
    imageFull: 'AhriR.png',
    cooldownBurn: '130/105/80',
    costBurn: '100',
    rangeBurn: '500',
  },
];

async function main(): Promise<void> {
  const patch = await prisma.patch.upsert({
    where: { version: SEED_PATCH_VERSION },
    update: {
      normalizedMajorMinor: '14.1',
      isActive: true,
      staticDataStatus: StaticDataStatus.READY,
      dataDragonVersion: '14.1.1',
    },
    create: {
      version: SEED_PATCH_VERSION,
      normalizedMajorMinor: '14.1',
      isActive: true,
      staticDataStatus: StaticDataStatus.READY,
      dataDragonVersion: '14.1.1',
      releaseDate: new Date('2024-01-10T00:00:00.000Z'),
    },
  });

  const champions = [
    {
      championId: 1,
      championKey: 'Annie',
      name: 'Annie',
      title: 'the Dark Child',
      tags: ['Mage'],
    },
    {
      championId: 103,
      championKey: 'Ahri',
      name: 'Ahri',
      title: 'the Nine-Tailed Fox',
      tags: ['Mage', 'Assassin'],
    },
    {
      championId: 157,
      championKey: 'Yasuo',
      name: 'Yasuo',
      title: 'the Unforgiven',
      tags: ['Fighter', 'Assassin'],
    },
    {
      championId: 222,
      championKey: 'Jinx',
      name: 'Jinx',
      title: 'the Loose Cannon',
      tags: ['Marksman'],
    },
    {
      championId: 64,
      championKey: 'LeeSin',
      name: 'Lee Sin',
      title: 'the Blind Monk',
      tags: ['Fighter', 'Assassin'],
    },
    {
      championId: 53,
      championKey: 'Blitzcrank',
      name: 'Blitzcrank',
      title: 'the Great Steam Golem',
      tags: ['Tank', 'Fighter'],
    },
    {
      championId: 86,
      championKey: 'Garen',
      name: 'Garen',
      title: 'The Might of Demacia',
      tags: ['Fighter', 'Tank'],
    },
    {
      championId: 245,
      championKey: 'Ekko',
      name: 'Ekko',
      title: 'the Boy Who Shattered Time',
      tags: ['Assassin', 'Fighter'],
    },
    {
      championId: 235,
      championKey: 'Senna',
      name: 'Senna',
      title: 'the Redeemer',
      tags: ['Marksman', 'Support'],
    },
    {
      championId: 202,
      championKey: 'Jhin',
      name: 'Jhin',
      title: 'the Virtuoso',
      tags: ['Marksman', 'Assassin'],
    },
  ];

  for (const champion of champions) {
    await prisma.championStaticData.upsert({
      where: {
        patchId_championId: { patchId: patch.id, championId: champion.championId },
      },
      update: {
        name: champion.name,
        title: champion.title,
        championKey: champion.championKey,
        tags: champion.tags,
        ...(champion.championKey === 'Ahri'
          ? { passive: AHRI_SEED_PASSIVE, spells: AHRI_SEED_SPELLS }
          : { passive: {}, spells: [] }),
      },
      create: {
        patchId: patch.id,
        championId: champion.championId,
        championKey: champion.championKey,
        name: champion.name,
        title: champion.title,
        tags: champion.tags,
        baseStats: { hp: 500 },
        passive: champion.championKey === 'Ahri' ? AHRI_SEED_PASSIVE : {},
        spells: champion.championKey === 'Ahri' ? AHRI_SEED_SPELLS : [],
        imageData: { full: `${champion.championKey}.png` },
      },
    });
  }

  let account = await prisma.playerAccount.findUnique({
    where: {
      provider_externalAccountId: { provider: 'RIOT', externalAccountId: SEED_PUUID },
    },
  });

  if (!account) {
    const player = await prisma.player.create({ data: {} });
    account = await prisma.playerAccount.create({
      data: {
        playerId: player.id,
        provider: 'RIOT',
        externalAccountId: SEED_PUUID,
        platformRoute: 'na1',
        regionalRoute: 'americas',
        currentGameName: 'SeedPlayer',
        currentTagLine: 'NA1',
        normalizedGameName: 'seedplayer',
        normalizedTagLine: 'na1',
        profileIconId: 1,
        summonerLevel: 30,
        lastResolvedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
  } else {
    account = await prisma.playerAccount.update({
      where: { id: account.id },
      data: {
        currentGameName: 'SeedPlayer',
        currentTagLine: 'NA1',
        normalizedGameName: 'seedplayer',
        normalizedTagLine: 'na1',
        lastResolvedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
  }

  await prisma.playerAccountAlias.updateMany({
    where: { playerAccountId: account.id, isCurrent: true },
    data: { isCurrent: false },
  });

  const currentAlias = await prisma.playerAccountAlias.findFirst({
    where: {
      playerAccountId: account.id,
      normalizedGameName: 'seedplayer',
      normalizedTagLine: 'na1',
    },
  });

  if (currentAlias) {
    await prisma.playerAccountAlias.update({
      where: { id: currentAlias.id },
      data: {
        isCurrent: true,
        lastSeenAt: new Date('2026-01-02T00:00:00.000Z'),
        gameName: 'SeedPlayer',
        tagLine: 'NA1',
      },
    });
  } else {
    await prisma.playerAccountAlias.create({
      data: {
        playerAccountId: account.id,
        gameName: 'OldSeedName',
        tagLine: 'NA1',
        normalizedGameName: 'oldseedname',
        normalizedTagLine: 'na1',
        firstSeenAt: new Date('2025-01-01T00:00:00.000Z'),
        lastSeenAt: new Date('2025-06-01T00:00:00.000Z'),
        isCurrent: false,
      },
    });
    await prisma.playerAccountAlias.create({
      data: {
        playerAccountId: account.id,
        gameName: 'SeedPlayer',
        tagLine: 'NA1',
        normalizedGameName: 'seedplayer',
        normalizedTagLine: 'na1',
        firstSeenAt: new Date('2025-06-02T00:00:00.000Z'),
        lastSeenAt: new Date('2026-01-02T00:00:00.000Z'),
        isCurrent: true,
      },
    });
  }

  const rankCount = await prisma.rankSnapshot.count({
    where: { playerAccountId: account.id, queueType: 'RANKED_SOLO_5x5' },
  });
  if (rankCount === 0) {
    await prisma.rankSnapshot.createMany({
      data: [
        {
          playerAccountId: account.id,
          queueType: 'RANKED_SOLO_5x5',
          tier: 'GOLD',
          division: 'II',
          leaguePoints: 50,
          wins: 20,
          losses: 18,
          capturedAt: new Date('2025-12-01T00:00:00.000Z'),
        },
        {
          playerAccountId: account.id,
          queueType: 'RANKED_SOLO_5x5',
          tier: 'GOLD',
          division: 'I',
          leaguePoints: 80,
          wins: 28,
          losses: 22,
          capturedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
    });
  }

  let match = await prisma.match.findUnique({
    where: {
      provider_externalMatchId: { provider: 'RIOT', externalMatchId: SEED_MATCH_ID },
    },
  });

  if (!match) {
    match = await prisma.match.create({
      data: {
        provider: 'RIOT',
        externalMatchId: SEED_MATCH_ID,
        platformRoute: 'na1',
        regionalRoute: 'americas',
        gameId: BigInt(1000000001),
        queueId: 420,
        mapId: 11,
        gameMode: 'CLASSIC',
        gameType: 'MATCHED_GAME',
        gameCreation: new Date('2026-01-03T12:00:00.000Z'),
        gameEndTimestamp: new Date('2026-01-03T12:30:00.000Z'),
        gameDurationSeconds: 1800,
        gameVersion: '14.1.1.4411682',
        normalizedPatch: '14.1',
        remake: false,
        earlySurrender: false,
        ingestionStatus: MatchIngestionStatus.COMPLETED,
        normalizationVersion: '1',
        rawPayload: { seed: true },
        ingestedAt: new Date('2026-01-03T13:00:00.000Z'),
        teams: {
          create: [
            {
              teamId: 100,
              win: true,
              earlySurrender: false,
              bans: [1, 2, 3, 4, 5],
              objectives: { baron: { kills: 1 } },
            },
            {
              teamId: 200,
              win: false,
              earlySurrender: false,
              bans: [6, 7, 8, 9, 10],
              objectives: { baron: { kills: 0 } },
            },
          ],
        },
        participants: {
          create: Array.from({ length: 10 }, (_, index) => {
            const participantId = index;
            const teamId = index < 5 ? 100 : 200;
            return {
              participantId,
              playerAccountId: participantId === 0 ? account!.id : null,
              externalAccountId:
                participantId === 0 ? SEED_PUUID : `seed-fake-puuid-participant-${participantId}`,
              riotIdGameName: participantId === 0 ? 'SeedPlayer' : `SeedP${participantId}`,
              riotIdTagLine: 'NA1',
              championId: [157, 103, 1, 22, 51, 64, 222, 235, 12, 89][index] ?? 1,
              championName: 'SeedChamp',
              teamId,
              teamPosition: ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'][index % 5] ?? 'NONE',
              individualPosition:
                ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'][index % 5] ?? 'NONE',
              win: teamId === 100,
              kills: index,
              deaths: 1,
              assists: 2,
              totalCs: 150 + index,
              goldEarned: 10000 + index * 100,
              visionScore: 20 + index,
              itemIds: [3006, 3031, 0, 0, 0, 0, 0],
              perkIds: [8005, 8009],
              summonerSpell1Id: 4,
              summonerSpell2Id: 14,
            };
          }),
        },
        timeline: {
          create: {
            fetchStatus: TimelineFetchStatus.FETCHED,
            rawPayload: { frames: [] },
            timelineSchemaVersion: '1',
            fetchedAt: new Date('2026-01-03T13:05:00.000Z'),
          },
        },
      },
    });
  }

  const masteryCount = await prisma.championMasterySnapshot.count({
    where: { playerAccountId: account.id, championId: 157 },
  });
  if (masteryCount === 0) {
    await prisma.championMasterySnapshot.create({
      data: {
        playerAccountId: account.id,
        championId: 157,
        championLevel: 7,
        championPoints: 123456,
        lastPlayTime: new Date('2026-01-03T12:00:00.000Z'),
        chestGranted: true,
        tokensEarned: 2,
        capturedAt: new Date('2026-01-03T14:00:00.000Z'),
      },
    });
  }

  await prisma.ingestionJobRecord.upsert({
    where: {
      jobType_idempotencyKey: {
        jobType: 'seed.match.ingest',
        idempotencyKey: `seed:${SEED_MATCH_ID}`,
      },
    },
    update: {
      status: IngestionJobStatus.COMPLETED,
      completedAt: new Date('2026-01-03T13:00:00.000Z'),
    },
    create: {
      jobType: 'seed.match.ingest',
      idempotencyKey: `seed:${SEED_MATCH_ID}`,
      provider: 'RIOT',
      externalResourceId: SEED_MATCH_ID,
      status: IngestionJobStatus.COMPLETED,
      priority: 0,
      attemptCount: 1,
      maxAttempts: 5,
      completedAt: new Date('2026-01-03T13:00:00.000Z'),
      metadata: { seed: true },
    },
  });

  // Touch match so re-seeds are clearly idempotent.
  await prisma.match.update({
    where: { id: match.id },
    data: { normalizationVersion: '1' },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
