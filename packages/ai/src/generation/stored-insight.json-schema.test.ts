import { describe, expect, it } from 'vitest';
import {
  CHAMPION_AI_STORED_INSIGHT_JSON_SCHEMA,
  CHAMPION_AI_STORED_INSIGHT_JSON_SCHEMA_NAME,
} from './stored-insight.json-schema';

function asRecord(value: unknown): Record<string, unknown> {
  expect(value).toEqual(expect.any(Object));
  return value as Record<string, unknown>;
}

describe('CHAMPION_AI_STORED_INSIGHT_JSON_SCHEMA', () => {
  it('is named for OpenAI strict json_schema mode', () => {
    expect(CHAMPION_AI_STORED_INSIGHT_JSON_SCHEMA_NAME).toBe('champion_ai_stored_insight');
  });

  it('describes a strict object matching stored insight bounds', () => {
    const schema = asRecord(CHAMPION_AI_STORED_INSIGHT_JSON_SCHEMA);
    expect(schema.type).toBe('object');
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual([
      'summary',
      'strengths',
      'weaknesses',
      'buildInsight',
      'matchupInsights',
    ]);

    const properties = asRecord(schema.properties);
    const summary = asRecord(properties.summary);
    expect(summary.type).toBe('object');
    expect(summary.additionalProperties).toBe(false);
    expect(summary.required).toEqual(['text', 'evidence']);
    const summaryProps = asRecord(summary.properties);
    const summaryText = asRecord(summaryProps.text);
    expect(summaryText.minLength).toBe(80);
    expect(summaryText.maxLength).toBe(600);
    const summaryEvidence = asRecord(summaryProps.evidence);
    expect(summaryEvidence.type).toBe('array');
    expect(summaryEvidence.minItems).toBe(1);
    expect(asRecord(summaryEvidence.items).type).toBe('string');
    expect(asRecord(summaryEvidence.items).description).toMatch(/handle/i);

    const strengths = asRecord(properties.strengths);
    expect(strengths.maxItems).toBe(3);
    const weaknesses = asRecord(properties.weaknesses);
    expect(weaknesses.maxItems).toBe(3);
    const matchupInsights = asRecord(properties.matchupInsights);
    expect(matchupInsights.maxItems).toBe(6);

    const buildInsight = asRecord(properties.buildInsight);
    expect(buildInsight.type).toEqual(['object', 'null']);

    const matchupItems = asRecord(matchupInsights.items);
    const matchupProps = asRecord(matchupItems.properties);
    const side = asRecord(matchupProps.side);
    expect(side.enum).toEqual(['STRONG', 'WEAK']);
  });
});
