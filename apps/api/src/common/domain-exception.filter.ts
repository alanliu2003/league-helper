import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { DomainError, serializeDomainError, type DomainErrorCode } from '@league-helper/shared';
import type { Response } from 'express';

const STATUS_BY_CODE: Record<DomainErrorCode, number> = {
  INVALID_RIOT_ID: HttpStatus.BAD_REQUEST,
  UNSUPPORTED_PLATFORM_ROUTE: HttpStatus.BAD_REQUEST,
  INVALID_REGIONAL_ROUTE: HttpStatus.BAD_REQUEST,
  VALIDATION_ERROR: HttpStatus.BAD_REQUEST,
  INVALID_CURSOR: HttpStatus.BAD_REQUEST,
  RESOURCE_NOT_FOUND: HttpStatus.NOT_FOUND,
  ACCOUNT_IDENTITY_CONFLICT: HttpStatus.CONFLICT,
  REFRESH_IN_PROGRESS: HttpStatus.CONFLICT,
  REFRESH_COOLDOWN: HttpStatus.TOO_MANY_REQUESTS,
  PROVIDER_RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  PROVIDER_NOT_CONFIGURED: HttpStatus.SERVICE_UNAVAILABLE,
  PROVIDER_UNAUTHORIZED: HttpStatus.FORBIDDEN,
  PROVIDER_FORBIDDEN: HttpStatus.FORBIDDEN,
  PROVIDER_RESPONSE_INVALID: HttpStatus.BAD_GATEWAY,
  PROVIDER_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  QUEUE_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  DATABASE_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
};

@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof DomainError) {
      const status = STATUS_BY_CODE[exception.code] ?? HttpStatus.INTERNAL_SERVER_ERROR;
      response.status(status).json(serializeDomainError(exception));
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      response
        .status(status)
        .json(
          typeof body === 'string'
            ? { success: false, error: { code: 'VALIDATION_ERROR', message: body } }
            : body,
        );
      return;
    }

    this.logger.error({
      message: 'Unhandled exception',
      error: exception instanceof Error ? exception.message : 'unknown',
    });
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: 'PROVIDER_UNAVAILABLE',
        message: 'An unexpected error occurred.',
      },
    });
  }
}
