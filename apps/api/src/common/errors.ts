export class AppError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode: number,
    options?: { cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', options?: { cause?: unknown }) {
    super(message, 'NOT_FOUND', 404, options);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', options?: { cause?: unknown }) {
    super(message, 'VALIDATION_ERROR', 400, options);
  }
}
