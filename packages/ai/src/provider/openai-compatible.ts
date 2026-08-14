import { AiProviderError } from './errors';
import type {
  AiGenerationRawResult,
  AiGenerationRequest,
  AiProvider,
  OpenAiCompatibleProviderConfig,
} from './types';

type StructuredOutputMode = AiGenerationRawResult['structuredOutputMode'];

export class OpenAiCompatibleProvider implements AiProvider {
  readonly id = 'openai_compatible';

  private readonly baseUrl: string;
  private readonly model: string;
  private readonly apiKey: string | undefined;
  private readonly fetchFn: typeof fetch;

  constructor(config: OpenAiCompatibleProviderConfig) {
    this.baseUrl = config.baseUrl;
    this.model = config.model;
    this.apiKey = config.apiKey;
    this.fetchFn = config.fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  async generate(request: AiGenerationRequest): Promise<AiGenerationRawResult> {
    return this.postCompletion(request, 'json_schema', true);
  }

  private async postCompletion(
    request: AiGenerationRequest,
    mode: StructuredOutputMode,
    allowJsonObjectFallback: boolean,
  ): Promise<AiGenerationRawResult> {
    const url = joinUrl(this.baseUrl, '/chat/completions');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const apiKey = this.apiKey?.trim();
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user },
          ],
          temperature: request.temperature,
          max_tokens: request.maxOutputTokens,
          response_format: buildResponseFormat(request, mode),
        }),
        signal: createTimeoutSignal(request.timeoutMs),
      });
    } catch (error) {
      throw wrapFetchError(error);
    }

    const bodyText = await readResponseText(response);
    if (!response.ok) {
      if (
        allowJsonObjectFallback &&
        isUnsupportedJsonSchemaMode(response.status, bodyText)
      ) {
        return this.postCompletion(request, 'json_object', false);
      }
      throw httpStatusError(response.status);
    }

    const content = readMessageContent(parseJsonBody(bodyText)) ?? '';
    return { content, structuredOutputMode: mode };
  }
}

function buildResponseFormat(
  request: AiGenerationRequest,
  mode: StructuredOutputMode,
): Record<string, unknown> {
  if (mode === 'json_object') {
    return { type: 'json_object' };
  }
  return {
    type: 'json_schema',
    json_schema: {
      name: request.jsonSchemaName,
      strict: true,
      schema: request.jsonSchema,
    },
  };
}

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const suffix = path.replace(/^\/+/, '');
  return `${base}/${suffix}`;
}

function createTimeoutSignal(timeoutMs: number): AbortSignal {
  if (typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}

async function readResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch (error) {
    throw wrapFetchError(error);
  }
}

function parseJsonBody(bodyText: string): unknown {
  try {
    return JSON.parse(bodyText) as unknown;
  } catch (error) {
    throw new AiProviderError('AI provider returned invalid JSON.', {
      retryable: true,
      cause: error,
    });
  }
}

function readMessageContent(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null || !('choices' in payload)) {
    return undefined;
  }
  const choices = (payload as { choices: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return undefined;
  }
  const first = choices[0];
  if (typeof first !== 'object' || first === null || !('message' in first)) {
    return undefined;
  }
  const message = (first as { message: unknown }).message;
  if (typeof message !== 'object' || message === null || !('content' in message)) {
    return undefined;
  }
  const content = (message as { content: unknown }).content;
  return typeof content === 'string' ? content : undefined;
}

function isUnsupportedJsonSchemaMode(status: number, body: string): boolean {
  if (status !== 400 && status !== 422) {
    return false;
  }
  const lower = body.toLowerCase();
  return (
    lower.includes('json_schema') ||
    lower.includes('response_format') ||
    lower.includes('json schema')
  );
}

function isAbortError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('name' in error)) {
    return false;
  }
  const name = (error as { name: unknown }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}

function wrapFetchError(error: unknown): AiProviderError {
  if (error instanceof AiProviderError) {
    return error;
  }
  if (isAbortError(error)) {
    return new AiProviderError('AI provider request aborted due to timeout.', {
      retryable: true,
      cause: error,
    });
  }
  return new AiProviderError('AI provider request failed.', {
    retryable: true,
    cause: error,
  });
}

function httpStatusError(status: number): AiProviderError {
  const retryable = status === 429 || status >= 500;
  return new AiProviderError(`AI provider request failed with HTTP ${status}.`, {
    retryable,
    statusCode: status,
  });
}
