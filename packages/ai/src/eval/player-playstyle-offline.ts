import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlayerPlaystyleContext } from '../context/player-playstyle-builder';
import {
  buildPlayerPlaystyleEvidenceHandleMapping,
  buildPlayerPlaystyleGenerationPayload,
} from '../context/player-playstyle-evidence';
import { buildPlayerPlaystyleUserPrompt } from '../prompts/player-playstyle-v1';
import type {
  PlayerPlaystyleGenerationComparison,
  PlayerPlaystyleInternalContext,
} from '../context/player-playstyle-types';
import {
  PlayerPlaystyleValidationError,
  validatePlayerPlaystyleInsight,
} from '../validation/player-playstyle-output';
import { defaultWrite, type EvalWriter } from './io';
import {
  PlayerPlaystyleEvalFixtureSchema,
  type PlayerPlaystyleEvalFixture,
} from './player-playstyle-fixture-schema';

export class PlayerPlaystyleFixtureAssertionError extends Error {
  readonly fixtureId: string;

  constructor(fixtureId: string, message: string) {
    super(`Fixture ${fixtureId}: ${message}`);
    this.name = 'PlayerPlaystyleFixtureAssertionError';
    this.fixtureId = fixtureId;
  }
}

export type PlayerPlaystyleOfflineEvalResult = {
  exitCode: number;
  passed: number;
  fixtures: number;
};

export const MIN_PLAYER_PLAYSTYLE_EVAL_FIXTURE_COUNT = 19;

export function getDefaultPlayerPlaystyleFixturesDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'player-playstyle');
}

