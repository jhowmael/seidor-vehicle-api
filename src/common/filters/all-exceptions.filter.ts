import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { STATUS_CODES } from 'node:http';
import { Prisma } from '../../generated/prisma/client.js';
import type { ErrorResponseDto, RuleViolationResponseDto } from '../http/error-response.dto.js';
import { requestIdOf } from '../http/request-id.middleware.js';

interface Translated {
  status: number;
  message: string;
  errors?: RuleViolationResponseDto[];
}

const GENERIC_MESSAGES: Partial<Record<number, string>> = {
  400: 'Requisição inválida.',
  401: 'Não autenticado.',
  403: 'Acesso negado.',
  404: 'Recurso não encontrado.',
  405: 'Método não permitido.',
  409: 'Conflito ao processar a requisição.',
  413: 'Corpo da requisição muito grande.',
  415: 'Tipo ou codificação do corpo não suportado.',
  422: 'Não foi possível processar a requisição.',
  429: 'Muitas requisições. Aguarde um instante e tente novamente.',
  500: 'Erro interno do servidor.',
  503: 'Serviço indisponível.',
};

const ENGLISH_DEFAULTS = new Set([
  'Bad Request',
  'Unauthorized',
  'Forbidden',
  'Not Found',
  'Method Not Allowed',
  'Conflict',
  'Payload Too Large',
  'Unprocessable Entity',
  'Too Many Requests',
  'Internal Server Error',
  'Service Unavailable',
]);

const INVALID_JSON_MESSAGE = 'O corpo da requisição não é um JSON válido.';

const UNAVAILABLE_KINDS = new Set(['DatabaseNotReachable', 'ConnectionClosed', 'SocketTimeout', 'TooManyConnections']);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const isViolation = (value: unknown): value is RuleViolationResponseDto =>
  isRecord(value) && typeof value['field'] === 'string' && typeof value['message'] === 'string';

const firstString = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.find((item): item is string => typeof item === 'string');
  return undefined;
};

function driverCauses(exception: unknown): Record<string, unknown>[] {
  if (!isRecord(exception)) return [];
  const causes: unknown[] = [exception['cause']];
  const meta = exception['meta'];
  if (isRecord(meta) && isRecord(meta['driverAdapterError'])) causes.push(meta['driverAdapterError']['cause']);
  return causes.filter(isRecord);
}

function postgresCode(exception: unknown): string | undefined {
  for (const cause of driverCauses(exception)) {
    const code = cause['originalCode'] ?? cause['code'];
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
  }
  return undefined;
}

function clientErrorStatus(exception: unknown): number | undefined {
  if (!isRecord(exception) || exception['expose'] !== true) return undefined;
  const status = exception['status'] ?? exception['statusCode'];
  return typeof status === 'number' && status >= 400 && status < 500 ? status : undefined;
}

