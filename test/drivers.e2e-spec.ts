import { createDriver, createTestApp, createVehicle, hoursAgo, resetDatabase, type TestApp } from './support/app.js';

let ctx: TestApp;

const UNKNOWN_ID = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
const NAME_REQUIRED = 'Informe o nome do motorista.';
const DRIVING_MESSAGE = 'O motorista está utilizando um automóvel e não pode ser excluído. Finalize a utilização antes.';

const names = (body: { name: string }[]) => body.map((driver) => driver.name);

const listNames = async (query: Record<string, string> = {}) => names((await ctx.http().get('/drivers').query(query).expect(200)).body);

const startUsage = async (vehicleId: string, driverId: string) => {
  const response = await ctx
    .http()
    .post('/usages')
    .send({ vehicleId, driverId, startedAt: hoursAgo(1), reason: 'Entrega de documentos' })
    .expect(201);
  return response.body as { id: string };
};

beforeAll(async () => {
  ctx = await createTestApp();
});

afterAll(async () => {
  await ctx.close();
});

beforeEach(async () => {
  await resetDatabase(ctx.prisma);
});

describe('POST /drivers', () => {
  it('cadastra com o nome sem espaços nas pontas e devolve exatamente id e nome', async () => {
    const response = await ctx.http().post('/drivers').send({ name: '  Ana Souza  ' }).expect(201);

    expect(response.body).toEqual({ id: expect.any(String), name: 'Ana Souza' });
    expect(response.body.id).toMatch(/^[0-9a-f-]{36}$/);

    const found = await ctx.http().get(`/drivers/${response.body.id}`).expect(200);
    expect(found.body).toEqual(response.body);
  });

  it('rejeita nome em branco com 400', async () => {
    const response = await ctx.http().post('/drivers').send({ name: '   ' }).expect(400);
    expect(response.body).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: NAME_REQUIRED,
      errors: [{ field: 'name', message: NAME_REQUIRED }],
    });
    expect(await listNames()).toEqual([]);
  });

  it('rejeita nome ausente, não textual ou longo demais', async () => {
    const missing = await ctx.http().post('/drivers').send({}).expect(400);
    expect(missing.body.errors).toEqual([{ field: 'name', message: NAME_REQUIRED }]);

    const numeric = await ctx.http().post('/drivers').send({ name: 123 }).expect(400);
    expect(numeric.body.errors).toEqual([{ field: 'name', message: 'Nome inválido.' }]);

    const long = await ctx
      .http()
      .post('/drivers')
      .send({ name: 'a'.repeat(121) })
      .expect(400);
    expect(long.body.errors).toEqual([{ field: 'name', message: 'O nome deve ter no máximo 120 caracteres.' }]);

    await ctx
      .http()
      .post('/drivers')
      .send({ name: 'a'.repeat(120) })
      .expect(201);
  });

  it('rejeita caractere nulo no nome com 400, sem erro interno', async () => {
    const response = await ctx.http().post('/drivers').send({ name: 'Ana\u0000Souza' }).expect(400);
    expect(response.body).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: 'O texto enviado contém caracteres inválidos.',
      errors: [],
    });
    await ctx.http().get('/drivers').query({ name: '\u0000' }).expect(400);
  });

  it('rejeita campo desconhecido', async () => {
    const response = await ctx.http().post('/drivers').send({ name: 'Ana Souza', cnh: '123' }).expect(400);
    expect(response.body.errors).toEqual([{ field: 'cnh', message: 'O campo cnh não é permitido.' }]);
  });

  it('permite nomes repetidos', async () => {
    const first = await createDriver(ctx, 'Ana Souza');
    const second = await createDriver(ctx, 'Ana Souza');

    expect(second.id).not.toBe(first.id);
    expect(await listNames()).toEqual(['Ana Souza', 'Ana Souza']);
  });
});

describe('GET /drivers', () => {
  beforeEach(async () => {
    await createDriver(ctx, 'Carla Mendes');
    await createDriver(ctx, 'Mariana Alves');
    await createDriver(ctx, 'Ana Souza');
    await createDriver(ctx, 'Bruno Lima');
  });

  it('lista todos ordenados pelo nome', async () => {
    const response = await ctx.http().get('/drivers').expect(200);
    expect(names(response.body)).toEqual(['Ana Souza', 'Bruno Lima', 'Carla Mendes', 'Mariana Alves']);
    expect(response.body[0]).toEqual({ id: expect.any(String), name: 'Ana Souza' });
  });

  it('filtra por parte do nome sem diferenciar maiúsculas', async () => {
    expect(await listNames({ name: 'ana' })).toEqual(['Ana Souza', 'Mariana Alves']);
    expect(await listNames({ name: 'LIMA' })).toEqual(['Bruno Lima']);
    expect(await listNames({ name: ' souza ' })).toEqual(['Ana Souza']);
    expect(await listNames({ name: 'Pedro' })).toEqual([]);
  });

  it('ignora filtro em branco', async () => {
    expect(await listNames({ name: '   ' })).toEqual(['Ana Souza', 'Bruno Lima', 'Carla Mendes', 'Mariana Alves']);
  });

  it('trata curingas do filtro como texto', async () => {
    await createDriver(ctx, 'Jo_o 100%');
    expect(await listNames({ name: '%' })).toEqual(['Jo_o 100%']);
    expect(await listNames({ name: '_' })).toEqual(['Jo_o 100%']);
  });
});

