import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from './public.decorator.js';

export const API_KEY_HEADER = 'x-api-key';

export const API_KEY_SECURITY = 'api-key';

const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();

export function safeEqual(received: string, expected: string): boolean {
  return timingSafeEqual(digest(received), digest(expected));
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly expected: string | null;

  constructor(
    private readonly reflector: Reflector,
    config: ConfigService,
  ) {
    this.expected = config.get<string>('API_KEY')?.trim() || null;
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.expected) return true;
    if (context.getType() !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const header = context.switchToHttp().getRequest<Request>().headers[API_KEY_HEADER];
    const received = Array.isArray(header) ? header[0] : header;
    if (typeof received === 'string' && received.length > 0 && safeEqual(received, this.expected)) return true;

    throw new UnauthorizedException('Chave de API ausente ou inválida. Envie o cabeçalho x-api-key.');
  }
}
