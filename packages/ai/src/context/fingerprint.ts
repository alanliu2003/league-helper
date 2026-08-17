import { CHAMPION_AI_PROMPT_VERSION, PLAYER_PLAYSTYLE_PROMPT_VERSION } from '@league-helper/shared';
import { fingerprintCanonicalPayload } from './canonical-fingerprint';
import type { PlayerPlaystyleInternalContext } from './player-playstyle-types';
import type { ChampionInsightContext } from './types';

export type ChampionInsightFingerprintInput = {
  context: ChampionInsightContext;
  promptVersion?: string;
  model: string;
  provider: string;
};

export type PlayerPlaystyleFingerprintInput = {
  context: PlayerPlaystyleInternalContext;
  promptVersion?: string;
  model: string;
  provider: string;
};

export function fingerprintChampionInsightContext(
  input: ChampionInsightFingerprintInput,
): string {
  return fingerprintCanonicalPayload({
    context: input.context,
    promptVersion: input.promptVersion ?? CHAMPION_AI_PROMPT_VERSION,
    model: input.model,
    provider: input.provider,
  });
}

export function fingerprintPlayerPlaystyleContext(
  input: PlayerPlaystyleFingerprintInput,
): string {
  return fingerprintCanonicalPayload({
    context: input.context,
    promptVersion: input.promptVersion ?? PLAYER_PLAYSTYLE_PROMPT_VERSION,
    model: input.model,
    provider: input.provider,
  });
}