describe('GET /drivers/:id', () => {
  it('devolve o motorista', async () => {
    const driver = await createDriver(ctx, 'Bruno Lima');
    const response = await ctx.http().get(`/drivers/${driver.id}`).expect(200);
    expect(response.body).toEqual({ id: driver.id, name: 'Bruno Lima' });
  });

  it('responde 404 para id inexistente', async () => {
    const response = await ctx.http().get(`/drivers/${UNKNOWN_ID}`).expect(404);
    expect(response.body).toEqual({ statusCode: 404, error: 'Not Found', message: 'Motorista não encontrado.', errors: [] });
  });

  it('responde 400 para id que não é UUID', async () => {
    const response = await ctx.http().get('/drivers/123').expect(400);
    expect(response.body).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Identificador inválido: informe um UUID.',
      errors: [],
    });
  });
});

describe('PATCH /drivers/:id', () => {
  it('renomeia removendo espaços nas pontas', async () => {
    const driver = await createDriver(ctx, 'Ana Souza');

    const response = await ctx.http().patch(`/drivers/${driver.id}`).send({ name: '  Ana Souza Lima ' }).expect(200);
    expect(response.body).toEqual({ id: driver.id, name: 'Ana Souza Lima' });

    const found = await ctx.http().get(`/drivers/${driver.id}`).expect(200);
    expect(found.body).toEqual({ id: driver.id, name: 'Ana Souza Lima' });
  });

  it('exige o nome', async () => {
    const driver = await createDriver(ctx, 'Ana Souza');

    const empty = await ctx.http().patch(`/drivers/${driver.id}`).send({}).expect(400);
    expect(empty.body.errors.map((error: { field: string }) => error.field)).toContain('name');

    const blank = await ctx.http().patch(`/drivers/${driver.id}`).send({ name: ' ' }).expect(400);
    expect(blank.body.errors).toEqual([{ field: 'name', message: NAME_REQUIRED }]);

    await ctx.http().patch(`/drivers/${driver.id}`).send({ name: null }).expect(400);

    const found = await ctx.http().get(`/drivers/${driver.id}`).expect(200);
    expect(found.body).toEqual(driver);
  });

  it('responde 404 para id inexistente e 400 para id inválido', async () => {
    const missing = await ctx.http().patch(`/drivers/${UNKNOWN_ID}`).send({ name: 'Ana Souza' }).expect(404);
    expect(missing.body.message).toBe('Motorista não encontrado.');
    await ctx.http().patch('/drivers/abc').send({ name: 'Ana Souza' }).expect(400);
  });
});

describe('DELETE /drivers/:id', () => {
  it('exclui e o motorista deixa de existir para a API', async () => {
    const driver = await createDriver(ctx, 'Ana Souza');
    await createDriver(ctx, 'Bruno Lima');

    const response = await ctx.http().delete(`/drivers/${driver.id}`).expect(204);
    expect(response.text).toBe('');

    await ctx.http().get(`/drivers/${driver.id}`).expect(404);
    expect(await listNames()).toEqual(['Bruno Lima']);

    await ctx.http().delete(`/drivers/${driver.id}`).expect(404);
    await ctx.http().patch(`/drivers/${driver.id}`).send({ name: 'Outro Nome' }).expect(404);
  });

  it('responde 404 para id inexistente e 400 para id inválido', async () => {
    const response = await ctx.http().delete(`/drivers/${UNKNOWN_ID}`).expect(404);
    expect(response.body.message).toBe('Motorista não encontrado.');
    await ctx.http().delete('/drivers/abc').expect(400);
  });

  it('responde 409 para motorista utilizando um automóvel e permite excluir depois de finalizar', async () => {
    const vehicle = await createVehicle(ctx, { plate: 'ABC1D23' });
    const driver = await createDriver(ctx, 'Ana Souza');
    const usage = await startUsage(vehicle.id, driver.id);

    const blocked = await ctx.http().delete(`/drivers/${driver.id}`).expect(409);
    expect(blocked.body).toEqual({ statusCode: 409, error: 'Conflict', message: DRIVING_MESSAGE, errors: [] });
    await ctx.http().get(`/drivers/${driver.id}`).expect(200);

    await ctx.http().patch(`/usages/${usage.id}/finish`).send({}).expect(200);

    await ctx.http().delete(`/drivers/${driver.id}`).expect(204);
    await ctx.http().get(`/drivers/${driver.id}`).expect(404);
  });

  it('não impede um novo motorista com o mesmo nome do excluído', async () => {
    const driver = await createDriver(ctx, 'Ana Souza');
    await ctx.http().delete(`/drivers/${driver.id}`).expect(204);

    const again = await createDriver(ctx, 'Ana Souza');
    expect(again.id).not.toBe(driver.id);
    expect(await listNames()).toEqual(['Ana Souza']);
  });
});
