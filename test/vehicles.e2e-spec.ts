import { createDriver, createTestApp, createVehicle, hoursAgo, resetDatabase, type TestApp } from './support/app.js';

let ctx: TestApp;

const UNKNOWN_ID = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
const PLATE_MESSAGE = 'Placa inválida: use o formato ABC1234 ou ABC1D23.';
const IN_USE_MESSAGE = 'O automóvel está em uso e não pode ser excluído. Finalize a utilização antes.';

const plates = (body: { plate: string }[]) => body.map((vehicle) => vehicle.plate);

const listPlates = async (query: Record<string, string> = {}) => plates((await ctx.http().get('/vehicles').query(query).expect(200)).body);

const startUsage = async (vehicleId: string, driverId: string) => {
  const response = await ctx
    .http()
    .post('/usages')
    .send({ vehicleId, driverId, startedAt: hoursAgo(1), reason: 'Visita ao cliente' })
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

describe('POST /vehicles', () => {
  it('cadastra com a placa normalizada e devolve exatamente id, placa, cor e marca', async () => {
    const response = await ctx.http().post('/vehicles').send({ plate: ' abc-1d23 ', color: '  Prata ', brand: ' Fiat  ' }).expect(201);

    expect(response.body).toEqual({ id: expect.any(String), plate: 'ABC1D23', color: 'Prata', brand: 'Fiat' });
    expect(response.body.id).toMatch(/^[0-9a-f-]{36}$/);

    const found = await ctx.http().get(`/vehicles/${response.body.id}`).expect(200);
    expect(found.body).toEqual(response.body);
  });

  it('aceita a placa no padrão antigo', async () => {
    const response = await ctx.http().post('/vehicles').send({ plate: 'xyz 9876', color: 'Preto', brand: 'Chevrolet' }).expect(201);
    expect(response.body.plate).toBe('XYZ9876');
  });

  it('responde 409 para placa já cadastrada, inclusive escrita de outro jeito', async () => {
    await createVehicle(ctx, { plate: 'ABC1D23' });

    const same = await ctx.http().post('/vehicles').send({ plate: 'ABC1D23', color: 'Preto', brand: 'Toyota' }).expect(409);
    expect(same.body).toEqual({
      statusCode: 409,
      error: 'Conflict',
      message: 'Já existe um automóvel cadastrado com a placa ABC1D23.',
      errors: [],
    });

    const variant = await ctx.http().post('/vehicles').send({ plate: 'abc-1d23', color: 'Preto', brand: 'Toyota' }).expect(409);
    expect(variant.body.message).toBe('Já existe um automóvel cadastrado com a placa ABC1D23.');

    expect(await listPlates()).toEqual(['ABC1D23']);
  });

  it('rejeita placa inválida com 400 no formato padrão de erro', async () => {
    const response = await ctx.http().post('/vehicles').send({ plate: 'AB12345', color: 'Prata', brand: 'Fiat' }).expect(400);
    expect(response.body).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: PLATE_MESSAGE,
      errors: [{ field: 'plate', message: PLATE_MESSAGE }],
    });
  });

  it('rejeita cor e marca vazias ou ausentes', async () => {
    const blank = await ctx.http().post('/vehicles').send({ plate: 'ABC1D23', color: '   ', brand: '' }).expect(400);
    expect(blank.body.errors).toEqual([
      { field: 'color', message: 'Informe a cor.' },
      { field: 'brand', message: 'Informe a marca.' },
    ]);

    const missing = await ctx.http().post('/vehicles').send({}).expect(400);
    const fields = missing.body.errors.map((error: { field: string }) => error.field);
    expect([...new Set(fields)]).toEqual(['plate', 'color', 'brand']);
    expect(missing.body.message).toBe(missing.body.errors[0].message);
  });

  it('rejeita campo desconhecido com 400 e não cadastra nada', async () => {
    const response = await ctx.http().post('/vehicles').send({ plate: 'ABC1D23', color: 'Prata', brand: 'Fiat', year: 2020 }).expect(400);
    expect(response.body).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: 'O campo year não é permitido.',
      errors: [{ field: 'year', message: 'O campo year não é permitido.' }],
    });
    expect(await listPlates()).toEqual([]);
  });
});

