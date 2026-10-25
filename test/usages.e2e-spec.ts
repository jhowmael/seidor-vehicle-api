import { createDriver, createTestApp, createVehicle, hoursAgo, resetDatabase, type TestApp } from './support/app.js';

let ctx: TestApp;

const UNKNOWN_ID = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const VEHICLE_BUSY = 'O automóvel já está em uso por um motorista.';
const DRIVER_BUSY = 'O motorista já está utilizando outro automóvel.';
const VEHICLE_BUSY_IN_PERIOD = 'O automóvel já estava em uso no período informado.';
const DRIVER_BUSY_IN_PERIOD = 'O motorista já estava utilizando um automóvel no período informado.';

const start = (body: Record<string, unknown>) =>
  ctx
    .http()
    .post('/usages')
    .send({ reason: 'Visita a cliente', ...body });

const finish = (id: string, body: Record<string, unknown> = {}) => ctx.http().patch(`/usages/${id}/finish`).send(body);

const activeUsages = () => ctx.prisma.usage.count({ where: { endedAt: null } });

const fields = (body: { errors: { field: string }[] }) => body.errors.map((error) => error.field);

const statuses = (responses: { status: number }[]) => responses.map((response) => response.status).sort((a, b) => a - b);

const conflictBody = (field: string, message: string) => ({
  statusCode: 409,
  error: 'Conflict',
  message,
  errors: [{ field, message }],
});

const unprocessableBody = (field: string, message: string) => ({
  statusCode: 422,
  error: 'Unprocessable Entity',
  message,
  errors: [{ field, message }],
});

