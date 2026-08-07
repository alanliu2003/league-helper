/**
 * Pure fixed-window participant selection for Task 4 population expansion.
 *
 * Lifetime window is derived ONLY from stable persisted MatchParticipant identity
 * fields. Mutable linkage/tracked/depth/account metadata must never influence
 * filter, sort, or window membership.
 */

export type StableParticipantIdentity = {
  externalAccountId: string | null;
  riotIdGameName: string | null;
  riotIdTagLine: string | null;
  participantId: number;
};

export type ExpansionCandidate = {
  externalAccountId: string;
  riotIdGameName: string;
  riotIdTagLine: string;
  participantId: number;
};

function isNonBlank(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Select the lifetime fixed consideration window for a match.
 *
 * Pipeline: filter stable identity → sort externalAccountId ASC, participantId ASC → take first N.
 */
export function selectExpansionCandidates(input: {
  participants: StableParticipantIdentity[];
  sourceExternalAccountId: string;
  maxPerMatch: number;
}): ExpansionCandidate[] {
  if (input.maxPerMatch <= 0) {
    return [];
  }

  const sourceExternal = input.sourceExternalAccountId.trim();
  const eligible: ExpansionCandidate[] = [];

  for (const participant of input.participants) {
    if (!isNonBlank(participant.externalAccountId)) {
      continue;
    }
    if (!isNonBlank(participant.riotIdGameName)) {
      continue;
    }
    if (!isNonBlank(participant.riotIdTagLine)) {
      continue;
    }
    if (!Number.isInteger(participant.participantId)) {
      continue;
    }

    const externalAccountId = participant.externalAccountId.trim();
    if (sourceExternal.length > 0 && externalAccountId === sourceExternal) {
      continue;
    }

    eligible.push({
      externalAccountId,
      riotIdGameName: participant.riotIdGameName.trim(),
      riotIdTagLine: participant.riotIdTagLine.trim(),
      participantId: participant.participantId,
    });
  }

  eligible.sort((a, b) => {
    if (a.externalAccountId < b.externalAccountId) return -1;
    if (a.externalAccountId > b.externalAccountId) return 1;
    return a.participantId - b.participantId;
  });

  return eligible.slice(0, input.maxPerMatch);
}
