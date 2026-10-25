import { createTestApp, resetDatabase, type TestApp } from './support/app.js';

const API_KEY = 'chave-de-teste-0123456789';

const UNAUTHORIZED = {
  statusCode: 401,
  error: 'Unauthorized',
  message: 'Chave de API ausente ou inválida. Envie o cabeçalho x-api-key.',
  errors: [],
};

const MISSING_ID = '00000000-0000-4000-8000-000000000000';

let ctx: TestApp;

beforeAll(async () => {
  ctx = await createTestApp({ env: { API_KEY } });
  await resetDatabase(ctx.prisma);
});

afterAll(async () => {
  await ctx.close();
});

describe('chave de API (API_KEY definida)', () => {
  it('responde 401 sem a chave', async () => {
    const response = await ctx.http().get('/vehicles').expect(401);
    expect(response.body).toEqual(UNAUTHORIZED);
  });

  it('responde 401 com a chave errada', async () => {
    const wrong = await ctx.http().get('/vehicles').set('x-api-key', 'errada').expect(401);
    expect(wrong.body).toEqual(UNAUTHORIZED);

    await ctx.http().get('/vehicles').set('x-api-key', `${API_KEY}x`).expect(401);
    await ctx.http().get('/vehicles').set('x-api-key', API_KEY.slice(0, -1)).expect(401);
    await ctx.http().get('/vehicles').set('x-api-key', API_KEY.toUpperCase()).expect(401);
  });

  it('protege todas as rotas de negócio', async () => {
    const routes: [string, () => ReturnType<ReturnType<TestApp['http']>['get']>][] = [
      ['GET /vehicles', () => ctx.http().get('/vehicles')],
      ['GET /vehicles/:id', () => ctx.http().get(`/vehicles/${MISSING_ID}`)],
      ['POST /vehicles', () => ctx.http().post('/vehicles').send({ plate: 'ABC1D23', color: 'Prata', brand: 'Fiat' })],
      ['PATCH /vehicles/:id', () => ctx.http().patch(`/vehicles/${MISSING_ID}`).send({ color: 'Azul' })],
      ['DELETE /vehicles/:id', () => ctx.http().delete(`/vehicles/${MISSING_ID}`)],
      ['GET /drivers', () => ctx.http().get('/drivers')],
      ['GET /drivers/:id', () => ctx.http().get(`/drivers/${MISSING_ID}`)],
      ['POST /drivers', () => ctx.http().post('/drivers').send({ name: 'Ana Souza' })],
      ['PATCH /drivers/:id', () => ctx.http().patch(`/drivers/${MISSING_ID}`).send({ name: 'Ana' })],
      ['DELETE /drivers/:id', () => ctx.http().delete(`/drivers/${MISSING_ID}`)],
      ['GET /usages', () => ctx.http().get('/usages')],
      ['POST /usages', () => ctx.http().post('/usages').send({ vehicleId: MISSING_ID, driverId: MISSING_ID, reason: 'Visita' })],
      ['PATCH /usages/:id/finish', () => ctx.http().patch(`/usages/${MISSING_ID}/finish`).send({})],
    ];

    for (const [route, send] of routes) {
      const response = await send();
      expect(response.status, route).toBe(401);
      expect(response.body, route).toEqual(UNAUTHORIZED);
    }
  });

  it('verifica a chave antes de validar o corpo', async () => {
    const response = await ctx.http().post('/vehicles').send({ plate: 'invalida' }).expect(401);
    expect(response.body).toEqual(UNAUTHORIZED);
  });

  it('não grava nada quando a chave é recusada', async () => {
    await ctx.http().post('/drivers').send({ name: 'Intruso' }).expect(401);
    expect(await ctx.prisma.driver.count()).toBe(0);
  });

  it('responde normalmente com a chave correta', async () => {
    const empty = await ctx.http().get('/vehicles').set('x-api-key', API_KEY).expect(200);
    expect(empty.body).toEqual([]);

    const created = await ctx
      .http()
      .post('/vehicles')
      .set('x-api-key', API_KEY)
      .send({ plate: 'KEY1A23', color: 'Prata', brand: 'Fiat' })
      .expect(201);
    expect(created.body).toMatchObject({ plate: 'KEY1A23', color: 'Prata', brand: 'Fiat' });

    const listed = await ctx.http().get('/vehicles').set('x-api-key', API_KEY).expect(200);
    expect(listed.body.map((vehicle: { plate: string }) => vehicle.plate)).toEqual(['KEY1A23']);

    await ctx.http().get('/drivers').set('x-api-key', API_KEY).expect(200);
    await ctx.http().get('/usages').set('x-api-key', API_KEY).expect(200);
  });

  it('mantém /health e /docs liberados', async () => {
    const health = await ctx.http().get('/health').expect(200);
    expect(health.body).toEqual({ status: 'ok', database: 'up' });

    await ctx.http().get('/docs').redirects(1).expect(200);
    await ctx.http().get('/docs-json').expect(200);
  });
});
