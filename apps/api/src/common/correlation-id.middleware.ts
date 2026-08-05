import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const CORRELATION_ID_HEADER = 'x-correlation-id';

export type RequestWithCorrelationId = Request & { correlationId?: string };

export function correlationIdMiddleware(
  req: RequestWithCorrelationId,
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.header(CORRELATION_ID_HEADER)?.trim();
  const correlationId = incoming && incoming.length > 0 ? incoming : randomUUID();
  req.correlationId = correlationId;
  res.setHeader(CORRELATION_ID_HEADER, correlationId);
  next();
}
