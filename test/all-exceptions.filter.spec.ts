import {
  type ArgumentsHost,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Logger,
  MethodNotAllowedException,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter.js';
import { Prisma } from '../src/generated/prisma/client.js';

interface Written {
  status?: number;
  body?: { statusCode: number; error: string; message: string; errors: { field: string; message: string }[] };
}

const CLIENT_VERSION = '7.10.1';

const PERIOD_MESSAGE = 'O automóvel ou o motorista já possui uma utilização no período informado.';
const DUPLICATE_MESSAGE = 'Já existe um registro com esses dados.';
const REFERENCE_MESSAGE = 'Referência inválida: o registro relacionado não existe.';
const INTEGRITY_MESSAGE = 'A operação viola uma regra de integridade dos dados.';
const CONCURRENCY_MESSAGE = 'A operação conflitou com outra alteração simultânea. Tente novamente.';
const DATABASE_ERROR_MESSAGE = 'Erro interno ao acessar o banco de dados.';
const UNAVAILABLE_MESSAGE = 'Banco de dados indisponível. Tente novamente em instantes.';
const INVALID_JSON_MESSAGE = 'O corpo da requisição não é um JSON válido.';

let errorLog: ReturnType<typeof vi.spyOn>;
let warnLog: ReturnType<typeof vi.spyOn>;

function fakeResponse(options: { headersSent?: boolean; requestId?: string } = {}) {
  const written: Written = {};
  const response = {
    headersSent: options.headersSent ?? false,
    locals: options.requestId === undefined ? {} : { requestId: options.requestId },
    status: vi.fn((code: number) => {
      written.status = code;
      return response;
    }),
    json: vi.fn((body: Written['body']) => {
      written.body = body;
      return response;
    }),
  };
  return { response, written };
}

function handle(exception: unknown, options: { headersSent?: boolean; requestId?: string } = {}) {
  const { response, written } = fakeResponse(options);
  const host = {
    switchToHttp: () => ({ getResponse: () => response, getRequest: () => ({}), getNext: () => undefined }),
    getType: () => 'http',
  } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(exception, host);
  return { response, written };
}

const translate = (exception: unknown) => {
  const { written } = handle(exception);
  expect(written.status).toBe(written.body?.statusCode);
  return written.body!;
};

const knownError = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError(`Falha ${code}`, { code, clientVersion: CLIENT_VERSION, meta });

const adapterError = (cause: Record<string, unknown>, code = 'P2010') => knownError(code, { driverAdapterError: { cause } });

const errorWithCause = (cause: Record<string, unknown>, message = 'falha no driver') => new Error(message, { cause });

beforeEach(() => {
  errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  warnLog = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AllExceptionsFilter: HttpException', () => {
  it('usa a mensagem em texto e devolve o formato padrão de erro', () => {
    const { written } = handle(new HttpException('Automóvel não encontrado.', HttpStatus.NOT_FOUND));
    expect(written.status).toBe(404);
    expect(written.body).toEqual({ statusCode: 404, error: 'Not Found', message: 'Automóvel não encontrado.', errors: [] });
  });

  it('usa a mensagem das exceções do Nest criadas com texto', () => {
    expect(translate(new ConflictException('O automóvel está em uso.'))).toEqual({
      statusCode: 409,
      error: 'Conflict',
      message: 'O automóvel está em uso.',
      errors: [],
    });
  });

  it('repassa message e errors quando a exceção traz a lista de violações', () => {
    const errors = [
      { field: 'endedAt', message: 'A data de término não pode estar no futuro.' },
      { field: 'startedAt', message: 'Outra regra.' },
    ];
    expect(translate(new UnprocessableEntityException({ message: errors[0].message, errors }))).toEqual({
      statusCode: 422,
      error: 'Unprocessable Entity',
      message: 'A data de término não pode estar no futuro.',
      errors,
    });
  });

  it('descarta itens de errors fora do formato campo e mensagem', () => {
    const valid = { field: 'plate', message: 'Placa inválida.' };
    const body = translate(
      new BadRequestException({ message: 'Placa inválida.', errors: [valid, { field: 1, message: 'x' }, 'texto', null, { field: 'a' }] }),
    );
    expect(body.errors).toEqual([valid]);
  });

  it('usa a primeira violação como mensagem quando não há message', () => {
    const errors = [{ field: 'name', message: 'Informe o nome do motorista.' }];
    expect(translate(new HttpException({ errors }, HttpStatus.BAD_REQUEST))).toMatchObject({
      message: 'Informe o nome do motorista.',
      errors,
    });
  });

  it('usa a primeira mensagem quando message é uma lista', () => {
    expect(translate(new BadRequestException(['Primeira mensagem.', 'Segunda mensagem.'])).message).toBe('Primeira mensagem.');
  });

  it('usa a mensagem genérica do status quando não há mensagem nem violações', () => {
    expect(translate(new HttpException({}, HttpStatus.FORBIDDEN))).toEqual({
      statusCode: 403,
      error: 'Forbidden',
      message: 'Acesso negado.',
      errors: [],
    });
  });

  it.each([
    [400, new BadRequestException(), 'Requisição inválida.'],
    [401, new UnauthorizedException(), 'Não autenticado.'],
    [403, new ForbiddenException(), 'Acesso negado.'],
    [404, new NotFoundException(), 'Recurso não encontrado.'],
    [405, new MethodNotAllowedException(), 'Método não permitido.'],
    [409, new ConflictException(), 'Conflito ao processar a requisição.'],
    [413, new PayloadTooLargeException(), 'Corpo da requisição muito grande.'],
    [422, new UnprocessableEntityException(), 'Não foi possível processar a requisição.'],
    [429, new HttpException('Too Many Requests', 429), 'Muitas requisições. Aguarde um instante e tente novamente.'],
    [500, new HttpException('Internal Server Error', 500), 'Erro interno do servidor.'],
    [503, new ServiceUnavailableException(), 'Serviço indisponível.'],
  ])('traduz a mensagem padrão em inglês do status %i', (status, exception, message) => {
    expect(translate(exception)).toMatchObject({ statusCode: status, message, errors: [] });
  });

  it('traduz rota inexistente do Express', () => {
    expect(translate(new NotFoundException('Cannot GET /x'))).toMatchObject({ statusCode: 404, message: 'Rota não encontrada.' });
    expect(translate(new NotFoundException('Cannot DELETE /vehicles'))).toMatchObject({ statusCode: 404, message: 'Rota não encontrada.' });
  });

  it('traduz qualquer 429 para a mensagem de limite de requisições', () => {
    expect(translate(new HttpException('ThrottlerException: Too Many Requests', 429)).message).toBe(
      'Muitas requisições. Aguarde um instante e tente novamente.',
    );
  });

  it('traduz erros de JSON e de endereço com codificação inválida em 400', () => {
    expect(translate(new BadRequestException('Unexpected token } in JSON at position 10')).message).toBe(INVALID_JSON_MESSAGE);
    expect(translate(new BadRequestException("Failed to decode param '%E0%A4%A'")).message).toBe('Endereço com codificação inválida.');
  });

  it('não registra log de erro para respostas 4xx', () => {
    translate(new NotFoundException());
    translate(new ConflictException('Conflito.'));
    expect(errorLog).not.toHaveBeenCalled();
  });
});

describe('AllExceptionsFilter: erros do Prisma', () => {
  it.each([
    ['P2002', 409, 'Conflict', DUPLICATE_MESSAGE],
    ['P2025', 404, 'Not Found', 'Registro não encontrado.'],
    ['P2003', 422, 'Unprocessable Entity', REFERENCE_MESSAGE],
    ['P2034', 409, 'Conflict', CONCURRENCY_MESSAGE],
  ])('traduz %s em %i', (code, status, error, message) => {
    expect(translate(knownError(code))).toEqual({ statusCode: status, error, message, errors: [] });
  });

  it('responde 500 para código do Prisma sem tradução e registra o erro', () => {
    expect(translate(knownError('P2000'))).toEqual({
      statusCode: 500,
      error: 'Internal Server Error',
      message: DATABASE_ERROR_MESSAGE,
      errors: [],
    });
    expect(errorLog).toHaveBeenCalledTimes(1);
  });
});

describe('AllExceptionsFilter: códigos do PostgreSQL', () => {
  it('traduz 23P01 (exclusão de período) em 409 com a mensagem de período', () => {
    expect(translate(adapterError({ kind: 'postgres', originalCode: '23P01' }))).toEqual({
      statusCode: 409,
      error: 'Conflict',
      message: PERIOD_MESSAGE,
      errors: [],
    });
    expect(translate(errorWithCause({ kind: 'postgres', originalCode: '23P01' }))).toMatchObject({
      statusCode: 409,
      message: PERIOD_MESSAGE,
    });
  });

  it('dá prioridade ao código do PostgreSQL sobre o código do Prisma', () => {
    expect(translate(adapterError({ kind: 'UniqueConstraintViolation', originalCode: '23P01' }, 'P2002'))).toMatchObject({
      statusCode: 409,
      message: PERIOD_MESSAGE,
    });
    expect(translate(adapterError({ originalCode: '23503' }, 'P2025'))).toMatchObject({ statusCode: 422, message: REFERENCE_MESSAGE });
  });

  it('aceita o código em cause.code quando não há originalCode', () => {
    expect(translate(errorWithCause({ code: '23505' }))).toMatchObject({ statusCode: 409, message: DUPLICATE_MESSAGE });
    expect(translate(adapterError({ code: '23505' }))).toMatchObject({ statusCode: 409, message: DUPLICATE_MESSAGE });
  });

  it.each([
    ['23505', 409, DUPLICATE_MESSAGE],
    ['23503', 422, REFERENCE_MESSAGE],
    ['23514', 422, INTEGRITY_MESSAGE],
    ['23502', 422, INTEGRITY_MESSAGE],
    ['22021', 400, 'O texto enviado contém caracteres inválidos.'],
    ['40001', 409, CONCURRENCY_MESSAGE],
    ['40P01', 409, CONCURRENCY_MESSAGE],
    ['42P01', 500, DATABASE_ERROR_MESSAGE],
  ])('traduz %s em %i', (code, status, message) => {
    expect(translate(adapterError({ kind: 'postgres', originalCode: code }))).toMatchObject({ statusCode: status, message, errors: [] });
    expect(translate(errorWithCause({ kind: 'postgres', originalCode: code }))).toMatchObject({ statusCode: status, message, errors: [] });
  });

  it('registra aviso com o detalhe da regra de integridade violada', () => {
    translate(errorWithCause({ originalCode: '23514' }, 'Falha\nnew row violates check constraint "usages_period_check"\n'));
    expect(warnLog).toHaveBeenCalledWith(
      'Regra de integridade do banco violada (23514): new row violates check constraint "usages_period_check"',
    );
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('ignora códigos que não seguem o formato do PostgreSQL', () => {
    expect(translate(errorWithCause({ code: 'ECONNRESET' }))).toMatchObject({ statusCode: 500, message: 'Erro interno do servidor.' });
    expect(translate(adapterError({ code: '2350' }, 'P2002'))).toMatchObject({ statusCode: 409, message: DUPLICATE_MESSAGE });
  });
});

describe('AllExceptionsFilter: banco indisponível', () => {
  it('responde 503 quando o Prisma não consegue inicializar', () => {
    expect(translate(new Prisma.PrismaClientInitializationError("Can't reach database server", CLIENT_VERSION))).toEqual({
      statusCode: 503,
      error: 'Service Unavailable',
      message: UNAVAILABLE_MESSAGE,
      errors: [],
    });
    expect(errorLog).toHaveBeenCalledTimes(1);
  });

  it.each(['DatabaseNotReachable', 'ConnectionClosed', 'SocketTimeout', 'TooManyConnections'])(
    'responde 503 para falha do tipo %s',
    (kind) => {
      expect(translate(errorWithCause({ kind }))).toMatchObject({ statusCode: 503, message: UNAVAILABLE_MESSAGE });
      expect(translate(adapterError({ kind }))).toMatchObject({ statusCode: 503, message: UNAVAILABLE_MESSAGE });
    },
  );

  it('não trata outros tipos de falha do driver como indisponibilidade', () => {
    expect(translate(errorWithCause({ kind: 'LengthMismatch' }))).toMatchObject({ statusCode: 500 });
  });
});

describe('AllExceptionsFilter: erros do body-parser', () => {
  it('traduz JSON inválido em 400', () => {
    expect(translate({ type: 'entity.parse.failed', status: 400, message: 'Unexpected token' })).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: INVALID_JSON_MESSAGE,
      errors: [],
    });
  });

  it('traduz corpo grande demais em 413', () => {
    expect(translate({ type: 'entity.too.large', status: 413, expose: true, message: 'request entity too large' })).toEqual({
      statusCode: 413,
      error: 'Payload Too Large',
      message: 'Corpo da requisição muito grande.',
      errors: [],
    });
  });

  it('traduz codificação do corpo não suportada em 415', () => {
    expect(translate({ type: 'encoding.unsupported', status: 415, expose: true, message: 'unsupported content encoding "br2"' })).toEqual({
      statusCode: 415,
      error: 'Unsupported Media Type',
      message: 'Tipo ou codificação do corpo não suportado.',
      errors: [],
    });
  });

  it('traduz outros erros de cliente sem mensagem própria em 400 genérico', () => {
    expect(translate({ statusCode: 400, expose: true, message: 'incorrect header check' })).toMatchObject({
      statusCode: 400,
      message: 'Requisição inválida.',
    });
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('não confia no status de erros que não são de cliente', () => {
    expect(translate({ status: 404, message: 'interno' })).toMatchObject({ statusCode: 500 });
    expect(translate({ status: 503, expose: true, message: 'interno' })).toMatchObject({ statusCode: 500 });
  });
});

describe('AllExceptionsFilter: erros inesperados', () => {
  it('responde 500 genérico sem vazar a mensagem original', () => {
    expect(translate(new Error('senha do banco: segredo'))).toEqual({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Erro interno do servidor.',
      errors: [],
    });
  });

  it.each([['texto solto'], [null], [undefined], [42], [{ qualquer: 'coisa' }]])('responde 500 para o valor lançado %j', (value) => {
    expect(translate(value)).toMatchObject({ statusCode: 500, message: 'Erro interno do servidor.' });
  });

  it('registra o erro com o requestId da resposta', () => {
    handle(new Error('boom'), { requestId: 'req-123' });
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(errorLog.mock.calls[0][0]).toMatch(/^requestId=req-123 Error: boom/);

    handle('falha em texto');
    expect(errorLog.mock.calls[1][0]).toBe('requestId=- falha em texto');
  });
});

describe('AllExceptionsFilter: resposta já enviada', () => {
  it('não escreve nada quando os cabeçalhos já foram enviados', () => {
    const { response } = handle(new NotFoundException('Automóvel não encontrado.'), { headersSent: true });
    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).not.toHaveBeenCalled();
  });

  it('ainda registra o erro 500 quando os cabeçalhos já foram enviados', () => {
    const { response } = handle(new Error('falhou no meio do envio'), { headersSent: true });
    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledTimes(1);
  });
});