describe('GET /vehicles', () => {
  beforeEach(async () => {
    await createVehicle(ctx, { plate: 'DDD4D44', color: 'Prata', brand: 'Toyota' });
    await createVehicle(ctx, { plate: 'BBB2B22', color: 'Prata Metálico', brand: 'Fiat' });
    await createVehicle(ctx, { plate: 'CCC3333', color: 'Preto', brand: 'Toyota' });
    await createVehicle(ctx, { plate: 'AAA1111', color: 'Prata', brand: 'Fiat' });
  });

  it('lista todos ordenados pela placa', async () => {
    const response = await ctx.http().get('/vehicles').expect(200);
    expect(plates(response.body)).toEqual(['AAA1111', 'BBB2B22', 'CCC3333', 'DDD4D44']);
    expect(response.body[0]).toEqual({ id: expect.any(String), plate: 'AAA1111', color: 'Prata', brand: 'Fiat' });
  });

  it('filtra pela cor exata sem diferenciar maiúsculas', async () => {
    expect(await listPlates({ color: 'prata' })).toEqual(['AAA1111', 'DDD4D44']);
    expect(await listPlates({ color: 'PRATA' })).toEqual(['AAA1111', 'DDD4D44']);
    expect(await listPlates({ color: 'prata metálico' })).toEqual(['BBB2B22']);
    expect(await listPlates({ color: 'Prat' })).toEqual([]);
  });

  it('filtra pela marca', async () => {
    expect(await listPlates({ brand: 'fiat' })).toEqual(['AAA1111', 'BBB2B22']);
    expect(await listPlates({ brand: ' Toyota ' })).toEqual(['CCC3333', 'DDD4D44']);
    expect(await listPlates({ brand: 'Honda' })).toEqual([]);
  });

  it('combina cor e marca', async () => {
    expect(await listPlates({ color: 'prata', brand: 'toyota' })).toEqual(['DDD4D44']);
    expect(await listPlates({ color: 'preto', brand: 'fiat' })).toEqual([]);
  });

  it('ignora filtros em branco', async () => {
    expect(await listPlates({ color: '', brand: '   ' })).toEqual(['AAA1111', 'BBB2B22', 'CCC3333', 'DDD4D44']);
    expect(await listPlates({ color: '  ', brand: 'fiat' })).toEqual(['AAA1111', 'BBB2B22']);
  });

  it('trata curingas do filtro como texto', async () => {
    expect(await listPlates({ color: '%' })).toEqual([]);
    expect(await listPlates({ color: 'pr%' })).toEqual([]);
    expect(await listPlates({ color: 'Prat_' })).toEqual([]);
    expect(await listPlates({ brand: 'F_at' })).toEqual([]);
  });

  it('rejeita parâmetro de filtro desconhecido', async () => {
    const response = await ctx.http().get('/vehicles').query({ model: 'Uno' }).expect(400);
    expect(response.body.errors).toEqual([{ field: 'model', message: 'O campo model não é permitido.' }]);
  });
});

describe('GET /vehicles/:id', () => {
  it('devolve o automóvel', async () => {
    const vehicle = await createVehicle(ctx, { plate: 'ABC1D23', color: 'Branco', brand: 'Volkswagen' });
    const response = await ctx.http().get(`/vehicles/${vehicle.id}`).expect(200);
    expect(response.body).toEqual({ id: vehicle.id, plate: 'ABC1D23', color: 'Branco', brand: 'Volkswagen' });
  });

  it('responde 404 para id inexistente', async () => {
    const response = await ctx.http().get(`/vehicles/${UNKNOWN_ID}`).expect(404);
    expect(response.body).toEqual({ statusCode: 404, error: 'Not Found', message: 'Automóvel não encontrado.', errors: [] });
  });

  it('responde 400 para id que não é UUID', async () => {
    const response = await ctx.http().get('/vehicles/abc').expect(400);
    expect(response.body).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Identificador inválido: informe um UUID.',
      errors: [],
    });
  });
});

