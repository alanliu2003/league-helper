import { Inject, Injectable } from '@nestjs/common';
import { StaticDataStatus, type ChampionStaticData, type Patch } from '@prisma/client';
import {
  CLASSIC_CHAMPION_ID_MIN,
  isPublicChampionEntry,
  publicChampionStaticWhere,
} from './champion-public-visibility';
import { PrismaService } from '../prisma/prisma.service';

export type ChampionStaticRow = Pick<
  ChampionStaticData,
  'championId' | 'championKey' | 'name' | 'title' | 'tags'
> & {
  patchVersion: string;
  dataDragonVersion: string | null;
};

export type ListChampionsQuery = {
  search?: string;
  tag?: string;
  limit: number;
  offset: number;
};

@Injectable()
export class ChampionStaticRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Active READY patch preferred; falls back to newest READY patch by version string
   * when no active patch is marked. Documented static-data strategy for directory/detail.
   */
  async resolveStaticPatch(): Promise<Patch | null> {
    const active = await this.prisma.patch.findFirst({
      where: { isActive: true, staticDataStatus: StaticDataStatus.READY },
      orderBy: { updatedAt: 'desc' },
    });
    if (active) {
      return active;
    }
    return this.prisma.patch.findFirst({
      where: { staticDataStatus: StaticDataStatus.READY },
      orderBy: [{ normalizedMajorMinor: 'desc' }, { version: 'desc' }],
    });
  }

  async listChampions(query: ListChampionsQuery): Promise<{
    rows: ChampionStaticRow[];
    totalCount: number;
    patch: Patch | null;
  }> {
    const patch = await this.resolveStaticPatch();
    if (!patch) {
      return { rows: [], totalCount: 0, patch: null };
    }

    const search = query.search?.trim();
    const tag = query.tag?.trim();
    const where = {
      patchId: patch.id,
      ...publicChampionStaticWhere(),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              { championKey: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
      ...(tag ? { tags: { has: tag } } : {}),
    };

    const [rawRows, totalCount] = await Promise.all([
      this.prisma.championStaticData.findMany({
        where,
        select: {
          championId: true,
          championKey: true,
          name: true,
          title: true,
          tags: true,
        },
        orderBy: [{ name: 'asc' }, { championId: 'asc' }],
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.championStaticData.count({ where }),
    ]);

    const rows = rawRows.filter((row) => isPublicChampionEntry(row));

    return {
      rows: rows.map((row) => ({
        ...row,
        patchVersion: patch.version,
        dataDragonVersion: patch.dataDragonVersion,
      })),
      // ID-offset SQL filter removes Classic rows; in-memory filter is defensive only.
      totalCount,
      patch,
    };
  }

  async findByChampionKey(championKey: string): Promise<ChampionStaticRow | null> {
    const key = championKey.trim();
    if (!key) {
      return null;
    }

    const patch = await this.resolveStaticPatch();
    if (!patch) {
      return null;
    }

    const publicWhere = publicChampionStaticWhere();

    const exact = await this.prisma.championStaticData.findFirst({
      where: {
        patchId: patch.id,
        AND: [publicWhere, { championKey: key }],
      },
      select: {
        championId: true,
        championKey: true,
        name: true,
        title: true,
        tags: true,
      },
    });
    if (exact && isPublicChampionEntry(exact)) {
      return {
        ...exact,
        patchVersion: patch.version,
        dataDragonVersion: patch.dataDragonVersion,
      };
    }

    const insensitive = await this.prisma.championStaticData.findMany({
      where: {
        patchId: patch.id,
        AND: [publicWhere, { championKey: { equals: key, mode: 'insensitive' } }],
      },
      select: {
        championId: true,
        championKey: true,
        name: true,
        title: true,
        tags: true,
      },
      take: 2,
    });

    if (insensitive.length !== 1 || !insensitive[0]) {
      return null;
    }

    if (!isPublicChampionEntry(insensitive[0])) {
      return null;
    }

    return {
      ...insensitive[0],
      patchVersion: patch.version,
      dataDragonVersion: patch.dataDragonVersion,
    };
  }

  /** Batched metadata lookup by championId for aggregate joins (no N+1). */
  async findByChampionIds(championIds: number[]): Promise<Map<number, ChampionStaticRow>> {
    const unique = [...new Set(championIds.filter((id) => Number.isInteger(id)))];
    const result = new Map<number, ChampionStaticRow>();
    if (unique.length === 0) {
      return result;
    }

    const patch = await this.resolveStaticPatch();
    if (!patch) {
      return result;
    }

    const idFiltered = unique.filter(
      (championId) => championId >= 0 && championId < CLASSIC_CHAMPION_ID_MIN,
    );
    if (idFiltered.length === 0) {
      return result;
    }

    const rows = await this.prisma.championStaticData.findMany({
      where: {
        patchId: patch.id,
        AND: [publicChampionStaticWhere(), { championId: { in: idFiltered } }],
      },
      select: {
        championId: true,
        championKey: true,
        name: true,
        title: true,
        tags: true,
      },
    });

    for (const row of rows) {
      if (!isPublicChampionEntry(row)) {
        continue;
      }
      result.set(row.championId, {
        ...row,
        patchVersion: patch.version,
        dataDragonVersion: patch.dataDragonVersion,
      });
    }
    return result;
  }
}
