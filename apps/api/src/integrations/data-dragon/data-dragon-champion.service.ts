import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { DataDragonConfig } from '../../config/data-dragon.config';
import {
  DataDragonChampionFileSchema,
  DataDragonRedisCacheSchema,
  DataDragonVersionsSchema,
  type DataDragonChampion,
  type DataDragonRedisCache,
} from './data-dragon.types';

export type DataDragonChampionServiceDeps = {
  fetchFn?: typeof fetch;
  nowFn?: () => number;
};

type MemoryCache = {
  version: string;
  locale: string;
  expiresAtMs: number;
  byNumericId: Map<number, DataDragonChampion>;
  byStringId: Map<string, DataDragonChampion>;
  all: DataDragonChampion[];
};

export class DataDragonChampionService {
  private readonly logger = new Logger(DataDragonChampionService.name);
  private readonly fetchFn: typeof fetch;
  private readonly nowFn: () => number;
  private memory: MemoryCache | null = null;
  private inflight: Promise<MemoryCache | null> | null = null;

  constructor(
    private readonly config: DataDragonConfig,
    private readonly redis: Pick<Redis, 'get' | 'set' | 'del'>,
    deps: DataDragonChampionServiceDeps = {},
  ) {
    this.fetchFn = deps.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.nowFn = deps.nowFn ?? (() => Date.now());
  }

  async getCurrentVersion(): Promise<string | null> {
    const loaded = await this.ensureLoaded();
    return loaded?.version ?? null;
  }

  async getChampionByNumericId(championId: number): Promise<DataDragonChampion | null> {
    if (!Number.isInteger(championId) || championId < 0) {
      return null;
    }
    const loaded = await this.ensureLoaded();
    return loaded?.byNumericId.get(championId) ?? null;
  }

  async getChampionByStringId(championKey: string): Promise<DataDragonChampion | null> {
    const key = championKey.trim();
    if (!key) {
      return null;
    }
    const loaded = await this.ensureLoaded();
    return loaded?.byStringId.get(key) ?? null;
  }

  async getAllChampions(): Promise<DataDragonChampion[]> {
    const loaded = await this.ensureLoaded();
    return loaded?.all.slice() ?? [];
  }

  getBaseUrl(): string {
    return this.config.baseUrl;
  }

  buildChampionIconUrl(championKey: string, version: string): string {
    const key = championKey.trim();
    const ver = version.trim();
    if (!key || !ver) {
      throw new Error('championKey and version are required to build an icon URL');
    }
    return `${this.config.baseUrl}/cdn/${encodeURIComponent(ver)}/img/champion/${encodeURIComponent(key)}.png`;
  }

  /**
   * Default-skin champion splash URL from the Data Dragon asset key (string id).
   * Path is versionless: `/cdn/img/champion/splash/{key}_0.jpg`.
   * Returns null when the asset key is missing.
   */
  buildChampionSplashUrl(championAssetKey: string): string | null {
    const key = championAssetKey.trim();
    if (!key) {
      return null;
    }
    return `${this.config.baseUrl}/cdn/img/champion/splash/${encodeURIComponent(key)}_0.jpg`;
  }

  /** Profile/summoner icon CDN URL; null when id or version is missing. */
  buildProfileIconUrl(profileIconId: number, version: string): string | null {
    if (!Number.isInteger(profileIconId) || profileIconId < 0) {
      return null;
    }
    const ver = version.trim();
    if (!ver) {
      return null;
    }
    return `${this.config.baseUrl}/cdn/${encodeURIComponent(ver)}/img/profileicon/${profileIconId}.png`;
  }

  /** Item icon CDN URL; returns null for empty slot (0) or missing version. */
  buildItemIconUrl(itemId: number, version: string): string | null {
    if (!Number.isInteger(itemId) || itemId <= 0) {
      return null;
    }
    const ver = version.trim();
    if (!ver) {
      return null;
    }
    return `${this.config.baseUrl}/cdn/${encodeURIComponent(ver)}/img/item/${itemId}.png`;
  }

  /** Summoner spell icon; null when filename or version is missing. */
  buildSummonerSpellIconUrl(imageFull: string, version: string): string | null {
    return this.buildAbilityIconUrl('spell', imageFull, version);
  }

  /** Rune icon from a Data Dragon perk-images path; versionless `/cdn/img/` URL. */
  buildRuneIconUrl(iconPath: string): string | null {
    const icon = iconPath.trim().replace(/^\/+/, '');
    if (!icon) {
      return null;
    }
    return `${this.config.baseUrl}/cdn/img/${icon
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')}`;
  }

  /** Passive ability icon; null when filename or version is missing. */
  buildPassiveIconUrl(imageFull: string, version: string): string | null {
    return this.buildAbilityIconUrl('passive', imageFull, version);
  }

  /** Spell ability icon; null when filename or version is missing. */
  buildSpellIconUrl(imageFull: string, version: string): string | null {
    return this.buildAbilityIconUrl('spell', imageFull, version);
  }

  private buildAbilityIconUrl(
    kind: 'passive' | 'spell',
    imageFull: string,
    version: string,
  ): string | null {
    const file = imageFull.trim();
    const ver = version.trim();
    if (!file || !ver) {
      return null;
    }
    return `${this.config.baseUrl}/cdn/${encodeURIComponent(ver)}/img/${kind}/${encodeURIComponent(file)}`;
  }

  async refreshCache(): Promise<DataDragonChampion[]> {
    this.memory = null;
    try {
      await this.redis.del(this.redisKey());
    } catch (error: unknown) {
      this.logger.warn({
        message: 'Data Dragon Redis cache delete failed',
        error: error instanceof Error ? error.message : 'unknown',
      });
    }
    const loaded = await this.loadFromNetwork();
    return loaded?.all.slice() ?? [];
  }

