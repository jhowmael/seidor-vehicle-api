import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { API_KEY_HEADER, ApiKeyGuard, safeEqual } from '../src/common/auth/api-key.guard.js';
import { Public } from '../src/common/auth/public.decorator.js';

const KEY = 'chave-secreta-123';
const DENIED_MESSAGE = 'Chave de API ausente ou inválida. Envie o cabeçalho x-api-key.';

class PrivateController {
  list() {
    return [];
  }

  @Public()
  health() {
    return 'ok';
  }
}

@Public()
class PublicController {
  docs() {
    return 'docs';
  }
}

type Headers = Record<string, string | string[] | undefined>;

interface ContextOptions {
  headers?: Headers;
  controller?: new () => object;
  handler?: string;
  type?: string;
}

function contextFor({ headers = {}, controller = PrivateController, handler = 'list', type = 'http' }: ContextOptions = {}) {
  const prototype = controller.prototype as Record<string, unknown>;
  return {
    getType: () => type,
    getClass: () => controller,
    getHandler: () => prototype[handler],
    switchToHttp: () => ({ getRequest: () => ({ headers }), getResponse: () => ({}), getNext: () => undefined }),
  } as unknown as ExecutionContext;
}

const guardWith = (config: Record<string, unknown>) => new ApiKeyGuard(new Reflector(), new ConfigService(config));

const withKey = (value: string | string[] | undefined): Headers => ({ [API_KEY_HEADER]: value });

beforeEach(() => {
  vi.stubEnv('API_KEY', undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('ApiKeyGuard sem chave configurada', () => {
  it('libera todas as rotas quando API_KEY não está definida', () => {
    const guard = guardWith({});
    expect(guard.canActivate(contextFor())).toBe(true);
    expect(guard.canActivate(contextFor({ headers: withKey('qualquer') }))).toBe(true);
  });

  it.each(['', '   '])('trata API_KEY %j como ausente', (value) => {
    expect(guardWith({ API_KEY: value }).canActivate(contextFor())).toBe(true);
  });
});

describe('ApiKeyGuard com chave configurada', () => {
  it('aceita o cabeçalho com a chave correta', () => {
    expect(guardWith({ API_KEY: KEY }).canActivate(contextFor({ headers: withKey(KEY) }))).toBe(true);
  });

  it('ignora espaços em volta da chave configurada', () => {
    expect(guardWith({ API_KEY: `  ${KEY}  ` }).canActivate(contextFor({ headers: withKey(KEY) }))).toBe(true);
  });

  it.each([
    ['ausente', {}],
    ['indefinido', withKey(undefined)],
    ['vazio', withKey('')],
    ['errado', withKey('chave-errada')],
    ['com diferença de maiúsculas', withKey(KEY.toUpperCase())],
    ['mais longo', withKey(`${KEY}4`)],
    ['mais curto', withKey(KEY.slice(0, -1))],
    ['lista vazia', withKey([])],
  ])('rejeita cabeçalho %s com 401 e mensagem em português', (_label, headers) => {
    const guard = guardWith({ API_KEY: KEY });
    const attempt = () => guard.canActivate(contextFor({ headers }));
    expect(attempt).toThrow(UnauthorizedException);
    expect(attempt).toThrow(DENIED_MESSAGE);
  });

  it('não aceita a chave em outro cabeçalho', () => {
    const guard = guardWith({ API_KEY: KEY });
    expect(() => guard.canActivate(contextFor({ headers: { authorization: `Bearer ${KEY}` } }))).toThrow(UnauthorizedException);
  });

  it('usa o primeiro valor quando o cabeçalho vem repetido', () => {
    const guard = guardWith({ API_KEY: KEY });
    expect(guard.canActivate(contextFor({ headers: withKey([KEY, 'outra']) }))).toBe(true);
    expect(() => guard.canActivate(contextFor({ headers: withKey(['outra', KEY]) }))).toThrow(DENIED_MESSAGE);
  });

  it('libera rotas marcadas com @Public no método ou na classe', () => {
    const guard = guardWith({ API_KEY: KEY });
    expect(guard.canActivate(contextFor({ handler: 'health' }))).toBe(true);
    expect(guard.canActivate(contextFor({ controller: PublicController, handler: 'docs' }))).toBe(true);
    expect(() => guard.canActivate(contextFor({ handler: 'list' }))).toThrow(UnauthorizedException);
  });

  it('não exige a chave fora do contexto HTTP', () => {
    expect(guardWith({ API_KEY: KEY }).canActivate(contextFor({ type: 'rpc' }))).toBe(true);
  });

  it('lê a chave do ambiente quando a configuração não a define', () => {
    vi.stubEnv('API_KEY', KEY);
    const guard = guardWith({});
    expect(guard.canActivate(contextFor({ headers: withKey(KEY) }))).toBe(true);
    expect(() => guard.canActivate(contextFor())).toThrow(UnauthorizedException);
  });
});

describe('safeEqual', () => {
  it('compara textos de qualquer tamanho sem lançar erro', () => {
    expect(safeEqual(KEY, KEY)).toBe(true);
    expect(safeEqual('', '')).toBe(true);
    expect(safeEqual('chave-ç-é', 'chave-ç-é')).toBe(true);
    expect(safeEqual(KEY, 'chave-secreta-124')).toBe(false);
    expect(safeEqual(KEY, `${KEY} `)).toBe(false);
    expect(safeEqual('a', 'a'.repeat(1000))).toBe(false);
    expect(safeEqual('', KEY)).toBe(false);
    expect(safeEqual('ABC', 'abc')).toBe(false);
  });
});