export function parsePlayerPlaystyleEvalFixture(
  raw: unknown,
  source: string,
): PlayerPlaystyleEvalFixture {
  const parsed = PlayerPlaystyleEvalFixtureSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid player playstyle eval fixture '${source}': ${details}`);
  }
  return parsed.data;
}

export function loadPlayerPlaystyleEvalFixtures(
  dir = getDefaultPlayerPlaystyleFixturesDir(),
): PlayerPlaystyleEvalFixture[] {
  let names: string[];
  try {
    names = readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .sort();
  } catch {
    throw new Error(`Unable to read player playstyle eval fixtures from ${dir}`);
  }

  const fixtures = names.map((name) => {
    const path = join(dir, name);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown parse error';
      throw new Error(`Unable to parse player playstyle eval fixture JSON '${name}': ${reason}`);
    }
    return parsePlayerPlaystyleEvalFixture(raw, name);
  });

  const seen = new Set<string>();
  for (const fixture of fixtures) {
    if (seen.has(fixture.id)) {
      throw new Error(`Duplicate player playstyle eval fixture id '${fixture.id}'`);
    }
    seen.add(fixture.id);
  }

  return fixtures;
}

export function resolvePlayerPlaystyleEvalFixtures(options?: {
  fixtures?: PlayerPlaystyleEvalFixture[];
  fixturesDir?: string;
  minCount?: number;
}): PlayerPlaystyleEvalFixture[] {
  if (options?.fixtures) {
    return options.fixtures;
  }

  const loaded = loadPlayerPlaystyleEvalFixtures(options?.fixturesDir);
  const minCount = options?.minCount ?? MIN_PLAYER_PLAYSTYLE_EVAL_FIXTURE_COUNT;
  if (loaded.length < minCount) {
    throw new Error(
      `Expected at least ${minCount} player playstyle eval fixtures, found ${loaded.length}`,
    );
  }
  return loaded;
}

function assertEqualFlag(
  fixtureId: string,
  name: string,
  expected: boolean,
  actual: boolean,
): void {
  if (expected !== actual) {
    throw new PlayerPlaystyleFixtureAssertionError(
      fixtureId,
      `${name} expected ${expected}, got ${actual}`,
    );
  }
}

function assertNoNumericGenerationFields(
  fixtureId: string,
  label: string,
  comparisons: readonly PlayerPlaystyleGenerationComparison[],
): void {
  for (const row of comparisons) {
    if ('delta' in row || 'playerValue' in row || 'baseline' in row) {
      throw new PlayerPlaystyleFixtureAssertionError(
        fixtureId,
        `${label} generation comparison for ${row.metric} leaked numeric fields`,
      );
    }
  }
}

function serializeInvalidModelOutput(
  raw: PlayerPlaystyleEvalFixture['invalidModelOutput'],
): string {
  if (typeof raw === 'string') {
    return raw;
  }
  return JSON.stringify(raw);
}

export function assertPlayerPlaystyleFixtureExpectations(
  fixture: PlayerPlaystyleEvalFixture,
  context: PlayerPlaystyleInternalContext,
): void {
  assertEqualFlag(
    fixture.id,
    'generationEligible',
    fixture.expectGenerationEligible,
    context.generationEligible,
  );
  assertEqualFlag(
    fixture.id,
    'economyAllowed',
    fixture.expectEconomyAllowed,
    context.outputPolicy.economyAllowed,
  );
  assertEqualFlag(
    fixture.id,
    'combatAllowed',
    fixture.expectCombatAllowed,
    context.outputPolicy.combatAllowed,
  );

  const sliceKeys = context.championSlices.map((slice) => slice.championKey);
  if (sliceKeys.length !== fixture.expectSliceChampionKeys.length) {
    throw new PlayerPlaystyleFixtureAssertionError(
      fixture.id,
      `expectSliceChampionKeys expected [${fixture.expectSliceChampionKeys.join(', ')}], got [${sliceKeys.join(', ')}]`,
    );
  }
  for (let index = 0; index < sliceKeys.length; index += 1) {
    if (sliceKeys[index] !== fixture.expectSliceChampionKeys[index]) {
      throw new PlayerPlaystyleFixtureAssertionError(
        fixture.id,
        `expectSliceChampionKeys expected [${fixture.expectSliceChampionKeys.join(', ')}], got [${sliceKeys.join(', ')}]`,
      );
    }
  }

  const catalog = new Map(context.evidenceCatalog.map((entry) => [entry.id, entry]));

  if (fixture.expectNoOverallKda) {
    if (context.overall.comparisons.some((row) => row.metric === 'KDA')) {
      throw new PlayerPlaystyleFixtureAssertionError(
        fixture.id,
        'overall.comparisons must not include KDA',
      );
    }
    if (catalog.has('OVERALL_KDA')) {
      throw new PlayerPlaystyleFixtureAssertionError(
        fixture.id,
        'catalog must not include OVERALL_KDA',
      );
    }
  }

  for (const id of fixture.expectEvidenceContains ?? []) {
    if (!catalog.has(id)) {
      throw new PlayerPlaystyleFixtureAssertionError(fixture.id, `missing evidence id ${id}`);
    }
  }

  for (const id of fixture.expectEvidenceNotCitable ?? []) {
    const entry = catalog.get(id);
    if (!entry) {
      throw new PlayerPlaystyleFixtureAssertionError(
        fixture.id,
        `expected evidence id ${id} to exist`,
      );
    }
    if (entry.interpretationAllowed !== false) {
      throw new PlayerPlaystyleFixtureAssertionError(
        fixture.id,
        `expected ${id} interpretationAllowed false`,
      );
    }
  }

  const mapping = buildPlayerPlaystyleEvidenceHandleMapping(context.evidenceCatalog);
  for (const id of fixture.expectEvidenceNotCitable ?? []) {
    if (mapping.idToHandle.has(id)) {
      throw new PlayerPlaystyleFixtureAssertionError(
        fixture.id,
        `expected ${id} to have no generation-facing handle`,
      );
    }
  }

  const disallowedIds = context.evidenceCatalog
    .filter((entry) => !entry.interpretationAllowed)
    .map((entry) => entry.id);
  for (const id of disallowedIds) {
    if (mapping.idToHandle.has(id)) {
      throw new PlayerPlaystyleFixtureAssertionError(
        fixture.id,
        `interpretationAllowed=false id ${id} must not appear as a generation handle`,
      );
    }
  }
  if (mapping.idToHandle.has('OVERALL_KDA')) {
    throw new PlayerPlaystyleFixtureAssertionError(
      fixture.id,
      'no OVERALL_KDA generation handle may exist',
    );
  }

  const payload = buildPlayerPlaystyleGenerationPayload(context);
  assertNoNumericGenerationFields(fixture.id, 'overall', payload.overall.comparisons);
  for (const slice of payload.championSlices) {
    assertNoNumericGenerationFields(
      fixture.id,
      `slice ${slice.championKey} ${slice.position}`,
      slice.comparisons,
    );
  }

  const payloadJson = JSON.stringify(payload);
  if ('matchIdentity' in payload || 'playerAccountId' in payload) {
    throw new PlayerPlaystyleFixtureAssertionError(
      fixture.id,
      'generation payload must not include matchIdentity or playerAccountId',
    );
  }
  if (payloadJson.includes('"matchId"') || payloadJson.includes('"playerAccountId"')) {
    throw new PlayerPlaystyleFixtureAssertionError(
      fixture.id,
      'generation payload leaked matchId or playerAccountId',
    );
  }
  if (fixture.input.playerAccountId && payloadJson.includes(fixture.input.playerAccountId)) {
    throw new PlayerPlaystyleFixtureAssertionError(
      fixture.id,
      'generation payload leaked playerAccountId value',
    );
  }
  for (const identity of fixture.input.matchIdentity) {
    if (payloadJson.includes(identity.matchId)) {
      throw new PlayerPlaystyleFixtureAssertionError(
        fixture.id,
        `generation payload leaked matchId ${identity.matchId}`,
      );
    }
  }

  if (fixture.expectOverallCsPlayerValueNull) {
    const csRow = context.overall.comparisons.find((row) => row.metric === 'CS_PER_MIN');
    if (!csRow) {
      throw new PlayerPlaystyleFixtureAssertionError(
        fixture.id,
        'expected overall CS_PER_MIN comparison when expectOverallCsPlayerValueNull is true',
      );
    }
    if (csRow.playerValue !== null) {
      throw new PlayerPlaystyleFixtureAssertionError(
        fixture.id,
        `overall CS_PER_MIN playerValue expected null, got ${String(csRow.playerValue)}`,
      );
    }
  }

  if (
    fixture.expectSliceCsBaselineValue !== undefined ||
    fixture.expectSliceCsPlayerValue !== undefined
  ) {
    const sliceCsRows = context.championSlices.flatMap((slice) =>
      slice.comparisons.filter((row) => row.metric === 'CS_PER_MIN'),
    );
    const matched = sliceCsRows.filter((row) => {
      if (
        fixture.expectSliceCsBaselineValue !== undefined &&
        row.baseline?.value !== fixture.expectSliceCsBaselineValue
      ) {
        return false;
      }
      if (
        fixture.expectSliceCsPlayerValue !== undefined &&
        row.playerValue !== fixture.expectSliceCsPlayerValue
      ) {
        return false;
      }
      return true;
    });
    if (matched.length === 0) {
      throw new PlayerPlaystyleFixtureAssertionError(
        fixture.id,
        'no slice CS_PER_MIN comparison matched expectSliceCsBaselineValue/expectSliceCsPlayerValue (matched-mean, not modal)',
      );
    }
  }

  if (fixture.expectUsedAllTierFallback) {
    const usedFallback =
      context.overall.comparisons.some((row) => row.baseline?.usedAllTierFallback === true) ||
      context.championSlices.some((slice) =>
        slice.comparisons.some((row) => row.baseline?.usedAllTierFallback === true),
      );
    if (!usedFallback) {
      throw new PlayerPlaystyleFixtureAssertionError(
        fixture.id,
        'expected usedAllTierFallback true on at least one comparison',
      );
    }
  }

  if (fixture.expectWindowIdentity) {
    const skippedSum =
      context.skipped.remake + context.skipped.incomplete + context.skipped.unknownPosition;
    if (skippedSum + context.playerSample.matchesAnalyzed !== context.windowSize) {
      throw new PlayerPlaystyleFixtureAssertionError(
        fixture.id,
        `window identity expected remake+incomplete+unknownPosition+matchesAnalyzed === windowSize (${skippedSum}+${context.playerSample.matchesAnalyzed} !== ${context.windowSize})`,
      );
    }
    if (context.windowSize > 20) {
      throw new PlayerPlaystyleFixtureAssertionError(
        fixture.id,
        `windowSize ${context.windowSize} must be <= 20`,
      );
    }
    if (context.skipped.noBaseline > context.playerSample.matchesAnalyzed) {
      throw new PlayerPlaystyleFixtureAssertionError(
        fixture.id,
        `noBaseline ${context.skipped.noBaseline} must be <= matchesAnalyzed ${context.playerSample.matchesAnalyzed}`,
      );
    }
    const expectedComparable = context.playerSample.matchesAnalyzed - context.skipped.noBaseline;
    if (context.playerSample.comparableMatchCount !== expectedComparable) {
      throw new PlayerPlaystyleFixtureAssertionError(
        fixture.id,
        `comparableMatchCount expected ${expectedComparable} (matchesAnalyzed - noBaseline), got ${context.playerSample.comparableMatchCount}`,
      );
    }
  }

  const userPrompt = buildPlayerPlaystyleUserPrompt(context);
  for (const id of fixture.expectEvidenceContains ?? []) {
    if (userPrompt.includes(id)) {
      throw new PlayerPlaystyleFixtureAssertionError(
        fixture.id,
        `generation prompt leaked canonical evidence id ${id}`,
      );
    }
  }
  if (userPrompt.includes('OVERALL_KDA')) {
    throw new PlayerPlaystyleFixtureAssertionError(
      fixture.id,
      'generation prompt leaked OVERALL_KDA',
    );
  }

  if (fixture.invalidModelOutput !== undefined) {
    const raw = serializeInvalidModelOutput(fixture.invalidModelOutput);
    let thrown: unknown;
    try {
      validatePlayerPlaystyleInsight(raw, context);
    } catch (error) {
      thrown = error;
    }
    if (!(thrown instanceof PlayerPlaystyleValidationError)) {
      throw new PlayerPlaystyleFixtureAssertionError(
        fixture.id,
        'invalidModelOutput was expected to fail validatePlayerPlaystyleInsight',
      );
    }
    if (thrown.code !== 'NUMERIC' && thrown.code !== 'EVIDENCE') {
      throw new PlayerPlaystyleFixtureAssertionError(
        fixture.id,
        `invalidModelOutput expected NUMERIC or EVIDENCE failure, got ${thrown.code}`,
      );
    }
  }
}

export async function runPlayerPlaystyleOfflineEval(options?: {
  fixtures?: PlayerPlaystyleEvalFixture[];
  fixturesDir?: string;
  write?: EvalWriter;
}): Promise<PlayerPlaystyleOfflineEvalResult> {
  const write = options?.write ?? defaultWrite;

  try {
    const fixtures = resolvePlayerPlaystyleEvalFixtures({
      fixtures: options?.fixtures,
      fixturesDir: options?.fixturesDir,
    });
    let passed = 0;
    for (const fixture of fixtures) {
      const context = buildPlayerPlaystyleContext(fixture.input);
      assertPlayerPlaystyleFixtureExpectations(fixture, context);
      passed += 1;
    }
    write(`offline playstyle eval passed: ${passed}/${fixtures.length} fixtures`);
    return { exitCode: 0, passed, fixtures: fixtures.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    write(message);
    return { exitCode: 1, passed: 0, fixtures: options?.fixtures?.length ?? 0 };
  }
}
