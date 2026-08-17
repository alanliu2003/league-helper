export const AI_INSIGHT_POLL_MAX_MS = 120_000;

export function nextAiInsightPollDelayMs(elapsedMs: number): number {
  if (elapsedMs < 2000) {
    return 2000;
  }
  if (elapsedMs < 6000) {
    return 4000;
  }
  return 8000;
}

export function shouldContinueAiInsightPoll(
  status: string,
  elapsedMs: number,
  maxMs: number = AI_INSIGHT_POLL_MAX_MS,
): boolean {
  return status === 'PENDING' && elapsedMs < maxMs;
}
