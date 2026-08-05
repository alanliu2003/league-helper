/** Truncate match IDs for structured logs (never log PUUIDs or raw payloads). */
export function truncateMatchId(externalMatchId: string): string {
  if (externalMatchId.length <= 20) {
    return externalMatchId;
  }
  return `${externalMatchId.slice(0, 16)}…`;
}

export function safeJobId(jobId: string | undefined): string {
  return jobId && jobId.length > 0 ? jobId.slice(0, 128) : 'unknown';
}
