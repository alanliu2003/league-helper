import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Observable } from 'rxjs';
import type { Response } from 'express';
import { CORRELATION_ID_HEADER, type RequestWithCorrelationId } from './correlation-id.middleware';

@Injectable()
export class CorrelationIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<RequestWithCorrelationId>();
    const response = http.getResponse<Response>();

    const correlationId =
      request.correlationId?.trim() ||
      request.header(CORRELATION_ID_HEADER)?.trim() ||
      randomUUID();
    request.correlationId = correlationId;
    response.setHeader(CORRELATION_ID_HEADER, correlationId);

    return next.handle();
  }
}
