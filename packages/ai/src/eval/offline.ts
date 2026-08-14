import { buildChampionInsightContext } from '../context/builder';
import { buildEvidenceHandleMapping } from '../context/evidence-handles';
import type { ChampionInsightContext } from '../context/types';
import { buildChampionInsightUserPrompt } from '../prompts/champion-insight-v1';
import type { ChampionInsightEvalFixture } from './fixture-schema';
import { defaultWrite, type EvalWriter } from './io';
import { resolveEvalFixtures } from './load-fixtures';

export class FixtureAssertionError extends Error {
  readonly fixtureId: string;

  constructor(fixtureId: string, message: string) {
    super(`Fixture ${fixtureId}: ${message}`);
    this.name = 'FixtureAssertionError';
    this.fixtureId = fixtureId;
  }
}

export type OfflineEvalResult = {
  exitCode: number;
  passed: number;
  fixtures: number;
};

function assertEqualFlag(
  fixtureId: string,
  name: string,
  expected: boolean,
  actual: boolean,
): void {
  if (expected !== actual) {
    throw new FixtureAssertionError(fixtureId, `${name} expected ${expected}, got ${actual}`);
  }
}

export function assertFixtureExpectations(
  fixture: ChampionInsightEvalFixture,
  context: ChampionInsightContext,
): void {
  assertEqualFlag(
    fixture.id,
    'generationEligible',
    fixture.expectGenerationEligible,
    context.generationEligible,
  );
  assertEqualFlag(
    fixture.id,
    'performanceConclusionsAllowed',
    fixture.expectPerformanceConclusionsAllowed,
    context.performanceConclusionsAllowed,
  );
  assertEqualFlag(
    fixture.id,
    'buildInsightAllowed',
    fixture.expectBuildInsightAllowed,
    context.buildInsightAllowed,
  );
  if (fixture.expectMatchupExplanationsAllowed !== undefined) {
    assertEqualFlag(
      fixture.id,
      'matchupExplanationsAllowed',
      fixture.expectMatchupExplanationsAllowed,
      context.matchupExplanationsAllowed,
    );
  }

  const catalog = new Map(context.evidenceCatalog.map((entry) => [entry.id, entry]));

  for (const id of fixture.expectEvidenceContains ?? []) {
    if (!catalog.has(id)) {
      throw new FixtureAssertionError(fixture.id, `missing evidence id ${id}`);
    }
  }

  for (const id of fixture.expectEvidenceNotCitable ?? []) {
    const entry = catalog.get(id);
    if (!entry) {
      throw new FixtureAssertionError(fixture.id, `expected evidence id ${id} to exist`);
    }
    if (entry.interpretationAllowed !== false) {
      throw new FixtureAssertionError(
        fixture.id,
        `expected ${id} interpretationAllowed false`,
      );
    }
  }

  const mapping = buildEvidenceHandleMapping(context.evidenceCatalog, context);
  if (mapping.entries.length > 0 && !mapping.handleToId.has('E1')) {
    throw new FixtureAssertionError(fixture.id, 'expected deterministic handle E1');
  }
  for (const id of fixture.expectEvidenceNotCitable ?? []) {
    if (mapping.idToHandle.has(id)) {
      throw new FixtureAssertionError(
        fixture.id,
        `expected ${id} to have no generation-facing handle`,
      );
    }
  }

  const userPrompt = buildChampionInsightUserPrompt(context);
  if (mapping.entries.length > 0 && !userPrompt.includes('E1')) {
    throw new FixtureAssertionError(fixture.id, 'generation prompt missing evidence handle E1');
  }
  for (const id of fixture.expectEvidenceContains ?? []) {
    if (userPrompt.includes(id)) {
      throw new FixtureAssertionError(
        fixture.id,
        `generation prompt leaked canonical evidence id ${id}`,
      );
    }
  }
}

export async function runOfflineEval(options?: {
  fixtures?: ChampionInsightEvalFixture[];
  fixturesDir?: string;
  write?: EvalWriter;
}): Promise<OfflineEvalResult> {
  const write = options?.write ?? defaultWrite;

  try {
    const fixtures = resolveEvalFixtures({
      fixtures: options?.fixtures,
      fixturesDir: options?.fixturesDir,
    });
    let passed = 0;
    for (const fixture of fixtures) {
      const context = buildChampionInsightContext(fixture.input);
      assertFixtureExpectations(fixture, context);
      passed += 1;
    }
    write(`offline eval passed: ${passed}/${fixtures.length} fixtures`);
    return { exitCode: 0, passed, fixtures: fixtures.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    write(message);
    return { exitCode: 1, passed: 0, fixtures: options?.fixtures?.length ?? 0 };
  }
}
