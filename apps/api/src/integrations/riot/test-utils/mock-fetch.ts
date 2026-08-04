export type MockFetchCall = {
  url: string;
  init?: RequestInit;
};

export type MockFetchResponse = {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  textBody?: string;
};

export function createMockFetch(handlers: Array<MockFetchResponse | (() => MockFetchResponse)>) {
  const calls: MockFetchCall[] = [];
  let index = 0;

  const fetchFn: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });

    if (index >= handlers.length) {
      throw new Error(`Unexpected fetch call to ${url}`);
    }

    const handler = handlers[index++];
    if (handler === undefined) {
      throw new Error(`Unexpected fetch call to ${url}`);
    }
    const configured = typeof handler === 'function' ? handler() : handler;

    if (configured.status === 0) {
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      throw error;
    }

    const headers = new Headers(configured.headers ?? {});
    if (!headers.has('content-type') && configured.body !== undefined) {
      headers.set('content-type', 'application/json');
    }

    const body =
      configured.textBody !== undefined
        ? configured.textBody
        : configured.body === undefined
          ? ''
          : JSON.stringify(configured.body);

    return new Response(body, {
      status: configured.status,
      headers,
    });
  };

  return { fetchFn, calls };
}

export function realConfigOverrides(
  overrides: Partial<{
    apiKey: string;
    timeoutMs: number;
    maxRetries: number;
    maxRetryDelayMs: number;
    baseDomain: string;
    providerMode: 'real' | 'mock';
  }> = {},
) {
  return {
    apiKey: 'test-riot-api-key-not-real',
    timeoutMs: 1000,
    maxRetries: 2,
    maxRetryDelayMs: 50,
    baseDomain: 'api.riotgames.com',
    providerMode: 'real' as const,
    ...overrides,
  };
}
