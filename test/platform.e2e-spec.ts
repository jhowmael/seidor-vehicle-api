import { createTestApp, createVehicle, resetDatabase, type TestApp } from './support/app.js';

let ctx: TestApp;

const SECURED = [{ 'api-key': [] }];

beforeAll(async () => {
  ctx = await createTestApp();
  await resetDatabase(ctx.prisma);
});

afterAll(async () => {
  await ctx.close();
});

describe('GET /health', () => {
  it('responde 200 quando o banco está acessível', async () => {
    const response = await ctx.http().get('/health').expect(200);
    expect(response.body).toEqual({ status: 'ok', database: 'up' });
  });

  it('responde 503 quando o banco cai', async () => {
    const broken = await createTestApp({
      override: (builder, { PrismaService }) =>
        builder.overrideProvider(PrismaService).useValue({ $queryRaw: () => Promise.reject(new Error('conexão recusada')) }),
    });
    try {
      const response = await broken.http().get('/health').expect(503);
      expect(response.body).toEqual({ status: 'error', database: 'down' });
    } finally {
      await broken.close();
    }
  });
});

describe('documentação', () => {
  it('serve o Swagger em /docs', async () => {
    const html = await ctx.http().get('/docs').redirects(1).expect(200);
    expect(html.text).toContain('swagger-ui');
  });

  it('publica o documento OpenAPI com a chave de API e todas as rotas do case', async () => {
    const { body } = await ctx.http().get('/docs-json').expect(200);

    expect(body.components.securitySchemes['api-key']).toEqual(
      expect.objectContaining({ type: 'apiKey', in: 'header', name: 'x-api-key' }),
    );
    expect(Object.keys(body.paths).sort()).toEqual([
      '/drivers',
      '/drivers/{id}',
      '/health',
      '/usages',
      '/usages/{id}/finish',
      '/vehicles',
      '/vehicles/{id}',
    ]);
    expect(Object.keys(body.paths['/vehicles']).sort()).toEqual(['get', 'post']);
    expect(Object.keys(body.paths['/vehicles/{id}']).sort()).toEqual(['delete', 'get', 'patch']);
    expect(Object.keys(body.paths['/drivers']).sort()).toEqual(['get', 'post']);
    expect(Object.keys(body.paths['/drivers/{id}']).sort()).toEqual(['delete', 'get', 'patch']);
    expect(Object.keys(body.paths['/usages']).sort()).toEqual(['get', 'post']);
    expect(Object.keys(body.paths['/usages/{id}/finish'])).toEqual(['patch']);
    expect(body.components.schemas.ErrorResponseDto).toBeDefined();
    expect(body.components.schemas.HealthStatus.enum).toEqual(['ok', 'error']);
  });

  it('exige a chave de API nas rotas de negócio e não no /health', async () => {
    const { body } = await ctx.http().get('/docs-json').expect(200);

    for (const [path, operations] of Object.entries<Record<string, { security?: unknown }>>(body.paths)) {
      if (path === '/health') continue;
      for (const [method, operation] of Object.entries(operations)) expect(operation.security, `${method} ${path}`).toEqual(SECURED);
    }
    expect(body.paths['/health'].get.security).toBeUndefined();
  });
});

