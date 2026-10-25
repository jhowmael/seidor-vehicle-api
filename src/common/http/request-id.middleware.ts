import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

const VALID_ID = /^[A-Za-z0-9._:-]{1,128}$/;

const logger = new Logger('HTTP');

export const requestIdOf = (response: Response): string | undefined => {
  const value: unknown = response.locals['requestId'];
  return typeof value === 'string' ? value : undefined;
};

export function requestIdMiddleware(request: Request, response: Response, next: NextFunction) {
  const incoming = request.headers[REQUEST_ID_HEADER];
  const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
  const requestId = candidate && VALID_ID.test(candidate) ? candidate : randomUUID();
  const startedAt = process.hrtime.bigint();

  response.locals['requestId'] = requestId;
  response.setHeader(REQUEST_ID_HEADER, requestId);

  response.on('finish', () => {
    const elapsed = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const line = `${request.method} ${request.originalUrl} ${response.statusCode} ${elapsed.toFixed(1)}ms requestId=${requestId}`;
    if (response.statusCode >= 500) logger.error(line);
    else if (response.statusCode >= 400) logger.warn(line);
    else logger.log(line);
  });

  next();
}
