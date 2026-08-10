import { describe, expect, it } from 'vitest';
import {
  loadParticipantExpansionConfig,
  PARTICIPANT_EXPANSION_CONFIG_VECTORS as WORKER_VECTORS,
} from './participant-expansion.config.js';

/**
 * Drift-sensitive vectors must match apps/api collector.config PARTICIPANT_EXPANSION_CONFIG_VECTORS.
 * Duplicated literals here so worker tests do not import Nest/API modules.
 */
const API_VECTORS = {
  expandFromParticipantsDefault: false,
  maxDepthDefault: 1,
  maxDepthHardMax: 3,
  maxNewPlayersPerMatchDefault: 3,
  maxNewPlayersPerMatchHardMax: 9,
  maxNewPlayersPerSourcePlayerDefault: 5,
  maxNewPlayersPerSourcePlayerHardMax: 50,
  maxNewPlayersPerRunDefault: 20,
  maxNewPlayersPerRunHardMax: 200,
  maxTrackedPlayersDefault: 500,
  maxTrackedPlayersHardMax: 5000,
  expansionQueueIdDefault: 420,
  totalTrackedPlayersHardCapDefault: 5000,
  totalTrackedPlayersHardCapHardMax: 50_000,
} as const;

describe('participant expansion config drift guard', () => {
  it('worker vectors match approved API vectors', () => {
    expect(WORKER_VECTORS).toEqual(API_VECTORS);
  });

  it('defaults expansion disabled with approved numeric defaults', () => {
    const config = loadParticipantExpansionConfig({});
    expect(config.expandFromParticipants).toBe(false);
    expect(config.expansionMaxDepth).toBe(API_VECTORS.maxDepthDefault);
    expect(config.expansionMaxNewPlayersPerMatch).toBe(API_VECTORS.maxNewPlayersPerMatchDefault);
    expect(config.expansionMaxNewPlayersPerSourcePlayer).toBe(
      API_VECTORS.maxNewPlayersPerSourcePlayerDefault,
    );
    expect(config.expansionMaxNewPlayersPerRun).toBe(API_VECTORS.maxNewPlayersPerRunDefault);
    expect(config.expansionMaxTrackedPlayers).toBe(API_VECTORS.maxTrackedPlayersDefault);
    expect(config.expansionQueueId).toBe(API_VECTORS.expansionQueueIdDefault);
    expect(config.totalTrackedPlayersHardCap).toBe(API_VECTORS.totalTrackedPlayersHardCapDefault);
  });

  it('clamps budget knobs to hard maxima', () => {
    const config = loadParticipantExpansionConfig({
      COLLECTOR_EXPANSION_MAX_NEW_PLAYERS_PER_MATCH: '999',
      COLLECTOR_EXPANSION_MAX_NEW_PLAYERS_PER_SOURCE_PLAYER: '999',
      COLLECTOR_EXPANSION_MAX_NEW_PLAYERS_PER_RUN: '9999',
      COLLECTOR_EXPANSION_MAX_TRACKED_PLAYERS: '99999',
    });
    expect(config.expansionMaxNewPlayersPerMatch).toBe(API_VECTORS.maxNewPlayersPerMatchHardMax);
    expect(config.expansionMaxNewPlayersPerSourcePlayer).toBe(
      API_VECTORS.maxNewPlayersPerSourcePlayerHardMax,
    );
    expect(config.expansionMaxNewPlayersPerRun).toBe(API_VECTORS.maxNewPlayersPerRunHardMax);
    expect(config.expansionMaxTrackedPlayers).toBe(API_VECTORS.maxTrackedPlayersHardMax);
  });

  it('rejects total tracked hard cap above approved maximum', () => {
    expect(() =>
      loadParticipantExpansionConfig({
        COLLECTOR_TOTAL_TRACKED_PLAYERS_HARD_CAP: '50001',
      }),
    ).toThrow(/COLLECTOR_TOTAL_TRACKED_PLAYERS_HARD_CAP/);
  });
});
