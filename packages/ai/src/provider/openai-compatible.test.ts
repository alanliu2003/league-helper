import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AiProviderError } from './errors';
import { OpenAiCompatibleProvider } from './openai-compatible';

const PROVIDER_SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'openai-compatible.ts'),
  'utf8',
);

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { ok: { type: 'boolean' } },
  required: ['ok'],
};

const BASE_REQUEST = {
  system: 'system prompt',
  user: 'user prompt',
  jsonSchema: SCHEMA,
  jsonSchemaName: 'test_schema',
  temperature: 0.2,
  maxOutputTokens: 1200,
  timeoutMs: 5_000,
};

function jsonResponse(status: number, body: unknown): Response {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(payload, {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function completionResponse(content: string, status = 200): Response {
  return jsonResponse(status, {
    choices: [{ message: { content } }],
  });
}

type FetchCall = {
  url: string;
  init?: RequestInit;
};

function createQueuedFetch(responses: Response[]): { fetchFn: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const queue = [...responses];
  const fetchFn: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    const next = queue.shift();
    if (!next) {
      throw new Error('Unexpected extra fetch call.');
    }
    return next;
  };
  return { fetchFn, calls };
}

function requestBody(call: FetchCall | undefined): Record<string, unknown> {
  expect(call).toBeDefined();
  return JSON.parse(String(call?.init?.body)) as Record<string, unknown>;
}

function createProvider(
  fetchFn: typeof fetch,
  overrides: { baseUrl?: string; model?: string; apiKey?: string } = {},
): OpenAiCompatibleProvider {
  return new OpenAiCompatibleProvider({
    baseUrl: overrides.baseUrl ?? 'http://localhost:11434/v1',
    model: overrides.model ?? 'test-model',
    apiKey: overrides.apiKey,
    fetchFn,
  });
}

async function expectProviderError(
  action: () => Promise<unknown>,
  expected: { retryable: boolean; statusCode?: number },
): Promise<AiProviderError> {
  let thrown: unknown;
  try {
    await action();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(AiProviderError);
  const providerError = thrown as AiProviderError;
  expect(providerError.retryable).toBe(expected.retryable);
  if (expected.statusCode !== undefined) {
    expect(providerError.statusCode).toBe(expected.statusCode);
  }
  return providerError;
}

describe('OpenAiCompatibleProvider', () => {
  it('has openai_compatible id and does not import Zod insight schemas', () => {
    const { fetchFn } = createQueuedFetch([completionResponse('{"ok":true}')]);
    const provider = createProvider(fetchFn);
    expect(provider.id).toBe('openai_compatible');
    expect(PROVIDER_SOURCE).not.toContain('ChampionAiStoredInsightSchema');
    expect(PROVIDER_SOURCE).not.toContain("from 'zod'");
  });

  it('returns json_schema content on 200', async () => {
    const { fetchFn, calls } = createQueuedFetch([completionResponse('{"ok":true}')]);
    const provider = createProvider(fetchFn, {
      baseUrl: 'http://localhost:11434/v1/',
      model: 'custom-model',
      apiKey: 'test-secret',
    });

    const result = await provider.generate(BASE_REQUEST);

    expect(result).toEqual({
      content: '{"ok":true}',
      structuredOutputMode: 'json_schema',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://localhost:11434/v1/chat/completions');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.init?.headers).toMatchObject({
      Authorization: 'Bearer test-secret',
      'Content-Type': 'application/json',
    });

    const body = requestBody(calls[0]);
    expect(body.model).toBe('custom-model');
    expect(body.temperature).toBe(0.2);
    expect(body.max_tokens).toBe(1200);
    expect(body.messages).toEqual([
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'user prompt' },
    ]);
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: {
        name: 'test_schema',
        strict: true,
        schema: SCHEMA,
      },
    });
  });

  it('retries once with json_object when json_schema is unsupported', async () => {
    const { fetchFn, calls } = createQueuedFetch([
      jsonResponse(400, { error: { message: 'json_schema response_format is not supported' } }),
      completionResponse('{"ok":true}'),
    ]);
    const provider = createProvider(fetchFn, { apiKey: '' });

    const result = await provider.generate(BASE_REQUEST);

    expect(result).toEqual({
      content: '{"ok":true}',
      structuredOutputMode: 'json_object',
    });
    expect(calls).toHaveLength(2);
    expect(requestBody(calls[0]).response_format).toMatchObject({ type: 'json_schema' });
    expect(requestBody(calls[1]).response_format).toEqual({ type: 'json_object' });
    expect(calls[0]?.init?.headers).not.toHaveProperty('Authorization');
  });

  it('retries once with json_object on 422 invalid response_format type', async () => {
    const { fetchFn, calls } = createQueuedFetch([
      jsonResponse(422, { error: { message: 'invalid response_format type' } }),
      completionResponse('{"ok":true}'),
    ]);
    const provider = createProvider(fetchFn);

    const result = await provider.generate(BASE_REQUEST);

    expect(result).toEqual({
      content: '{"ok":true}',
      structuredOutputMode: 'json_object',
    });
    expect(calls).toHaveLength(2);
    expect(requestBody(calls[1]).response_format).toEqual({ type: 'json_object' });
  });

  it('retries once when json_schema is not a valid response_format type', async () => {
    const { fetchFn, calls } = createQueuedFetch([
      jsonResponse(400, {
        error: { message: "'json_schema' is not a valid response_format type" },
      }),
      completionResponse('{"ok":true}'),
    ]);
    const provider = createProvider(fetchFn);

    const result = await provider.generate(BASE_REQUEST);

    expect(result).toEqual({
      content: '{"ok":true}',
      structuredOutputMode: 'json_object',
    });
    expect(calls).toHaveLength(2);
    expect(requestBody(calls[0]).response_format).toMatchObject({ type: 'json_schema' });
    expect(requestBody(calls[1]).response_format).toEqual({ type: 'json_object' });
  });

  it('does not fallback for an unrelated 400', async () => {
    const { fetchFn, calls } = createQueuedFetch([
      jsonResponse(400, { error: { message: 'invalid temperature' } }),
    ]);
    const provider = createProvider(fetchFn);

    await expectProviderError(() => provider.generate(BASE_REQUEST), {
      retryable: false,
      statusCode: 400,
    });
    expect(calls).toHaveLength(1);
  });

  it('returns empty content on 200 when message content is missing', async () => {
    const { fetchFn } = createQueuedFetch([
      jsonResponse(200, { choices: [{ message: { content: null } }] }),
    ]);
    const provider = createProvider(fetchFn);

    const result = await provider.generate(BASE_REQUEST);

    expect(result).toEqual({
      content: '',
      structuredOutputMode: 'json_schema',
    });
  });

  it('maps HTTP 500 to a retryable error', async () => {
    const { fetchFn } = createQueuedFetch([jsonResponse(500, { error: { message: 'boom' } })]);
    const provider = createProvider(fetchFn);

    await expectProviderError(() => provider.generate(BASE_REQUEST), {
      retryable: true,
      statusCode: 500,
    });
  });

  it('maps abort/timeout to a retryable timeout error', async () => {
    const fetchFn: typeof fetch = async (_input, init) => {
      const signal = init?.signal;
      if (signal == null) {
        throw new Error('Expected an abort signal.');
      }
      return await new Promise<Response>((_resolve, reject) => {
        const abort = () => {
          const error = new Error('The operation was aborted.');
          error.name = 'TimeoutError';
          reject(error);
        };
        if (signal.aborted) {
          abort();
          return;
        }
        signal.addEventListener('abort', abort, { once: true });
      });
    };
    const provider = createProvider(fetchFn);

    const error = await expectProviderError(
      () => provider.generate({ ...BASE_REQUEST, timeoutMs: 20 }),
      { retryable: true },
    );
    expect(error.message.toLowerCase()).toMatch(/timeout|abort/);
  });

  it('maps HTTP 401 to a non-retryable error', async () => {
    const { fetchFn } = createQueuedFetch([jsonResponse(401, { error: { message: 'unauthorized' } })]);
    const provider = createProvider(fetchFn, { apiKey: 'bad' });

    await expectProviderError(() => provider.generate(BASE_REQUEST), {
      retryable: false,
      statusCode: 401,
    });
  });
});
