import { createHash } from 'node:crypto';
import { CHAMPION_AI_PROMPT_VERSION } from '@league-helper/shared';
import type { ChampionInsightContext } from './types';

const VOLATILE_KEYS = new Set(['calculatedAt', 'latestEligibleMatchAt']);

export type ChampionInsightFingerprintInput = {
  context: ChampionInsightContext;
  promptVersion?: string;
  model: string;
  provider: string;
};

function canonicalize(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }

  const source = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    if (VOLATILE_KEYS.has(key)) {
      continue;
    }
    const canonicalized = canonicalize(source[key]);
    if (canonicalized !== undefined) {
      sorted[key] = canonicalized;
    }
  }
  return sorted;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function fingerprintChampionInsightContext(
  input: ChampionInsightFingerprintInput,
): string {
  const promptVersion = input.promptVersion ?? CHAMPION_AI_PROMPT_VERSION;
  const payload = `${canonicalJson(input.context)}\0${promptVersion}\0${input.model}\0${input.provider}`;
  return createHash('sha256').update(payload).digest('hex');
}
