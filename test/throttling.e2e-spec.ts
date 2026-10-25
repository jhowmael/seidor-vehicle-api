import { createTestApp, type TestApp } from './support/app.js';

let ctx: TestApp;

beforeAll(async () => {
  ctx = await createTestApp({ env: { THROTTLE_LIMIT: '3', THROTTLE_TTL_SECONDS: '60' } });
});

afterAll(async () => {
  await ctx.close();
});

describe('limite de requisições', () => {
  it('responde 429 depois de THROTTLE_LIMIT requisições na janela', async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) await ctx.http().get('/vehicles').expect(200);

    const blocked = await ctx.http().get('/vehicles').expect(429);
    expect(blocked.body).toEqual({
      statusCode: 429,
      error: 'Too Many Requests',
      message: 'Muitas requisições. Aguarde um instante e tente novamente.',
      errors: [],
    });
    expect(blocked.headers['retry-after']).toBeDefined();
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(blocked.headers['retry-after'])).toBeLessThanOrEqual(60);
    expect(blocked.headers['x-request-id']).toBeDefined();
  });

  it('não limita /health', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) await ctx.http().get('/health').expect(200);
  });
});