describe('x-request-id', () => {
  it('gera um identificador quando a requisição não envia', async () => {
    const response = await ctx.http().get('/vehicles').expect(200);
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('gera um identificador diferente a cada requisição', async () => {
    const first = await ctx.http().get('/vehicles').expect(200);
    const second = await ctx.http().get('/vehicles').expect(200);
    expect(first.headers['x-request-id']).not.toBe(second.headers['x-request-id']);
  });

  it('devolve o identificador recebido quando válido', async () => {
    const response = await ctx.http().get('/vehicles').set('x-request-id', 'teste-123').expect(200);
    expect(response.headers['x-request-id']).toBe('teste-123');
  });

  it('substitui o identificador recebido quando inseguro', async () => {
    const unsafe = await ctx.http().get('/vehicles').set('x-request-id', 'valor com espaço').expect(200);
    expect(unsafe.headers['x-request-id']).not.toBe('valor com espaço');
    expect(unsafe.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);

    const tooLong = 'a'.repeat(129);
    const long = await ctx.http().get('/vehicles').set('x-request-id', tooLong).expect(200);
    expect(long.headers['x-request-id']).not.toBe(tooLong);
    expect(long.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('também é enviado nas respostas de erro', async () => {
    const response = await ctx.http().get('/rota-que-nao-existe').set('x-request-id', 'erro-456').expect(404);
    expect(response.headers['x-request-id']).toBe('erro-456');
  });
});

describe('cabeçalhos de segurança e CORS', () => {
  it('aplica o nosniff do helmet', async () => {
    const response = await ctx.http().get('/vehicles').expect(200);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('libera a origem configurada e expõe X-Request-Id', async () => {
    const response = await ctx.http().get('/vehicles').set('Origin', 'http://localhost:5173').expect(200);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(response.headers['access-control-expose-headers']).toMatch(/X-Request-Id/);
  });

  it('não libera origens fora da lista', async () => {
    const response = await ctx.http().get('/vehicles').set('Origin', 'http://outra-origem.example').expect(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('responde ao preflight aceitando x-api-key e x-request-id', async () => {
    const response = await ctx
      .http()
      .options('/vehicles')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,x-api-key,x-request-id')
      .expect(204);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(response.headers['access-control-allow-headers']).toMatch(/x-api-key/i);
    expect(response.headers['access-control-allow-headers']).toMatch(/x-request-id/i);
  });
});

describe('formato único de erro', () => {
  it('responde 404 para rota inexistente', async () => {
    const response = await ctx.http().get('/rota-que-nao-existe').expect(404);
    expect(response.body).toEqual({ statusCode: 404, error: 'Not Found', message: 'Rota não encontrada.', errors: [] });
  });

  it('responde 400 para JSON malformado', async () => {
    const response = await ctx.http().post('/vehicles').set('Content-Type', 'application/json').send('{"plate":').expect(400);
    expect(response.body).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: 'O corpo da requisição não é um JSON válido.',
      errors: [],
    });
  });

  it('responde 400 com a lista de violações na validação', async () => {
    const response = await ctx.http().post('/vehicles').send({ plate: 'invalida' }).expect(400);
    expect(response.body.statusCode).toBe(400);
    expect(response.body.error).toBe('Bad Request');
    expect(response.body.message).toBe(response.body.errors[0].message);
    expect(response.body.errors).toEqual([
      { field: 'plate', message: 'Placa inválida: use o formato ABC1234 ou ABC1D23.' },
      { field: 'color', message: 'Informe a cor.' },
      { field: 'brand', message: 'Informe a marca.' },
    ]);
  });

  it('responde 400 em português para corpo que não é um objeto', async () => {
    const response = await ctx.http().patch('/vehicles/00000000-0000-4000-8000-000000000000').send([]).expect(400);
    expect(response.body).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: 'O corpo da requisição deve ser um objeto.',
      errors: [{ field: 'body', message: 'O corpo da requisição deve ser um objeto.' }],
    });
  });

  it('responde 400 em português para endereço com codificação inválida', async () => {
    const response = await ctx.http().get('/vehicles/%E0%A4%A').expect(400);
    expect(response.body).toEqual({ statusCode: 400, error: 'Bad Request', message: 'Endereço com codificação inválida.', errors: [] });
  });

  it('responde 415 em português para codificação de corpo não suportada', async () => {
    const response = await ctx
      .http()
      .post('/drivers')
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', 'br2')
      .send('{"name":"Ana"}')
      .expect(415);
    expect(response.body).toEqual({
      statusCode: 415,
      error: 'Unsupported Media Type',
      message: 'Tipo ou codificação do corpo não suportado.',
      errors: [],
    });
  });

  it('recusa campos que não fazem parte do contrato', async () => {
    const response = await ctx.http().post('/drivers').send({ name: 'Ana Souza', admin: true }).expect(400);
    expect(response.body).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: 'O campo admin não é permitido.',
      errors: [{ field: 'admin', message: 'O campo admin não é permitido.' }],
    });
  });

  it('responde 400 para identificador que não é UUID', async () => {
    const response = await ctx.http().get('/vehicles/abc').expect(400);
    expect(response.body).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Identificador inválido: informe um UUID.',
      errors: [],
    });
  });

  it('usa o mesmo formato para 404 e 409 das regras de negócio', async () => {
    const missing = await ctx.http().get('/vehicles/00000000-0000-4000-8000-000000000000').expect(404);
    expect(missing.body).toEqual({ statusCode: 404, error: 'Not Found', message: 'Automóvel não encontrado.', errors: [] });

    await createVehicle(ctx, { plate: 'PLT1A23' });
    const duplicated = await ctx.http().post('/vehicles').send({ plate: 'plt-1a23', color: 'Azul', brand: 'Ford' }).expect(409);
    expect(duplicated.body).toEqual({
      statusCode: 409,
      error: 'Conflict',
      message: 'Já existe um automóvel cadastrado com a placa PLT1A23.',
      errors: [],
    });
  });
});