function isDatabaseUnavailable(exception: unknown): boolean {
  if (exception instanceof Prisma.PrismaClientInitializationError) return true;
  return driverCauses(exception).some((cause) => typeof cause['kind'] === 'string' && UNAVAILABLE_KINDS.has(cause['kind']));
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const translated = this.translate(exception);

    if (translated.status >= 500) {
      const detail = exception instanceof Error ? (exception.stack ?? exception.message) : String(exception);
      this.logger.error(`requestId=${requestIdOf(response) ?? '-'} ${detail}`);
    }

    const body: ErrorResponseDto = {
      statusCode: translated.status,
      error: STATUS_CODES[translated.status] ?? 'Error',
      message: translated.message,
      errors: translated.errors ?? [],
    };

    if (response.headersSent) return;
    response.status(translated.status).json(body);
  }

  private translate(exception: unknown): Translated {
    if (exception instanceof HttpException) return this.fromHttp(exception);

    if (isDatabaseUnavailable(exception)) {
      return { status: HttpStatus.SERVICE_UNAVAILABLE, message: 'Banco de dados indisponível. Tente novamente em instantes.' };
    }

    const code = postgresCode(exception);
    if (code) return this.fromPostgres(code, exception);

    if (exception instanceof Prisma.PrismaClientKnownRequestError) return this.fromPrisma(exception);

    if (isRecord(exception) && exception['type'] === 'entity.parse.failed') {
      return { status: HttpStatus.BAD_REQUEST, message: INVALID_JSON_MESSAGE };
    }

    const clientStatus = clientErrorStatus(exception);
    if (clientStatus) return { status: clientStatus, message: GENERIC_MESSAGES[clientStatus] ?? GENERIC_MESSAGES[400]! };

    return { status: HttpStatus.INTERNAL_SERVER_ERROR, message: GENERIC_MESSAGES[500]! };
  }

  private fromHttp(exception: HttpException): Translated {
    const status = exception.getStatus();
    const payload = exception.getResponse();
    const errors = isRecord(payload) && Array.isArray(payload['errors']) ? payload['errors'].filter(isViolation) : [];
    const raw = typeof payload === 'string' ? payload : isRecord(payload) ? firstString(payload['message']) : undefined;
    const message = raw === undefined ? undefined : this.localize(status, raw);

    return { status, message: message ?? errors[0]?.message ?? GENERIC_MESSAGES[status] ?? exception.message, errors };
  }

  private localize(status: number, message: string): string | undefined {
    if (status === HttpStatus.NOT_FOUND && /^Cannot [A-Z]+ /.test(message)) return 'Rota não encontrada.';
    if (status === HttpStatus.TOO_MANY_REQUESTS) return GENERIC_MESSAGES[429];
    if (status === HttpStatus.BAD_REQUEST && /\bJSON\b/.test(message)) return INVALID_JSON_MESSAGE;
    if (status === HttpStatus.BAD_REQUEST && message.startsWith('Failed to decode param')) return 'Endereço com codificação inválida.';
    if (ENGLISH_DEFAULTS.has(message)) return GENERIC_MESSAGES[status];
    return message;
  }

  private fromPostgres(code: string, exception: unknown): Translated {
    switch (code) {
      case '23514':
      case '23502': {
        const detail = exception instanceof Error ? exception.message.split('\n').filter(Boolean).at(-1) : '';
        this.logger.warn(`Regra de integridade do banco violada (${code}): ${detail}`);
        return { status: HttpStatus.UNPROCESSABLE_ENTITY, message: 'A operação viola uma regra de integridade dos dados.' };
      }
      case '23503':
        return { status: HttpStatus.UNPROCESSABLE_ENTITY, message: 'Referência inválida: o registro relacionado não existe.' };
      case '23505':
        return { status: HttpStatus.CONFLICT, message: 'Já existe um registro com esses dados.' };
      case '22021':
        return { status: HttpStatus.BAD_REQUEST, message: 'O texto enviado contém caracteres inválidos.' };
      case '23P01':
        return { status: HttpStatus.CONFLICT, message: 'O automóvel ou o motorista já possui uma utilização no período informado.' };
      case '40001':
      case '40P01':
        return { status: HttpStatus.CONFLICT, message: 'A operação conflitou com outra alteração simultânea. Tente novamente.' };
      default:
        return { status: HttpStatus.INTERNAL_SERVER_ERROR, message: 'Erro interno ao acessar o banco de dados.' };
    }
  }

  private fromPrisma(exception: Prisma.PrismaClientKnownRequestError): Translated {
    switch (exception.code) {
      case 'P2025':
        return { status: HttpStatus.NOT_FOUND, message: 'Registro não encontrado.' };
      case 'P2002':
        return { status: HttpStatus.CONFLICT, message: 'Já existe um registro com esses dados.' };
      case 'P2003':
        return { status: HttpStatus.UNPROCESSABLE_ENTITY, message: 'Referência inválida: o registro relacionado não existe.' };
      case 'P2034':
        return { status: HttpStatus.CONFLICT, message: 'A operação conflitou com outra alteração simultânea. Tente novamente.' };
      default:
        return { status: HttpStatus.INTERNAL_SERVER_ERROR, message: 'Erro interno ao acessar o banco de dados.' };
    }
  }
}
