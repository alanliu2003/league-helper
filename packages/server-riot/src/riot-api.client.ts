import { randomUUID } from 'node:crypto';
import {
  InvalidRegionalRouteError,
  UnsupportedPlatformRouteError,
  parsePlatformRoute,
  parseRegionalRoute,
} from '@league-helper/shared';
import type { ZodTypeAny } from 'zod';
import { requireRiotApiKey, type RiotConfig } from './riot.config';
import {
  createResponseValidationError,
  mapHttpStatusToProviderError,
  mapTransportErrorToProviderError,
  redactSensitiveText,
} from './riot-api.errors';
import type {
  FetchFn,
  RandomFn,
  RiotHttpResult,
  RiotRequestOptions,
  SleepFn,
} from './riot-api.types';
import { createConsoleRiotLogger, type RiotLogger } from './riot-logger';
import { createRiotResponseMetadata } from './riot-response-metadata';
import type { RiotRequestBudgetGate } from './riot-request-budget';
import { decideRetry, sleep } from './riot-retry';

export type RiotApiClientDependencies = {
  fetchFn?: FetchFn;
  sleepFn?: SleepFn;
  randomFn?: RandomFn;
  logger?: RiotLogger;
  /** Optional proactive cross-process request budget (checked before HTTP send). */
  requestBudget?: RiotRequestBudgetGate | null;
};

export class RiotApiClient {
  private readonly config: RiotConfig;
  private fetchFn: FetchFn;
  private sleepFn: SleepFn;
  private randomFn: RandomFn;
  private logger: RiotLogger;
  private requestBudget: RiotRequestBudgetGate | null;

  constructor(config: RiotConfig, deps: RiotApiClientDependencies = {}) {
    this.config = config;
    this.fetchFn = deps.fetchFn ?? fetch.bind(globalThis);
    this.sleepFn = deps.sleepFn ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.randomFn = deps.randomFn ?? Math.random;
    this.logger = deps.logger ?? createConsoleRiotLogger(RiotApiClient.name);
    this.requestBudget = deps.requestBudget ?? null;
  }

  /** Test-friendly factory with injectable fetch/sleep/random. */
  static create(config: RiotConfig, deps: RiotApiClientDependencies = {}): RiotApiClient {
    return new RiotApiClient(config, deps);
  }

