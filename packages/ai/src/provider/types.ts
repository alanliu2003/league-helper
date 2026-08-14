export type AiGenerationRequest = {
  system: string;
  user: string;
  jsonSchema: Record<string, unknown>;
  jsonSchemaName: string;
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
};

export type AiGenerationRawResult = {
  content: string;
  structuredOutputMode: 'json_schema' | 'json_object';
};

export interface AiProvider {
  readonly id: string;
  generate(request: AiGenerationRequest): Promise<AiGenerationRawResult>;
}

export type OpenAiCompatibleProviderConfig = {
  baseUrl: string;
  model: string;
  apiKey?: string;
  fetchFn?: typeof fetch;
};
