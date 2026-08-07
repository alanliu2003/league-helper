import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PlayerMatchDiscoveryService } from '../discovery/player-match-discovery.service';
import { loadMatchBootstrapConfig } from './bootstrap-player.config';
import {
  createDiscoveryBootstrapCoreDeps,
  executeBootstrapCli,
  resolveBootstrapPlayers,
} from './bootstrap-player-cli';
import { bootstrapPlayer, type BootstrapCoreDeps } from './bootstrap-player-core';
import { collectStdoutJson } from './cli-output';
import type { EnqueueDiscoveredMatchesDeps } from './enqueue-discovered-matches';

const config = loadMatchBootstrapConfig({});

function makeCoreDeps(resolvePlayer = vi.fn(async (input: { gameName: string }) => ({
  provider: 'RIOT' as const,
  externalAccountId: `id-${input.gameName}`,
  platform: 'na1' as const,
  regionalRoute: 'americas' as const,
  riotId: { gameName: input.gameName, tagLine: 'NA1' },
}))): {
  coreDeps: BootstrapCoreDeps;
  resolvePlayer: ReturnType<typeof vi.fn>;
} {
  const getRecentMatchIds = vi.fn(async () => ['m1']);
  const coreDeps: BootstrapCoreDeps = {
    resolvePlayer,
    getRankedEntries: vi.fn(async () => []),
    getRecentMatchIds,
    upsertPlayerAccount: vi.fn(async () => ({
      id: 'acct',
      playerId: 'player',
      provider: 'RIOT',
      externalAccountId: 'id',
      platformRoute: 'na1',
      regionalRoute: 'americas',
      gameName: 'A',
      tagLine: 'NA1',
      summonerId: null,
      accountId: null,
      profileIconId: null,
      summonerLevel: null,
      lastResolvedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    insertRankIfChanged: vi.fn(async () => null),
    enqueueDiscoveredMatches: vi.fn(async () => ({
      warnings: [],
      enqueuedCount: 1,
      skippedAlreadyCompleteCount: 0,
    })),
    enqueueDeps: {
      matches: {} as never,
      ingestionJobs: {} as never,
      producer: { enqueueMatch: vi.fn(), getJobStates: vi.fn() },
      matchIngestionJobAttempts: 5,
      logger: { log: vi.fn() },
      invalidatePlayerCache: vi.fn(async () => undefined),
    },
    config,
    logger: { log: vi.fn(), warn: vi.fn() },
  };
  return { coreDeps, resolvePlayer };
}

describe('resolveBootstrapPlayers', () => {
  it('validates --file JSON before any Riot calls', async () => {
    const readFile = vi.fn(async () =>
      JSON.stringify([
        { gameName: 'A', tagLine: 'NA1', platform: 'na1' },
        { gameName: 'B', tagLine: 'NA1', platform: 'na1' },
      ]),
    );

    const players = await resolveBootstrapPlayers(
      {
        mode: 'file',
        players: [],
        filePath: 'players.json',
        queueId: 420,
        maxMatches: 10,
        dryRun: true,
        json: false,
        wait: false,
        concurrency: 1,
      },
      config,
      { readFile },
    );

    expect(players).toHaveLength(2);
    expect(readFile).toHaveBeenCalledWith('players.json', 'utf8');
  });

  it('rejects invalid file JSON', async () => {
    await expect(
      resolveBootstrapPlayers(
        {
          mode: 'file',
          players: [],
          filePath: 'bad.json',
          queueId: 420,
          maxMatches: 10,
          dryRun: true,
          json: false,
          wait: false,
          concurrency: 1,
        },
        config,
        { readFile: vi.fn(async () => 'not-json') },
      ),
    ).rejects.toThrow(/Invalid JSON/i);
  });
});

describe('executeBootstrapCli', () => {
  it('writes JSON-only stdout payload and labels dry-run estimate in text mode', async () => {
    const { coreDeps, resolvePlayer } = makeCoreDeps();
    const writeJson = vi.fn();
    const writeText = vi.fn();

    const { report, exitCode } = await executeBootstrapCli({
      argv: [
        '--game-name',
        'A',
        '--tag-line',
        'NA1',
        '--platform',
        'na1',
        '--dry-run',
        '--json',
      ],
      deps: {
        config,
        coreDeps,
        waitDeps: {
          findMatchesByExternalIds: vi.fn(async () => []),
          findDurableJobsByExternalIds: vi.fn(async () => []),
        },
        checkSmoke: vi.fn(async () => ({ ok: false })),
      },
      io: {
        readFile: vi.fn(),
        log: vi.fn(),
        writeJson,
        writeText,
        reportFailure: vi.fn(),
      },
    });

    expect(exitCode).toBe(0);
    expect(writeJson).toHaveBeenCalledTimes(1);
    expect(writeText).not.toHaveBeenCalled();
    const payload = writeJson.mock.calls[0]?.[0];
    const json = collectStdoutJson(payload);
    expect(() => JSON.parse(json)).not.toThrow();
    expect(report.aggregateSmoke?.status).toBe('skipped');
    expect(resolvePlayer).toHaveBeenCalled();

    const textIo = {
      readFile: vi.fn(),
      log: vi.fn(),
      writeJson: vi.fn(),
      writeText: vi.fn(),
      reportFailure: vi.fn(),
    };
    await executeBootstrapCli({
      argv: ['--game-name', 'A', '--tag-line', 'NA1', '--platform', 'na1', '--dry-run'],
      deps: {
        config,
        coreDeps,
        waitDeps: {
          findMatchesByExternalIds: vi.fn(async () => []),
          findDurableJobsByExternalIds: vi.fn(async () => []),
        },
        checkSmoke: vi.fn(async () => ({ ok: false })),
      },
      io: textIo,
    });
    const text = (textIo.writeText.mock.calls[0]?.[0] as string[]).join('\n');
    expect(text).toMatch(/wouldEnqueueEstimate=/);
  });

  it('reads file before resolving Riot and sets exit 1 on player failure', async () => {
    const order: string[] = [];
    const readFile = vi.fn(async () => {
      order.push('read');
      return JSON.stringify([
        { gameName: 'Good', tagLine: 'NA1', platform: 'na1' },
        { gameName: 'Bad', tagLine: 'NA1', platform: 'na1' },
      ]);
    });
    const resolvePlayer = vi.fn(async (input: { gameName: string }) => {
      order.push(`riot:${input.gameName}`);
      if (input.gameName === 'Bad') {
        throw new Error('resolve failed');
      }
      return {
        provider: 'RIOT' as const,
        externalAccountId: `id-${input.gameName}`,
        platform: 'na1' as const,
        regionalRoute: 'americas' as const,
        riotId: { gameName: input.gameName, tagLine: 'NA1' },
      };
    });
    const { coreDeps } = makeCoreDeps(resolvePlayer);

    const { exitCode, report } = await executeBootstrapCli({
      argv: ['--file', 'players.json', '--dry-run', '--json'],
      deps: {
        config,
        coreDeps,
        waitDeps: {
          findMatchesByExternalIds: vi.fn(async () => []),
          findDurableJobsByExternalIds: vi.fn(async () => []),
        },
        checkSmoke: vi.fn(async () => ({ ok: false })),
      },
      io: {
        readFile,
        log: vi.fn(),
        writeJson: vi.fn(),
        writeText: vi.fn(),
        reportFailure: vi.fn(),
      },
    });

    expect(order[0]).toBe('read');
    expect(order.slice(1)).toEqual(expect.arrayContaining(['riot:Good', 'riot:Bad']));
    expect(exitCode).toBe(1);
    expect(report.ok).toBe(false);
  });

  it('treats wait timeout as exit 0 with inconclusive smoke', async () => {
    const { coreDeps } = makeCoreDeps();
    const { exitCode, report } = await executeBootstrapCli({
      argv: [
        '--game-name',
        'A',
        '--tag-line',
        'NA1',
        '--platform',
        'na1',
        '--wait',
        '--json',
      ],
      deps: {
        config: { ...config, waitTimeoutMs: 50, waitPollIntervalMs: 20 },
        coreDeps,
        waitDeps: {
          findMatchesByExternalIds: vi.fn(async () => [
            { externalMatchId: 'm1', ingestionStatus: 'PENDING' },
          ]),
          findDurableJobsByExternalIds: vi.fn(async () => []),
          sleep: vi.fn(async () => undefined),
          now: (() => {
            let t = 0;
            return () => {
              t += 30;
              return t;
            };
          })(),
        },
        checkSmoke: vi.fn(async () => ({ ok: false })),
      },
      io: {
        readFile: vi.fn(),
        log: vi.fn(),
        writeJson: vi.fn(),
        writeText: vi.fn(),
        reportFailure: vi.fn(),
      },
    });

    expect(report.waitSummary?.timedOut).toBe(true);
    expect(report.aggregateSmoke?.status).toBe('inconclusive');
    expect(exitCode).toBe(0);
  });
});

describe('createDiscoveryBootstrapCoreDeps', () => {
  it('passes config.pageSize into Nest discovery (not the Nest default 100)', async () => {
    const pageSize = 25;
    expect(pageSize).not.toBe(100);

    const getRecentMatchIds = vi.fn(async () => ['m-0']);
    const discovery = PlayerMatchDiscoveryService.fromRuntimeDeps({
      resolvePlayer: vi.fn(async () => ({
        provider: 'RIOT',
        externalAccountId: 'puuid-secret',
        platform: 'na1',
        regionalRoute: 'americas',
        riotId: { gameName: 'PlayerOne', tagLine: 'NA1' },
      })),
      getRankedEntries: vi.fn(async () => []),
      getRecentMatchIds,
      upsertPlayerAccount: vi.fn(),
      findPlayerAccountById: vi.fn(),
      insertRankIfChanged: vi.fn(),
      enqueueDeps: {
        matches: {} as EnqueueDiscoveredMatchesDeps['matches'],
        ingestionJobs: {} as EnqueueDiscoveredMatchesDeps['ingestionJobs'],
        producer: {
          enqueueMatch: vi.fn(),
          getJobStates: vi.fn(),
        } as EnqueueDiscoveredMatchesDeps['producer'],
        matchIngestionJobAttempts: 5,
        logger: { log: vi.fn() },
        invalidatePlayerCache: vi.fn(async () => undefined),
      },
      pageSize: 100, // Nest default — must be overridden by CLI config
      logger: { log: vi.fn(), warn: vi.fn() },
    });

    const coreDeps = createDiscoveryBootstrapCoreDeps({
      config: { ...config, pageSize },
      logger: { log: vi.fn(), warn: vi.fn() },
      discovery,
    });

    await bootstrapPlayer(coreDeps, {
      target: { gameName: 'PlayerOne', tagLine: 'NA1', platform: 'na1' },
      queueId: 420,
      maxMatches: 100,
      dryRun: true,
      correlationId: 'corr-cli-page',
    });

    expect(getRecentMatchIds).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ queue: 420, start: 0, count: pageSize }),
    );
  });
});

describe('package scripts', () => {
  it('root and API scripts point at the bootstrap CLI entry', () => {
    const apiPkg = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    const rootPkg = JSON.parse(
      readFileSync(resolve(process.cwd(), '../../package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };

    expect(apiPkg.scripts['matches:bootstrap-player']).toBe(
      'tsx src/features/players/cli/bootstrap-player.ts',
    );
    expect(rootPkg.scripts['matches:bootstrap-player']).toBe(
      'pnpm --filter @league-helper/api matches:bootstrap-player',
    );
  });
});
