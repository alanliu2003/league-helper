export type AiValidationDiagnostic = {
  code: string;
  kind?: string;
  reason?: string;
  handle?: string;
  token?: string;
  details?: {
    reason?: string;
    handle?: string;
    token?: string;
  };
};

export class AiOutputValidationError extends Error {
  readonly retryable = false;
  override readonly cause: AiValidationDiagnostic;

  constructor(message: string, options: { cause: AiValidationDiagnostic }) {
    super(message, { cause: options.cause });
    this.name = 'AiOutputValidationError';
    this.cause = options.cause;
  }
}

export function readAiValidationDiagnostic(cause: AiValidationDiagnostic): {
  code: string;
  reason?: string;
  handle?: string;
  token?: string;
} {
  const reason = cause.details?.reason ?? cause.reason;
  const handle = cause.details?.handle ?? cause.handle;
  const token = cause.details?.token ?? cause.token;
  return {
    code: cause.code,
    ...(reason ? { reason } : {}),
    ...(handle ? { handle } : {}),
    ...(token ? { token } : {}),
  };
}
