export class AiProviderError extends Error {
  readonly retryable: boolean;
  readonly statusCode?: number;

  constructor(
    message: string,
    options: { retryable: boolean; statusCode?: number; cause?: unknown },
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AiProviderError';
    this.retryable = options.retryable;
    if (options.statusCode !== undefined) {
      this.statusCode = options.statusCode;
    }
  }
}