const fleet = async () => {
  const fiat = await createVehicle(ctx, { plate: 'ABC1D23' });
  const volkswagen = await createVehicle(ctx, { plate: 'BRA2E19', color: 'Branco', brand: 'Volkswagen' });
  const ana = await createDriver(ctx, 'Ana Souza');
  const bruno = await createDriver(ctx, 'Bruno Lima');
  return { fiat, volkswagen, ana, bruno };
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

describe('POST /usages', () => {
  it('inicia a utilização e devolve motorista e automóvel', async () => {
    const { fiat, ana } = await fleet();
    const before = Date.now();
    const response = await start({ vehicleId: fiat.id, driverId: ana.id, reason: '  Entrega de documentos  ' }).expect(201);
    const after = Date.now();

    expect(response.body).toEqual({
      id: expect.stringMatching(UUID),
      startedAt: expect.any(String),
      endedAt: null,
      reason: 'Entrega de documentos',
      driver: { id: ana.id, name: 'Ana Souza' },
      vehicle: { id: fiat.id, plate: 'ABC1D23', color: 'Prata', brand: 'Fiat' },
    });
    const startedAt = Date.parse(response.body.startedAt);
    expect(startedAt).toBeGreaterThanOrEqual(before);
    expect(startedAt).toBeLessThanOrEqual(after);

    const stored = await ctx.prisma.usage.findUniqueOrThrow({ where: { id: response.body.id } });
    expect(stored).toMatchObject({ vehicleId: fiat.id, driverId: ana.id, endedAt: null, reason: 'Entrega de documentos' });
  });

  it('aceita data de início retroativa com fuso e grava o instante certo mesmo com o banco fora de UTC', async () => {
    const { fiat, ana } = await fleet();
    const response = await start({ vehicleId: fiat.id, driverId: ana.id, startedAt: '2026-03-10T08:00:00.250-03:00' }).expect(201);

    expect(response.body.startedAt).toBe('2026-03-10T11:00:00.250Z');
    const [row] = await ctx.prisma.$queryRaw<{ utc: string; sessionTimeZone: string }[]>`
      SELECT to_char("started_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS "utc", current_setting('TimeZone') AS "sessionTimeZone"
      FROM "usages" WHERE "id" = ${response.body.id}::uuid`;
    expect(row).toEqual({ utc: '2026-03-10T11:00:00.250', sessionTimeZone: 'UTC' });

    const [database] = await ctx.prisma.$queryRaw<{ timezone: string }[]>`
      SELECT setting AS "timezone" FROM pg_db_role_setting, unnest(setconfig) AS setting
      WHERE setdatabase = (SELECT oid FROM pg_database WHERE datname = current_database())`;
    expect(database.timezone).toBe('TimeZone=America/Sao_Paulo');
  });

  it('regra 1: automóvel em uso não pode ser utilizado por outro motorista', async () => {
    const { fiat, ana, bruno } = await fleet();
    await start({ vehicleId: fiat.id, driverId: ana.id }).expect(201);

    const response = await start({ vehicleId: fiat.id, driverId: bruno.id }).expect(409);
    expect(response.body).toEqual(conflictBody('vehicleId', VEHICLE_BUSY));

    const again = await start({ vehicleId: fiat.id, driverId: ana.id }).expect(409);
    expect(again.body).toEqual(conflictBody('vehicleId', VEHICLE_BUSY));
    expect(await ctx.prisma.usage.count()).toBe(1);
  });

  it('regra 2: motorista utilizando um automóvel não pode iniciar outro', async () => {
    const { fiat, volkswagen, ana } = await fleet();
    await start({ vehicleId: fiat.id, driverId: ana.id }).expect(201);

    const response = await start({ vehicleId: volkswagen.id, driverId: ana.id }).expect(409);
    expect(response.body).toEqual(conflictBody('driverId', DRIVER_BUSY));
    expect(await ctx.prisma.usage.count()).toBe(1);
  });

  it('depois de finalizar, automóvel e motorista ficam livres de novo', async () => {
    const { fiat, volkswagen, ana, bruno } = await fleet();
    const first = await start({ vehicleId: fiat.id, driverId: ana.id, startedAt: hoursAgo(2) }).expect(201);
    await finish(first.body.id).expect(200);

    await start({ vehicleId: fiat.id, driverId: bruno.id }).expect(201);
    await start({ vehicleId: volkswagen.id, driverId: ana.id }).expect(201);
    expect(await activeUsages()).toBe(2);
  });

  it('início retroativo que se sobrepõe a uma utilização já encerrada responde 409', async () => {
    const { fiat, volkswagen, ana, bruno } = await fleet();
    const first = await start({ vehicleId: fiat.id, driverId: ana.id, startedAt: '2026-03-10T08:00:00-03:00' }).expect(201);
    await finish(first.body.id, { endedAt: '2026-03-10T12:00:00-03:00' }).expect(200);

    const vehicleBusy = await start({ vehicleId: fiat.id, driverId: bruno.id, startedAt: '2026-03-10T10:00:00-03:00' }).expect(409);
    expect(vehicleBusy.body).toEqual(conflictBody('vehicleId', VEHICLE_BUSY_IN_PERIOD));

    const driverBusy = await start({ vehicleId: volkswagen.id, driverId: ana.id, startedAt: '2026-03-10T11:59:59-03:00' }).expect(409);
    expect(driverBusy.body).toEqual(conflictBody('driverId', DRIVER_BUSY_IN_PERIOD));

    const beforeFirst = await start({ vehicleId: fiat.id, driverId: bruno.id, startedAt: '2026-03-10T07:00:00-03:00' }).expect(409);
    expect(beforeFirst.body).toEqual(conflictBody('vehicleId', VEHICLE_BUSY_IN_PERIOD));
    expect(await ctx.prisma.usage.count()).toBe(1);
  });

  it('início retroativo a partir do fim da utilização anterior é aceito', async () => {
    const { fiat, volkswagen, ana, bruno } = await fleet();
    const first = await start({ vehicleId: fiat.id, driverId: ana.id, startedAt: '2026-03-10T08:00:00-03:00' }).expect(201);
    await finish(first.body.id, { endedAt: '2026-03-10T12:00:00-03:00' }).expect(200);

    const sameVehicle = await start({ vehicleId: fiat.id, driverId: bruno.id, startedAt: '2026-03-10T12:00:00-03:00' }).expect(201);
    expect(sameVehicle.body.startedAt).toBe('2026-03-10T15:00:00.000Z');

    const sameDriver = await start({ vehicleId: volkswagen.id, driverId: ana.id, startedAt: '2026-03-10T13:30:00-03:00' }).expect(201);
    expect(sameDriver.body.startedAt).toBe('2026-03-10T16:30:00.000Z');
    expect(await activeUsages()).toBe(2);
  });

  it('não aceita início no futuro', async () => {
    const { fiat, ana } = await fleet();
    const response = await start({ vehicleId: fiat.id, driverId: ana.id, startedAt: hoursAgo(-1) }).expect(422);
    expect(response.body).toEqual(unprocessableBody('startedAt', 'A data de início não pode estar no futuro.'));
    expect(await ctx.prisma.usage.count()).toBe(0);
  });

  it('responde 422 para automóvel ou motorista inexistente', async () => {
    const { fiat, ana } = await fleet();

    const vehicle = await start({ vehicleId: UNKNOWN_ID, driverId: ana.id }).expect(422);
    expect(vehicle.body).toEqual(unprocessableBody('vehicleId', 'Automóvel não encontrado.'));

    const driver = await start({ vehicleId: fiat.id, driverId: UNKNOWN_ID }).expect(422);
    expect(driver.body).toEqual(unprocessableBody('driverId', 'Motorista não encontrado.'));
    expect(await ctx.prisma.usage.count()).toBe(0);
  });

  it('responde 422 para automóvel ou motorista excluído', async () => {
    const { fiat, volkswagen, ana, bruno } = await fleet();
    await ctx.http().delete(`/vehicles/${fiat.id}`).expect(204);
    await ctx.http().delete(`/drivers/${bruno.id}`).expect(204);

    const vehicle = await start({ vehicleId: fiat.id, driverId: ana.id }).expect(422);
    expect(vehicle.body).toEqual(unprocessableBody('vehicleId', 'Automóvel não encontrado.'));

    const driver = await start({ vehicleId: volkswagen.id, driverId: bruno.id }).expect(422);
    expect(driver.body).toEqual(unprocessableBody('driverId', 'Motorista não encontrado.'));
    expect(await ctx.prisma.usage.count()).toBe(0);
  });

  describe('entrada em formato inválido responde 400', () => {
    it('sem motivo ou com motivo em branco', async () => {
      const { fiat, ana } = await fleet();

      const missing = await ctx.http().post('/usages').send({ vehicleId: fiat.id, driverId: ana.id }).expect(400);
      expect(missing.body).toMatchObject({ statusCode: 400, error: 'Bad Request' });
      expect(fields(missing.body)).toContain('reason');

      const blank = await start({ vehicleId: fiat.id, driverId: ana.id, reason: '    ' }).expect(400);
      expect(blank.body.errors).toEqual([{ field: 'reason', message: 'Informe o motivo da utilização.' }]);
      expect(blank.body.message).toBe('Informe o motivo da utilização.');
    });

    it('motivo acima de 500 caracteres', async () => {
      const { fiat, ana } = await fleet();
      const response = await start({ vehicleId: fiat.id, driverId: ana.id, reason: 'a'.repeat(501) }).expect(400);
      expect(response.body.errors).toEqual([{ field: 'reason', message: 'O motivo deve ter no máximo 500 caracteres.' }]);
    });

    it('data de início sem fuso ou fora do formato', async () => {
      const { fiat, ana } = await fleet();
      const message = 'Data de início inválida: use data e hora com fuso, por exemplo 2026-10-25T08:00:00-03:00.';

      for (const startedAt of ['2026-03-10T08:00:00', '2026-03-10', '10/03/2026 08:00', 'ontem', 1_773_140_400_000]) {
        const response = await start({ vehicleId: fiat.id, driverId: ana.id, startedAt }).expect(400);
        expect(response.body.message).toBe(message);
        expect(new Set(fields(response.body))).toEqual(new Set(['startedAt']));
      }
    });

    it('identificadores que não são UUID', async () => {
      const response = await start({ vehicleId: 'abc', driverId: '123' }).expect(400);
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          { field: 'vehicleId', message: 'Automóvel inválido.' },
          { field: 'driverId', message: 'Motorista inválido.' },
        ]),
      );
    });

    it('campo não permitido', async () => {
      const { fiat, ana } = await fleet();
      const response = await start({ vehicleId: fiat.id, driverId: ana.id, endedAt: hoursAgo(1) }).expect(400);
      expect(response.body.errors).toEqual([{ field: 'endedAt', message: 'O campo endedAt não é permitido.' }]);
      expect(await ctx.prisma.usage.count()).toBe(0);
    });
  });
});