  async requestJson<T>(
    options: RiotRequestOptions,
    schema: ZodTypeAny,
  ): Promise<RiotHttpResult<T>> {
    const apiKey = requireRiotApiKey(this.config);
    const correlationId = options.correlationId ?? randomUUID();
    const method = options.method ?? 'GET';
    const url = this.buildUrl(options);
    const routeLabel = this.routeLabel(options);

    let attempt = 0;
    while (true) {
      if (this.requestBudget) {
        const budget = await this.requestBudget.acquireForRequest({
          category: options.category,
          workload: options.workload,
          sleepFn: this.sleepFn,
        });
        if (budget.waitedMs > 0) {
          this.logSafe({
            level: 'log',
            message: 'Riot request admitted after proactive budget wait',
            category: options.category,
            routeLabel,
            correlationId,
            attempt,
            waitedMs: budget.waitedMs,
            workload: budget.workload,
          });
        }
      }

      const started = Date.now();
      let response: Response;

      try {
        response = await this.send(url, method, apiKey, correlationId);
      } catch (error: unknown) {
        const decision = decideRetry({
          method,
          attempt,
          maxRetries: this.config.maxRetries,
          transportError: error,
          maxRetryDelayMs: this.config.maxRetryDelayMs,
          random: this.randomFn,
        });

        this.logSafe({
          level: 'warn',
          message: 'Riot transport failure',
          category: options.category,
          routeLabel,
          correlationId,
          attempt,
          durationMs: Date.now() - started,
          retry: decision.retry,
          reason: decision.reason,
        });

        if (decision.retry) {
          attempt += 1;
          await sleep(decision.delayMs, this.sleepFn);
          continue;
        }

        throw mapTransportErrorToProviderError(error, {
          category: options.category,
          routeLabel,
          secrets: [apiKey],
        });
      }

      const durationMs = Date.now() - started;
      const metadata = createRiotResponseMetadata({
        headers: response.headers,
        correlationId,
        httpStatus: response.status,
        durationMs,
        routeLabel,
        category: options.category,
        attempt,
      });

      this.logSafe({
        level: response.ok ? 'log' : 'warn',
        message: 'Riot HTTP response',
        category: options.category,
        routeLabel,
        correlationId,
        attempt,
        durationMs,
        status: response.status,
        rateLimitType: metadata.rateLimit.rateLimitType,
      });

      if (this.requestBudget?.observeResponse) {
        try {
          await this.requestBudget.observeResponse(metadata);
        } catch {
          // Observability must not break request path.
        }
      }

      if (response.status === 429 || (response.status >= 400 && response.status < 500)) {
        await this.safeReadBody(response);
        throw mapHttpStatusToProviderError({
          status: response.status,
          resourceHint: options.resourceHint,
          routeLabel,
          category: options.category,
          rateLimit: metadata.rateLimit,
          secrets: [apiKey],
        });
      }

      if (response.status >= 500) {
        await this.safeReadBody(response);
        const decision = decideRetry({
          method,
          attempt,
          maxRetries: this.config.maxRetries,
          status: response.status,
          maxRetryDelayMs: this.config.maxRetryDelayMs,
          random: this.randomFn,
        });

        if (decision.retry) {
          attempt += 1;
          this.logSafe({
            level: 'warn',
            message: 'Retrying Riot request after 5xx',
            category: options.category,
            routeLabel,
            correlationId,
            attempt,
            status: response.status,
            delayMs: decision.delayMs,
          });
          await sleep(decision.delayMs, this.sleepFn);
          continue;
        }

        throw mapHttpStatusToProviderError({
          status: response.status,
          resourceHint: options.resourceHint,
          routeLabel,
          category: options.category,
          rateLimit: metadata.rateLimit,
          secrets: [apiKey],
        });
      }

      if (!response.ok) {
        await this.safeReadBody(response);
        throw mapHttpStatusToProviderError({
          status: response.status,
          resourceHint: options.resourceHint,
          routeLabel,
          category: options.category,
          rateLimit: metadata.rateLimit,
          secrets: [apiKey],
        });
      }

      const raw: unknown = await this.parseJsonBody(response, options);
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        this.logger.warn(
          JSON.stringify({
            message: 'Riot response failed schema validation',
            category: options.category,
            routeLabel,
            correlationId,
            issues: parsed.error.issues.map((issue) => ({
              path: issue.path.join('.'),
              code: issue.code,
              message: issue.message,
            })),
          }),
        );
        throw createResponseValidationError(
          parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
          { category: options.category, routeLabel },
        );
      }

      return { data: parsed.data as T, metadata };
    }
  }

  buildUrl(options: RiotRequestOptions): string {
    const host = this.buildHost(options);
    const path = options.path.startsWith('/') ? options.path : `/${options.path}`;
    const url = new URL(`https://${host}${path}`);

    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value === undefined) {
          continue;
        }
        url.searchParams.set(key, String(value));
      }
    }

    return url.toString();
  }

  buildHost(options: RiotRequestOptions): string {
    if (options.route.kind === 'platform') {
      const platform = parsePlatformRoute(options.route.platform);
      return `${platform}.${this.config.baseDomain}`;
    }

    const regional = parseRegionalRoute(options.route.regionalRoute);
    return `${regional}.${this.config.baseDomain}`;
  }

  private routeLabel(options: RiotRequestOptions): string {
    if (options.route.kind === 'platform') {
      try {
        return parsePlatformRoute(options.route.platform);
      } catch (error: unknown) {
        if (error instanceof UnsupportedPlatformRouteError) {
          throw error;
        }
        throw error;
      }
    }

    try {
      return parseRegionalRoute(options.route.regionalRoute);
    } catch (error: unknown) {
      if (error instanceof InvalidRegionalRouteError) {
        throw error;
      }
      throw error;
    }
  }

  private async send(
    url: string,
    method: string,
    apiKey: string,
    correlationId: string,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      return await this.fetchFn(url, {
        method,
        headers: {
          Accept: 'application/json',
          'X-Riot-Token': apiKey,
          'X-Correlation-Id': correlationId,
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async parseJsonBody(response: Response, options: RiotRequestOptions): Promise<unknown> {
    const text = await response.text();
    if (!text.trim()) {
      return null;
    }

    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw createResponseValidationError(
        [{ path: '', message: 'Response body is not valid JSON' }],
        {
          category: options.category,
          routeLabel: this.routeLabel(options),
        },
      );
    }
  }

  private async safeReadBody(response: Response): Promise<void> {
    try {
      await response.text();
    } catch {
      // Ignore body read failures for error responses.
    }
  }

  private logSafe(
    entry: Record<string, unknown> & { level: 'log' | 'warn'; message: string },
  ): void {
    const { level, ...rest } = entry;
    const payload = redactSensitiveText(
      JSON.stringify(rest),
      this.config.apiKey ? [this.config.apiKey] : [],
    );
    if (level === 'warn') {
      this.logger.warn(payload);
      return;
    }
    this.logger.log(payload);
  }
}
