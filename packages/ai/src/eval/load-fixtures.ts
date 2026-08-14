import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ChampionInsightEvalFixtureSchema,
  type ChampionInsightEvalFixture,
} from './fixture-schema';

export const MIN_EVAL_FIXTURE_COUNT = 12;

export function getDefaultFixturesDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
}

export function parseEvalFixture(raw: unknown, source: string): ChampionInsightEvalFixture {
  const parsed = ChampionInsightEvalFixtureSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid eval fixture '${source}': ${details}`);
  }
  return parsed.data;
}

export function loadEvalFixtures(dir = getDefaultFixturesDir()): ChampionInsightEvalFixture[] {
  let names: string[];
  try {
    names = readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .sort();
  } catch {
    throw new Error(`Unable to read eval fixtures from ${dir}`);
  }

  const fixtures = names.map((name) => {
    const path = join(dir, name);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown parse error';
      throw new Error(`Unable to parse eval fixture JSON '${name}': ${reason}`);
    }
    return parseEvalFixture(raw, name);
  });

  const seen = new Set<string>();
  for (const fixture of fixtures) {
    if (seen.has(fixture.id)) {
      throw new Error(`Duplicate eval fixture id '${fixture.id}'`);
    }
    seen.add(fixture.id);
  }

  return fixtures;
}

export function resolveEvalFixtures(options?: {
  fixtures?: ChampionInsightEvalFixture[];
  fixturesDir?: string;
  minCount?: number;
}): ChampionInsightEvalFixture[] {
  if (options?.fixtures) {
    return options.fixtures;
  }

  const loaded = loadEvalFixtures(options?.fixturesDir);
  const minCount = options?.minCount ?? MIN_EVAL_FIXTURE_COUNT;
  if (loaded.length < minCount) {
    throw new Error(`Expected at least ${minCount} eval fixtures, found ${loaded.length}`);
  }
  return loaded;
}