describe('PATCH /usages/:id/finish', () => {
  it('finaliza sem corpo usando o horário atual', async () => {
    const { fiat, ana } = await fleet();
    const created = await start({ vehicleId: fiat.id, driverId: ana.id, startedAt: hoursAgo(3) }).expect(201);

    const before = Date.now();
    const response = await ctx.http().patch(`/usages/${created.body.id}/finish`).expect(200);
    const after = Date.now();

    expect(response.body).toEqual({ ...created.body, endedAt: expect.any(String) });
    const endedAt = Date.parse(response.body.endedAt);
    expect(endedAt).toBeGreaterThanOrEqual(before);
    expect(endedAt).toBeLessThanOrEqual(after);
    expect(await activeUsages()).toBe(0);
  });

  it('finaliza com corpo vazio', async () => {
    const { fiat, ana } = await fleet();
    const created = await start({ vehicleId: fiat.id, driverId: ana.id, startedAt: hoursAgo(3) }).expect(201);

    const response = await finish(created.body.id, {}).expect(200);
    expect(response.body.endedAt).toEqual(expect.any(String));
    expect(Date.parse(response.body.endedAt)).toBeGreaterThan(Date.parse(created.body.startedAt));
  });

  it('finaliza com data de término informada com fuso e devolve em UTC', async () => {
    const { fiat, ana } = await fleet();
    const created = await start({ vehicleId: fiat.id, driverId: ana.id, startedAt: '2026-03-10T08:00:00-03:00' }).expect(201);

    const response = await finish(created.body.id, { endedAt: '2026-03-10T18:30:00+01:00' }).expect(200);
    expect(response.body).toMatchObject({ startedAt: '2026-03-10T11:00:00.000Z', endedAt: '2026-03-10T17:30:00.000Z' });
    const stored = await ctx.prisma.usage.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(stored.endedAt?.toISOString()).toBe('2026-03-10T17:30:00.000Z');
  });

  it('não aceita término anterior ou igual ao início', async () => {
    const { fiat, ana } = await fleet();
    const created = await start({ vehicleId: fiat.id, driverId: ana.id, startedAt: '2026-03-10T08:00:00-03:00' }).expect(201);
    const expected = unprocessableBody('endedAt', 'A data de término deve ser posterior à data de início.');

    expect((await finish(created.body.id, { endedAt: '2026-03-10T07:59:59-03:00' }).expect(422)).body).toEqual(expected);
    expect((await finish(created.body.id, { endedAt: '2026-03-10T11:00:00Z' }).expect(422)).body).toEqual(expected);
    expect(await activeUsages()).toBe(1);
  });

  it('não aceita término no futuro', async () => {
    const { fiat, ana } = await fleet();
    const created = await start({ vehicleId: fiat.id, driverId: ana.id, startedAt: hoursAgo(3) }).expect(201);

    const response = await finish(created.body.id, { endedAt: hoursAgo(-1) }).expect(422);
    expect(response.body).toEqual(unprocessableBody('endedAt', 'A data de término não pode estar no futuro.'));
    expect(await activeUsages()).toBe(1);
  });

  it('não finaliza duas vezes', async () => {
    const { fiat, ana } = await fleet();
    const created = await start({ vehicleId: fiat.id, driverId: ana.id, startedAt: hoursAgo(3) }).expect(201);
    const finished = await finish(created.body.id, { endedAt: hoursAgo(1) }).expect(200);

    const response = await finish(created.body.id).expect(409);
    expect(response.body).toEqual({ statusCode: 409, error: 'Conflict', message: 'Esta utilização já foi finalizada.', errors: [] });
    const stored = await ctx.prisma.usage.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(stored.endedAt?.toISOString()).toBe(finished.body.endedAt);
  });

  it('data de término sem fuso responde 400', async () => {
    const { fiat, ana } = await fleet();
    const created = await start({ vehicleId: fiat.id, driverId: ana.id, startedAt: hoursAgo(3) }).expect(201);

    const response = await finish(created.body.id, { endedAt: '2026-03-10T18:00:00' }).expect(400);
    expect(response.body.message).toBe('Data de término inválida: use data e hora com fuso, por exemplo 2026-10-25T08:00:00-03:00.');
    expect(new Set(fields(response.body))).toEqual(new Set(['endedAt']));
  });

  it('responde 404 para utilização inexistente e 400 para id inválido', async () => {
    const missing = await finish(UNKNOWN_ID).expect(404);
    expect(missing.body).toEqual({ statusCode: 404, error: 'Not Found', message: 'Utilização não encontrada.', errors: [] });

    const invalid = await finish('nao-e-uuid').expect(400);
    expect(invalid.body).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Identificador inválido: informe um UUID.',
      errors: [],
    });
  });
});

