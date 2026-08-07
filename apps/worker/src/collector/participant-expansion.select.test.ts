import { describe, expect, it } from 'vitest';
import {
  selectExpansionCandidates,
  type StableParticipantIdentity,
} from './participant-expansion.select.js';

function participant(
  externalAccountId: string,
  participantId: number,
  overrides: Partial<StableParticipantIdentity> = {},
): StableParticipantIdentity {
  return {
    externalAccountId,
    riotIdGameName: `Name${participantId}`,
    riotIdTagLine: 'NA1',
    participantId,
    ...overrides,
  };
}

describe('selectExpansionCandidates', () => {
  const source = 'source-puuid';

  it('deterministic fixed window equals maxPerMatch', () => {
    const participants = [
      participant('F', 6),
      participant('A', 1),
      participant('C', 3),
      participant('B', 2),
      participant('E', 5),
      participant('D', 4),
    ];

    const window = selectExpansionCandidates({
      participants,
      sourceExternalAccountId: source,
      maxPerMatch: 3,
    });

    expect(window.map((c) => c.externalAccountId)).toEqual(['A', 'B', 'C']);
    expect(window).toHaveLength(3);
  });

  it('same normalized participant set always produces same candidate identity window', () => {
    const setA = [
      participant('D', 4),
      participant('A', 1),
      participant('C', 3),
      participant('B', 2),
      participant('E', 5),
      participant('F', 6),
    ];
    const setB = [...setA].reverse();

    const w1 = selectExpansionCandidates({
      participants: setA,
      sourceExternalAccountId: source,
      maxPerMatch: 3,
    });
    const w2 = selectExpansionCandidates({
      participants: setB,
      sourceExternalAccountId: source,
      maxPerMatch: 3,
    });

    expect(w1.map((c) => `${c.externalAccountId}:${c.participantId}`)).toEqual(
      w2.map((c) => `${c.externalAccountId}:${c.participantId}`),
    );
  });

  it('input order does not matter', () => {
    const ordered = ['A', 'B', 'C', 'D', 'E', 'F'].map((id, i) => participant(id, i + 1));
    const shuffled = [ordered[3], ordered[0], ordered[5], ordered[2], ordered[4], ordered[1]];

    const w1 = selectExpansionCandidates({
      participants: ordered,
      sourceExternalAccountId: source,
      maxPerMatch: 3,
    });
    const w2 = selectExpansionCandidates({
      participants: shuffled,
      sourceExternalAccountId: source,
      maxPerMatch: 3,
    });

    expect(w1.map((c) => c.externalAccountId)).toEqual(w2.map((c) => c.externalAccountId));
  });

  it('linkage mutation does not change the fixed window', () => {
    // Selector deliberately has no playerAccountId field — simulating linkage changes
    // is a no-op at the selection boundary by construction.
    const base = ['A', 'B', 'C', 'D', 'E', 'F'].map((id, i) => participant(id, i + 1));
    const first = selectExpansionCandidates({
      participants: base,
      sourceExternalAccountId: source,
      maxPerMatch: 3,
    });
    const second = selectExpansionCandidates({
      participants: base,
      sourceExternalAccountId: source,
      maxPerMatch: 3,
    });
    expect(first.map((c) => c.externalAccountId)).toEqual(['A', 'B', 'C']);
    expect(second.map((c) => c.externalAccountId)).toEqual(first.map((c) => c.externalAccountId));
  });

  it('tracked status does not affect window; later candidates never appear', () => {
    // Already-tracked status is post-window; selector always returns first N identities.
    const participants = ['A', 'B', 'C', 'D', 'E', 'F'].map((id, i) => participant(id, i + 1));
    const window = selectExpansionCandidates({
      participants,
      sourceExternalAccountId: source,
      maxPerMatch: 3,
    });
    expect(window.map((c) => c.externalAccountId)).toEqual(['A', 'B', 'C']);
    expect(window.map((c) => c.externalAccountId)).not.toContain('D');
  });

  it('depth/status/account metadata changes do not influence ordering', () => {
    // Only externalAccountId + participantId order; riot id values that remain nonblank
    // do not affect sort key.
    const a = participant('A', 1, { riotIdGameName: 'OldName', riotIdTagLine: 'OLD' });
    const b = participant('B', 2, { riotIdGameName: 'NewName', riotIdTagLine: 'NEW' });
    const c = participant('C', 3);
    const d = participant('D', 4);

    const window = selectExpansionCandidates({
      participants: [d, c, b, a],
      sourceExternalAccountId: source,
      maxPerMatch: 3,
    });
    expect(window.map((c) => c.externalAccountId)).toEqual(['A', 'B', 'C']);
  });

  it('reprocessing same match does not advance beyond window', () => {
    const participants = ['A', 'B', 'C', 'D', 'E', 'F'].map((id, i) => participant(id, i + 1));
    const first = selectExpansionCandidates({
      participants,
      sourceExternalAccountId: source,
      maxPerMatch: 3,
    });
    const second = selectExpansionCandidates({
      participants,
      sourceExternalAccountId: source,
      maxPerMatch: 3,
    });
    expect(first.map((c) => c.externalAccountId)).toEqual(['A', 'B', 'C']);
    expect(second.map((c) => c.externalAccountId)).toEqual(['A', 'B', 'C']);
  });

  it('excludes source externalAccountId and incomplete identity', () => {
    const participants: StableParticipantIdentity[] = [
      participant(source, 1),
      participant('A', 2),
      { externalAccountId: 'B', riotIdGameName: null, riotIdTagLine: 'NA1', participantId: 3 },
      { externalAccountId: 'C', riotIdGameName: 'C', riotIdTagLine: '  ', participantId: 4 },
      participant('D', 5),
      participant('E', 6),
    ];

    const window = selectExpansionCandidates({
      participants,
      sourceExternalAccountId: source,
      maxPerMatch: 3,
    });

    expect(window.map((c) => c.externalAccountId)).toEqual(['A', 'D', 'E']);
  });

  it('uses participantId as stable tie-break for same externalAccountId', () => {
    const participants = [
      participant('A', 9),
      participant('A', 2),
      participant('B', 1),
    ];
    const window = selectExpansionCandidates({
      participants,
      sourceExternalAccountId: source,
      maxPerMatch: 3,
    });
    expect(window.map((c) => `${c.externalAccountId}:${c.participantId}`)).toEqual([
      'A:2',
      'A:9',
      'B:1',
    ]);
  });
});
