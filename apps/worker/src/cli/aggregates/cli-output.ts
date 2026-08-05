const SENSITIVE_PATTERNS = [
  /puuid/i,
  /externalAccountId/i,
  /rawPayload/i,
  /DATABASE_URL/i,
  /REDIS_URL/i,
  /RIOT_API_KEY/i,
  /postgresql:\/\//i,
  /redis:\/\//i,
];

export function cliLog(message: string): void {
  console.error(message);
}

export function writeJsonStdout(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

export function writeTextStdout(lines: string[]): void {
  process.stdout.write(`${lines.join('\n')}\n`);
}

export function assertNoSensitiveOutput(text: string): void {
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(text)) {
      throw new Error('SENSITIVE_OUTPUT_BLOCKED');
    }
  }
}

export function collectStdoutJson(payload: unknown): string {
  const text = JSON.stringify(payload);
  assertNoSensitiveOutput(text);
  return text;
}

/**
 * Top-level / parse failure reporting.
 * JSON on stdout only when `--json` was requested; otherwise stderr only.
 */
export function reportCliFailure(input: {
  argv: string[];
  message: string;
}): void {
  cliLog(input.message);
  if (input.argv.includes('--json')) {
    writeJsonStdout({ ok: false, error: input.message });
  }
}