describe('GET /usages', () => {
  it('lista da mais recente para a mais antiga, com nome do motorista e dados do automóvel', async () => {
    const { fiat, volkswagen, ana, bruno } = await fleet();
    const register = (vehicleId: string, driverId: string, startedAt: string, reason: string) =>
      start({ vehicleId, driverId, startedAt, reason }).expect(201);

    const current = await register(volkswagen.id, bruno.id, '2026-03-11T09:00:00-03:00', 'Banco');
    const oldest = await register(fiat.id, ana.id, '2026-03-09T08:00:00-03:00', 'Cartório');
    await finish(oldest.body.id, { endedAt: '2026-03-09T10:00:00-03:00' }).expect(200);
    const middle = await register(fiat.id, ana.id, '2026-03-10T08:00:00-03:00', 'Cliente');
    await finish(middle.body.id, { endedAt: '2026-03-10T12:00:00-03:00' }).expect(200);

    const response = await ctx.http().get('/usages').expect(200);
    expect(response.body).toEqual([
      {
        id: current.body.id,
        startedAt: '2026-03-11T12:00:00.000Z',
        endedAt: null,
        reason: 'Banco',
        driver: { id: bruno.id, name: 'Bruno Lima' },
        vehicle: { id: volkswagen.id, plate: 'BRA2E19', color: 'Branco', brand: 'Volkswagen' },
      },
      {
        id: middle.body.id,
        startedAt: '2026-03-10T11:00:00.000Z',
        endedAt: '2026-03-10T15:00:00.000Z',
        reason: 'Cliente',
        driver: { id: ana.id, name: 'Ana Souza' },
        vehicle: { id: fiat.id, plate: 'ABC1D23', color: 'Prata', brand: 'Fiat' },
      },
      {
        id: oldest.body.id,
        startedAt: '2026-03-09T11:00:00.000Z',
        endedAt: '2026-03-09T13:00:00.000Z',
        reason: 'Cartório',
        driver: { id: ana.id, name: 'Ana Souza' },
        vehicle: { id: fiat.id, plate: 'ABC1D23', color: 'Prata', brand: 'Fiat' },
      },
    ]);
  });

  it('continua mostrando o automóvel e o motorista depois da exclusão', async () => {
    const { fiat, ana } = await fleet();
    const created = await start({ vehicleId: fiat.id, driverId: ana.id, startedAt: hoursAgo(5) }).expect(201);
    await finish(created.body.id, { endedAt: hoursAgo(4) }).expect(200);
    await ctx.http().delete(`/vehicles/${fiat.id}`).expect(204);
    await ctx.http().delete(`/drivers/${ana.id}`).expect(204);

    const vehicles = await ctx.http().get('/vehicles').expect(200);
    expect(vehicles.body.map((vehicle: { id: string }) => vehicle.id)).not.toContain(fiat.id);

    const response = await ctx.http().get('/usages').expect(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      id: created.body.id,
      driver: { id: ana.id, name: 'Ana Souza' },
      vehicle: { id: fiat.id, plate: 'ABC1D23', color: 'Prata', brand: 'Fiat' },
    });
  });

  it('devolve lista vazia quando não há utilizações', async () => {
    const response = await ctx.http().get('/usages').expect(200);
    expect(response.body).toEqual([]);
  });
});