describe('PATCH /vehicles/:id', () => {
  it('atualiza só os campos enviados e mantém os demais', async () => {
    const vehicle = await createVehicle(ctx, { plate: 'ABC1D23', color: 'Prata', brand: 'Fiat' });

    const color = await ctx.http().patch(`/vehicles/${vehicle.id}`).send({ color: ' Preto ' }).expect(200);
    expect(color.body).toEqual({ id: vehicle.id, plate: 'ABC1D23', color: 'Preto', brand: 'Fiat' });

    const plate = await ctx.http().patch(`/vehicles/${vehicle.id}`).send({ plate: 'xyz-9876' }).expect(200);
    expect(plate.body).toEqual({ id: vehicle.id, plate: 'XYZ9876', color: 'Preto', brand: 'Fiat' });

    const found = await ctx.http().get(`/vehicles/${vehicle.id}`).expect(200);
    expect(found.body).toEqual({ id: vehicle.id, plate: 'XYZ9876', color: 'Preto', brand: 'Fiat' });
  });

  it('rejeita corpo vazio com 400', async () => {
    const vehicle = await createVehicle(ctx, { plate: 'ABC1D23' });
    const response = await ctx.http().patch(`/vehicles/${vehicle.id}`).send({}).expect(400);
    expect(response.body).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Informe ao menos um campo para atualizar: plate, color ou brand.',
      errors: [],
    });
  });

  it('rejeita placa inválida e cor em branco', async () => {
    const vehicle = await createVehicle(ctx, { plate: 'ABC1D23' });

    const plate = await ctx.http().patch(`/vehicles/${vehicle.id}`).send({ plate: '1234ABC' }).expect(400);
    expect(plate.body.errors).toEqual([{ field: 'plate', message: PLATE_MESSAGE }]);

    const color = await ctx.http().patch(`/vehicles/${vehicle.id}`).send({ color: '  ' }).expect(400);
    expect(color.body.errors).toEqual([{ field: 'color', message: 'Informe a cor.' }]);
  });

  it('rejeita null nos campos com 400', async () => {
    const vehicle = await createVehicle(ctx, { plate: 'ABC1D23' });

    const statuses = [];
    for (const body of [{ plate: null }, { color: null }, { brand: null }]) {
      statuses.push((await ctx.http().patch(`/vehicles/${vehicle.id}`).send(body)).status);
    }
    expect(statuses).toEqual([400, 400, 400]);

    const found = await ctx.http().get(`/vehicles/${vehicle.id}`).expect(200);
    expect(found.body).toEqual(vehicle);
  });

  it('responde 409 ao usar a placa de outro automóvel', async () => {
    const vehicle = await createVehicle(ctx, { plate: 'ABC1D23' });
    await createVehicle(ctx, { plate: 'XYZ9876' });

    const response = await ctx.http().patch(`/vehicles/${vehicle.id}`).send({ plate: 'xyz9876', color: 'Azul' }).expect(409);
    expect(response.body.message).toBe('Já existe um automóvel cadastrado com a placa XYZ9876.');

    const found = await ctx.http().get(`/vehicles/${vehicle.id}`).expect(200);
    expect(found.body).toEqual(vehicle);
  });

  it('aceita a própria placa', async () => {
    const vehicle = await createVehicle(ctx, { plate: 'ABC1D23', color: 'Prata' });
    const response = await ctx.http().patch(`/vehicles/${vehicle.id}`).send({ plate: 'abc1d23', color: 'Vermelho' }).expect(200);
    expect(response.body).toEqual({ id: vehicle.id, plate: 'ABC1D23', color: 'Vermelho', brand: 'Fiat' });
  });

  it('responde 404 para id inexistente e 400 para id inválido', async () => {
    await ctx.http().patch(`/vehicles/${UNKNOWN_ID}`).send({ color: 'Preto' }).expect(404);
    await ctx.http().patch('/vehicles/abc').send({ color: 'Preto' }).expect(400);
  });
});

describe('DELETE /vehicles/:id', () => {
  it('exclui e o automóvel deixa de existir para a API', async () => {
    const vehicle = await createVehicle(ctx, { plate: 'ABC1D23' });
    await createVehicle(ctx, { plate: 'XYZ9876' });

    const response = await ctx.http().delete(`/vehicles/${vehicle.id}`).expect(204);
    expect(response.text).toBe('');

    const found = await ctx.http().get(`/vehicles/${vehicle.id}`).expect(404);
    expect(found.body.message).toBe('Automóvel não encontrado.');
    expect(await listPlates()).toEqual(['XYZ9876']);

    await ctx.http().delete(`/vehicles/${vehicle.id}`).expect(404);
    await ctx.http().patch(`/vehicles/${vehicle.id}`).send({ color: 'Preto' }).expect(404);
  });

  it('libera a placa para um novo cadastro', async () => {
    const vehicle = await createVehicle(ctx, { plate: 'ABC1D23' });
    await ctx.http().delete(`/vehicles/${vehicle.id}`).expect(204);

    const again = await ctx.http().post('/vehicles').send({ plate: 'abc-1d23', color: 'Branco', brand: 'Honda' }).expect(201);
    expect(again.body).toEqual({ id: expect.any(String), plate: 'ABC1D23', color: 'Branco', brand: 'Honda' });
    expect(again.body.id).not.toBe(vehicle.id);
    expect(await listPlates()).toEqual(['ABC1D23']);
  });

  it('libera a placa para outro automóvel via PATCH', async () => {
    const removed = await createVehicle(ctx, { plate: 'ABC1D23' });
    const other = await createVehicle(ctx, { plate: 'XYZ9876' });
    await ctx.http().delete(`/vehicles/${removed.id}`).expect(204);

    const response = await ctx.http().patch(`/vehicles/${other.id}`).send({ plate: 'ABC1D23' }).expect(200);
    expect(response.body.plate).toBe('ABC1D23');
  });

  it('responde 404 para id inexistente e 400 para id inválido', async () => {
    await ctx.http().delete(`/vehicles/${UNKNOWN_ID}`).expect(404);
    await ctx.http().delete('/vehicles/abc').expect(400);
  });

  it('responde 409 para automóvel em uso e permite excluir depois de finalizar', async () => {
    const vehicle = await createVehicle(ctx, { plate: 'ABC1D23' });
    const driver = await createDriver(ctx, 'Ana Souza');
    const usage = await startUsage(vehicle.id, driver.id);

    const blocked = await ctx.http().delete(`/vehicles/${vehicle.id}`).expect(409);
    expect(blocked.body).toEqual({ statusCode: 409, error: 'Conflict', message: IN_USE_MESSAGE, errors: [] });
    await ctx.http().get(`/vehicles/${vehicle.id}`).expect(200);

    await ctx.http().patch(`/usages/${usage.id}/finish`).send({}).expect(200);

    await ctx.http().delete(`/vehicles/${vehicle.id}`).expect(204);
    await ctx.http().get(`/vehicles/${vehicle.id}`).expect(404);
  });
});
