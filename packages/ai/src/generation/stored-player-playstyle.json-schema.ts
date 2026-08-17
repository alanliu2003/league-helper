export const PLAYER_PLAYSTYLE_STORED_INSIGHT_JSON_SCHEMA_NAME = 'player_playstyle_stored_insight';

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

const championTendencySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['championKey', 'position', 'text', 'evidence'],
  properties: {
    championKey: { type: 'string', minLength: 1 },
    position: {
      type: 'string',
      enum: ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'SUPPORT'],
    },
    text: { type: 'string', minLength: 40, maxLength: 500 },
    evidence: evidenceArraySchema,
  },
} as const;

export const PLAYER_PLAYSTYLE_STORED_INSIGHT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'economy', 'combat', 'strengths', 'tradeoffs', 'championTendencies'],
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
    economy: nullableGroundedClaimSchema,
    combat: nullableGroundedClaimSchema,
    strengths: {
      type: 'array',
      maxItems: 3,
      items: groundedClaimSchema,
    },
    tradeoffs: {
      type: 'array',
      maxItems: 3,
      items: groundedClaimSchema,
    },
    championTendencies: {
      type: 'array',
      maxItems: 3,
      items: championTendencySchema,
    },
  },
};