describe('concorrência', () => {
  const PARALLEL = 8;

  it('pedidos simultâneos do mesmo automóvel por motoristas diferentes geram um 201 e o resto 409', async () => {
    for (let round = 0; round < 3; round += 1) {
      await resetDatabase(ctx.prisma);
      const vehicle = await createVehicle(ctx, { plate: 'ABC1D23' });
      const drivers = [];
      for (let index = 0; index < PARALLEL; index += 1) drivers.push(await createDriver(ctx, `Motorista ${index}`));

      const responses = await Promise.all(drivers.map((driver) => start({ vehicleId: vehicle.id, driverId: driver.id })));

      expect(statuses(responses)).toEqual([201, ...Array<number>(PARALLEL - 1).fill(409)]);
      for (const response of responses.filter((item) => item.status === 409)) {
        expect(response.body).toEqual(conflictBody('vehicleId', VEHICLE_BUSY));
      }
      expect(await ctx.prisma.usage.count({ where: { vehicleId: vehicle.id, endedAt: null } })).toBe(1);
      expect(await ctx.prisma.usage.count()).toBe(1);
    }
  });

  it('pedidos simultâneos do mesmo motorista com automóveis diferentes geram um 201 e o resto 409', async () => {
    for (let round = 0; round < 3; round += 1) {
      await resetDatabase(ctx.prisma);
      const driver = await createDriver(ctx, 'Ana Souza');
      const vehicles = [];
      for (let index = 0; index < PARALLEL; index += 1) vehicles.push(await createVehicle(ctx, { plate: `ABC${index}D${index}${index}` }));

      const responses = await Promise.all(vehicles.map((vehicle) => start({ vehicleId: vehicle.id, driverId: driver.id })));

      expect(statuses(responses)).toEqual([201, ...Array<number>(PARALLEL - 1).fill(409)]);
      for (const response of responses.filter((item) => item.status === 409)) {
        expect(response.body).toEqual(conflictBody('driverId', DRIVER_BUSY));
      }
      expect(await ctx.prisma.usage.count({ where: { driverId: driver.id, endedAt: null } })).toBe(1);
      expect(await ctx.prisma.usage.count()).toBe(1);
    }
  });

  it('finalizações simultâneas da mesma utilização geram um 200 e o resto 409', async () => {
    const { fiat, ana } = await fleet();
    const created = await start({ vehicleId: fiat.id, driverId: ana.id, startedAt: hoursAgo(2) }).expect(201);

    const responses = await Promise.all(Array.from({ length: PARALLEL }, () => finish(created.body.id)));

    expect(statuses(responses)).toEqual([200, ...Array<number>(PARALLEL - 1).fill(409)]);
    const winner = responses.find((response) => response.status === 200);
    const stored = await ctx.prisma.usage.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(stored.endedAt?.toISOString()).toBe(winner?.body.endedAt);
  });
});