  private redisKey(): string {
    return `ddragon:champions:v1:${this.config.locale}`;
  }

  private async ensureLoaded(): Promise<MemoryCache | null> {
    const now = this.nowFn();
    if (this.memory && this.memory.expiresAtMs > now) {
      return this.memory;
    }

    if (this.inflight) {
      return this.inflight;
    }

    this.inflight = this.loadChampions().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async loadChampions(): Promise<MemoryCache | null> {
    const fromRedis = await this.readRedisCache();
    if (fromRedis) {
      this.memory = fromRedis;
      return fromRedis;
    }
    return this.loadFromNetwork();
  }

  private async readRedisCache(): Promise<MemoryCache | null> {
    try {
      const raw = await this.redis.get(this.redisKey());
      if (!raw) {
        return null;
      }
      const parsed = DataDragonRedisCacheSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        this.logger.warn({
          message: 'Data Dragon Redis cache payload rejected',
          issues: parsed.error.issues.length,
        });
        return null;
      }
      const ageMs = this.nowFn() - parsed.data.fetchedAtMs;
      if (ageMs >= this.config.cacheTtlSeconds * 1000) {
        return null;
      }
      return this.toMemoryCache(parsed.data);
    } catch (error: unknown) {
      this.logger.warn({
        message: 'Data Dragon Redis cache read failed',
        error: error instanceof Error ? error.message : 'unknown',
      });
      return null;
    }
  }

  private async writeRedisCache(payload: DataDragonRedisCache): Promise<void> {
    try {
      await this.redis.set(
        this.redisKey(),
        JSON.stringify(payload),
        'EX',
        this.config.cacheTtlSeconds,
      );
    } catch (error: unknown) {
      this.logger.warn({
        message: 'Data Dragon Redis cache write failed',
        error: error instanceof Error ? error.message : 'unknown',
      });
    }
  }

  private async loadFromNetwork(): Promise<MemoryCache | null> {
    try {
      const version = await this.fetchCurrentVersion();
      if (!version) {
        return null;
      }
      const file = await this.fetchChampionFile(version);
      if (!file) {
        return null;
      }

      const champions: DataDragonChampion[] = Object.values(file.data).map((entry) => ({
        id: entry.id,
        key: entry.key,
        name: entry.name,
        title: entry.title,
        iconUrl: this.buildChampionIconUrl(entry.id, file.version),
        splashUrl: this.buildChampionSplashUrl(entry.id),
      }));

      const payload: DataDragonRedisCache = {
        version: file.version,
        locale: this.config.locale,
        champions,
        fetchedAtMs: this.nowFn(),
      };

      await this.writeRedisCache(payload);
      const memory = this.toMemoryCache(payload);
      this.memory = memory;
      return memory;
    } catch (error: unknown) {
      this.logger.warn({
        message: 'Data Dragon champion load failed',
        error: error instanceof Error ? error.message : 'unknown',
      });
      return null;
    }
  }

  private async fetchCurrentVersion(): Promise<string | null> {
    const url = `${this.config.baseUrl}/api/versions.json`;
    const response = await this.fetchJson(url);
    if (!response) {
      return null;
    }
    const parsed = DataDragonVersionsSchema.safeParse(response);
    if (!parsed.success) {
      this.logger.warn({
        message: 'Data Dragon versions.json rejected',
        issues: parsed.error.issues.length,
      });
      return null;
    }
    return parsed.data[0] ?? null;
  }

  private async fetchChampionFile(version: string) {
    const url = `${this.config.baseUrl}/cdn/${encodeURIComponent(version)}/data/${encodeURIComponent(this.config.locale)}/champion.json`;
    const response = await this.fetchJson(url);
    if (!response) {
      return null;
    }
    const parsed = DataDragonChampionFileSchema.safeParse(response);
    if (!parsed.success) {
      this.logger.warn({
        message: 'Data Dragon champion.json rejected',
        issues: parsed.error.issues.length,
      });
      return null;
    }
    return parsed.data;
  }

  private async fetchJson(url: string): Promise<unknown | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    try {
      const response = await this.fetchFn(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
        },
      });
      if (!response.ok) {
        this.logger.warn({
          message: 'Data Dragon HTTP error',
          status: response.status,
        });
        return null;
      }
      return (await response.json()) as unknown;
    } catch (error: unknown) {
      this.logger.warn({
        message: 'Data Dragon request failed',
        error: error instanceof Error ? error.message : 'unknown',
      });
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private toMemoryCache(payload: DataDragonRedisCache): MemoryCache {
    const byNumericId = new Map<number, DataDragonChampion>();
    const byStringId = new Map<string, DataDragonChampion>();
    const all: DataDragonChampion[] = [];
    for (const champion of payload.champions) {
      const normalized: DataDragonChampion = {
        id: champion.id,
        key: champion.key,
        name: champion.name,
        title: champion.title,
        iconUrl: champion.iconUrl,
        splashUrl: champion.splashUrl ?? this.buildChampionSplashUrl(champion.id),
      };
      all.push(normalized);
      const numericId = Number(normalized.key);
      if (Number.isInteger(numericId)) {
        byNumericId.set(numericId, normalized);
      }
      byStringId.set(normalized.id, normalized);
    }
    const remainingMs = payload.fetchedAtMs + this.config.cacheTtlSeconds * 1000 - this.nowFn();
    return {
      version: payload.version,
      locale: payload.locale,
      expiresAtMs: this.nowFn() + Math.max(0, remainingMs),
      byNumericId,
      byStringId,
      all,
    };
  }
}
