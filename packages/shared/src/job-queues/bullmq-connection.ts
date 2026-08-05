/** Shared BullMQ / Redis connection defaults for API producer and worker. */
export const BULLMQ_DEFAULT_PREFIX = 'bull' as const;

export type BullMqRedisConnectionInfo = {
  /** Redis logical database number (0 when omitted). Never includes credentials. */
  database: number;
  host: string;
  port: number;
  /** True when a non-default BullMQ prefix is configured via env. */
  prefix: typeof BULLMQ_DEFAULT_PREFIX | string;
};

/**
 * Parse Redis URL for diagnostics. Does not return passwords or full URLs.
 */
export function parseBullMqRedisConnectionInfo(
  redisUrl: string,
  prefix: string = BULLMQ_DEFAULT_PREFIX,
): BullMqRedisConnectionInfo {
  try {
    const parsed = new URL(redisUrl);
    const pathDb =
      parsed.pathname && parsed.pathname !== '/' ? Number(parsed.pathname.slice(1)) : 0;
    const database = Number.isInteger(pathDb) && pathDb >= 0 ? pathDb : 0;
    const port = parsed.port ? Number(parsed.port) : 6379;
    return {
      database,
      host: parsed.hostname || 'localhost',
      port: Number.isFinite(port) ? port : 6379,
      prefix,
    };
  } catch {
    return {
      database: 0,
      host: 'localhost',
      port: 6379,
      prefix,
    };
  }
}

/** BullMQ connection options shared by Queue and Worker constructors. */
export function createBullMqConnectionOptions(redisUrl: string): {
  url: string;
  maxRetriesPerRequest: null;
} {
  return {
    url: redisUrl,
    maxRetriesPerRequest: null,
  };
}

export function resolveBullMqPrefix(env: { BULLMQ_PREFIX?: string } = process.env): string {
  const raw = env.BULLMQ_PREFIX?.trim();
  return raw && raw.length > 0 ? raw : BULLMQ_DEFAULT_PREFIX;
}
