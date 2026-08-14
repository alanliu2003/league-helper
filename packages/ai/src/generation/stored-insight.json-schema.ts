export const CHAMPION_AI_STORED_INSIGHT_JSON_SCHEMA_NAME = 'champion_ai_stored_insight';

const evidenceArraySchema = {
  type: 'array',
  minItems: 1,
  items: {
    type: 'string',
    description: 'Short evidence handle from the input list, such as E1',
  },
} as const;

const groundedClaimSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['text', 'evidence'],
  properties: {
    text: { type: 'string', minLength: 40, maxLength: 400 },
    evidence: evidenceArraySchema,
  },
} as const;

const nullableGroundedClaimSchema = {
  type: ['object', 'null'],
  additionalProperties: false,
  required: ['text', 'evidence'],
  properties: {
    text: { type: 'string', minLength: 40, maxLength: 400 },
    evidence: evidenceArraySchema,
  },
} as const;

const matchupInsightSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['opponentChampionKey', 'side', 'text', 'evidence'],
  properties: {
    opponentChampionKey: { type: 'string', minLength: 1 },
    side: { type: 'string', enum: ['STRONG', 'WEAK'] },
    text: { type: 'string', minLength: 40, maxLength: 500 },
    evidence: evidenceArraySchema,
  },
} as const;

export const CHAMPION_AI_STORED_INSIGHT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'strengths', 'weaknesses', 'buildInsight', 'matchupInsights'],
  properties: {
    summary: {
      type: 'object',
      additionalProperties: false,
      required: ['text', 'evidence'],
      properties: {
        text: { type: 'string', minLength: 80, maxLength: 600 },
        evidence: evidenceArraySchema,
      },
    },
    strengths: {
      type: 'array',
      maxItems: 3,
      items: groundedClaimSchema,
    },
    weaknesses: {
      type: 'array',
      maxItems: 3,
      items: groundedClaimSchema,
    },
    buildInsight: nullableGroundedClaimSchema,
    matchupInsights: {
      type: 'array',
      maxItems: 6,
      items: matchupInsightSchema,
    },
  },
};
