import { Logger, type ArgumentsHost } from '@nestjs/common';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter.js';
import { SEED_DRIVERS, SEED_USAGES, SEED_VEHICLES, seedDatabase } from '../prisma/seed-data.js';
import { createTestApp, resetDatabase, type TestApp } from './support/app.js';

let ctx: TestApp;

const run = (sql: string) => ctx.prisma.$executeRawUnsafe(sql);

const rejects = async (sql: string, pattern: RegExp) => {
  await expect(run(sql)).rejects.toThrow(pattern);
};

const insertVehicle = (id: string, plate: string, deletedAt = 'NULL') =>
  `INSERT INTO vehicles (id, plate, color, brand, updated_at, deleted_at) VALUES ('${id}', '${plate}', 'Prata', 'Fiat', now(), ${deletedAt})`;

const insertUsage = (vehicleId: string, driverId: string, startedAt: string, endedAt: string | null, reason = 'Visita a cliente') =>
  `INSERT INTO usages (id, vehicle_id, driver_id, started_at, ended_at, reason, updated_at)
   VALUES (gen_random_uuid(), '${vehicleId}', '${driverId}', '${startedAt}', ${endedAt === null ? 'NULL' : `'${endedAt}'`}, '${reason}', now())`;

const V1 = '00000000-0000-4000-8000-000000000001';
const V2 = '00000000-0000-4000-8000-000000000002';
const D1 = '00000000-0000-4000-8000-0000000000d1';
const D2 = '00000000-0000-4000-8000-0000000000d2';

beforeAll(async () => {
  ctx = await createTestApp();
});

afterAll(async () => {
  await ctx.close();
});

beforeEach(async () => {
  await resetDatabase(ctx.prisma);
  await ctx.prisma.vehicle.createMany({
    data: [
      { id: V1, plate: 'ABC1D23', color: 'Prata', brand: 'Fiat' },
      { id: V2, plate: 'BRA2E19', color: 'Branco', brand: 'Volkswagen' },
    ],
  });
  await ctx.prisma.driver.createMany({
    data: [
      { id: D1, name: 'Ana Souza' },
      { id: D2, name: 'Bruno Lima' },
    ],
  });
});

describe('regras de integridade no banco (SQL direto)', () => {
  it('o automóvel não pode ter duas utilizações em aberto', async () => {
    await expect(run(insertUsage(V1, D1, '2026-03-10T08:00:00Z', null))).resolves.toBe(1);
    await rejects(insertUsage(V1, D2, '2026-03-10T09:00:00Z', null), /usages_vehicle_period_excl/);
    expect(await ctx.prisma.usage.count({ where: { vehicleId: V1 } })).toBe(1);
  });

  it('o automóvel não pode ter períodos sobrepostos, mas aceita períodos encostados', async () => {
    await run(insertUsage(V1, D1, '2026-03-10T08:00:00Z', '2026-03-10T12:00:00Z'));
    await rejects(insertUsage(V1, D2, '2026-03-10T11:00:00Z', '2026-03-10T13:00:00Z'), /usages_vehicle_period_excl/);
    await rejects(insertUsage(V1, D2, '2026-03-10T07:00:00Z', '2026-03-10T08:30:00Z'), /usages_vehicle_period_excl/);
    await rejects(insertUsage(V1, D2, '2026-03-10T09:00:00Z', '2026-03-10T10:00:00Z'), /usages_vehicle_period_excl/);
    await rejects(insertUsage(V1, D2, '2026-03-10T06:00:00Z', null), /usages_vehicle_period_excl/);

    await expect(run(insertUsage(V1, D2, '2026-03-10T12:00:00Z', '2026-03-10T14:00:00Z'))).resolves.toBe(1);
    await expect(run(insertUsage(V1, D1, '2026-03-10T06:00:00Z', '2026-03-10T08:00:00Z'))).resolves.toBe(1);
    await expect(run(insertUsage(V1, D1, '2026-03-10T14:00:00Z', null))).resolves.toBe(1);
    expect(await ctx.prisma.usage.count({ where: { vehicleId: V1 } })).toBe(4);
  });

  it('o motorista não pode ter duas utilizações em aberto', async () => {
    await run(insertUsage(V1, D1, '2026-03-10T08:00:00Z', null));
    await rejects(insertUsage(V2, D1, '2026-03-10T09:00:00Z', null), /usages_driver_period_excl/);
    expect(await ctx.prisma.usage.count({ where: { driverId: D1 } })).toBe(1);
  });

  it('o motorista não pode ter períodos sobrepostos, mas aceita períodos encostados', async () => {
    await run(insertUsage(V1, D1, '2026-03-10T08:00:00Z', '2026-03-10T12:00:00Z'));
    await rejects(insertUsage(V2, D1, '2026-03-10T11:59:00Z', '2026-03-10T13:00:00Z'), /usages_driver_period_excl/);
    await rejects(insertUsage(V2, D1, '2026-03-10T10:00:00Z', null), /usages_driver_period_excl/);

    await expect(run(insertUsage(V2, D1, '2026-03-10T12:00:00Z', null))).resolves.toBe(1);
    expect(await ctx.prisma.usage.count({ where: { driverId: D1 } })).toBe(2);
  });

  it('automóveis e motoristas diferentes podem ter utilizações simultâneas', async () => {
    await expect(run(insertUsage(V1, D1, '2026-03-10T08:00:00Z', null))).resolves.toBe(1);
    await expect(run(insertUsage(V2, D2, '2026-03-10T08:00:00Z', null))).resolves.toBe(1);
  });

  it('o término precisa ser posterior ao início', async () => {
    await rejects(insertUsage(V1, D1, '2026-03-10T08:00:00Z', '2026-03-10T08:00:00Z'), /usages_period_check/);
    await rejects(insertUsage(V1, D1, '2026-03-10T08:00:00Z', '2026-03-10T07:00:00Z'), /usages_period_check/);

    await run(insertUsage(V1, D1, '2026-03-10T08:00:00Z', null));
    await rejects(`UPDATE usages SET ended_at = started_at WHERE vehicle_id = '${V1}'`, /usages_period_check/);
    await rejects(`UPDATE usages SET ended_at = started_at - interval '1 hour' WHERE vehicle_id = '${V1}'`, /usages_period_check/);
    expect((await ctx.prisma.usage.findFirstOrThrow({ where: { vehicleId: V1 } })).endedAt).toBeNull();
  });

  it('o motivo da utilização não pode ficar em branco', async () => {
    await rejects(insertUsage(V1, D1, '2026-03-10T08:00:00Z', null, ''), /usages_reason_check/);
    await rejects(insertUsage(V1, D1, '2026-03-10T08:00:00Z', null, '   '), /usages_reason_check/);
    expect(await ctx.prisma.usage.count()).toBe(0);
  });

  it('a placa precisa estar no padrão antigo ou Mercosul, em maiúsculas e sem separadores', async () => {
    for (const plate of ['abc1d23', 'ABC-1234', 'ABC 1234', 'AB12345', 'ABC1D2', 'ABC1D234', '1BC1234', 'ABCD123', '']) {
      await rejects(insertVehicle('00000000-0000-4000-8000-0000000000aa', plate), /vehicles_plate_check/);
    }
    await expect(run(insertVehicle('00000000-0000-4000-8000-0000000000ab', 'XYZ9876'))).resolves.toBe(1);
    await expect(run(insertVehicle('00000000-0000-4000-8000-0000000000ac', 'QWE4R56'))).resolves.toBe(1);
  });

  it('cor, marca e nome do motorista não podem ficar em branco', async () => {
    await rejects(`UPDATE vehicles SET color = '  ' WHERE id = '${V1}'`, /vehicles_color_check/);
    await rejects(`UPDATE vehicles SET color = '' WHERE id = '${V1}'`, /vehicles_color_check/);
    await rejects(`UPDATE vehicles SET brand = '  ' WHERE id = '${V1}'`, /vehicles_brand_check/);
    await rejects(`UPDATE vehicles SET brand = '' WHERE id = '${V1}'`, /vehicles_brand_check/);
    await rejects(`UPDATE drivers SET name = '  ' WHERE id = '${D1}'`, /drivers_name_check/);
    await rejects(`UPDATE drivers SET name = '' WHERE id = '${D1}'`, /drivers_name_check/);
    expect(await ctx.prisma.vehicle.findUniqueOrThrow({ where: { id: V1 } })).toMatchObject({ color: 'Prata', brand: 'Fiat' });
    expect((await ctx.prisma.driver.findUniqueOrThrow({ where: { id: D1 } })).name).toBe('Ana Souza');
  });

  it('a placa é única entre os automóveis ativos e pode ser reaproveitada após a exclusão lógica', async () => {
    const replacement = '00000000-0000-4000-8000-0000000000a1';
    await rejects(insertVehicle(replacement, 'ABC1D23'), /vehicles_plate_active_key/);
    await rejects(`UPDATE vehicles SET plate = 'ABC1D23' WHERE id = '${V2}'`, /vehicles_plate_active_key/);

    await expect(run(insertVehicle('00000000-0000-4000-8000-0000000000a0', 'ABC1D23', 'now()'))).resolves.toBe(1);

    await run(`UPDATE vehicles SET deleted_at = now() WHERE id = '${V1}'`);
    await expect(run(insertVehicle(replacement, 'ABC1D23'))).resolves.toBe(1);

    await rejects(`UPDATE vehicles SET deleted_at = NULL WHERE id = '${V1}'`, /vehicles_plate_active_key/);
    expect(await ctx.prisma.vehicle.count({ where: { plate: 'ABC1D23' } })).toBe(3);
    expect(await ctx.prisma.vehicle.count({ where: { plate: 'ABC1D23', deletedAt: null } })).toBe(1);
  });

  it('não permite apagar fisicamente automóvel ou motorista que tenha utilizações', async () => {
    await run(insertUsage(V1, D1, '2026-03-10T08:00:00Z', '2026-03-10T12:00:00Z'));

    await rejects(`DELETE FROM vehicles WHERE id = '${V1}'`, /usages_vehicle_id_fkey/);
    await rejects(`DELETE FROM drivers WHERE id = '${D1}'`, /usages_driver_id_fkey/);
    expect(await ctx.prisma.vehicle.count({ where: { id: V1 } })).toBe(1);
    expect(await ctx.prisma.driver.count({ where: { id: D1 } })).toBe(1);

    await expect(run(`DELETE FROM vehicles WHERE id = '${V2}'`)).resolves.toBe(1);
    await expect(run(`DELETE FROM drivers WHERE id = '${D2}'`)).resolves.toBe(1);
  });

  it('a utilização precisa apontar para automóvel e motorista existentes', async () => {
    const missing = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
    await rejects(insertUsage(missing, D1, '2026-03-10T08:00:00Z', null), /usages_vehicle_id_fkey/);
    await rejects(insertUsage(V1, missing, '2026-03-10T08:00:00Z', null), /usages_driver_id_fkey/);
    expect(await ctx.prisma.usage.count()).toBe(0);
  });
});

describe('tradução dos erros reais do banco', () => {
  const translate = (exception: unknown) => {
    const response = { headersSent: false, locals: {}, status: vi.fn(), json: vi.fn() };
    response.status.mockReturnValue(response);
    const host = { switchToHttp: () => ({ getResponse: () => response }) } as unknown as ArgumentsHost;
    new AllExceptionsFilter().catch(exception, host);
    return { status: response.status.mock.calls[0][0], body: response.json.mock.calls[0][0] };
  };

  const usage = (vehicleId: string, driverId: string, startedAt: string, endedAt: string | null = null) =>
    ctx.prisma.usage.create({
      data: { vehicleId, driverId, startedAt: new Date(startedAt), endedAt: endedAt === null ? null : new Date(endedAt), reason: 'Visita' },
    });

  beforeAll(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('período sobreposto (23P01) vira 409 com a mensagem de conflito', async () => {
    await usage(V1, D1, '2026-03-10T08:00:00Z');
    const error = await usage(V1, D2, '2026-03-10T09:00:00Z').catch((caught: unknown) => caught);

    expect(translate(error)).toEqual({
      status: 409,
      body: {
        statusCode: 409,
        error: 'Conflict',
        message: 'O automóvel ou o motorista já possui uma utilização no período informado.',
        errors: [],
      },
    });
  });

  it('CHECK violado (23514) vira 422', async () => {
    const created = await usage(V1, D1, '2026-03-10T08:00:00Z');
    const error = await ctx.prisma.usage
      .update({ where: { id: created.id }, data: { endedAt: created.startedAt } })
      .catch((caught: unknown) => caught);

    expect(translate(error)).toEqual({
      status: 422,
      body: { statusCode: 422, error: 'Unprocessable Entity', message: 'A operação viola uma regra de integridade dos dados.', errors: [] },
    });
  });

  it('placa repetida entre automóveis ativos vira 409', async () => {
    const error = await ctx.prisma.vehicle
      .create({ data: { plate: 'ABC1D23', color: 'Azul', brand: 'Fiat' } })
      .catch((caught: unknown) => caught);

    expect(translate(error)).toEqual({
      status: 409,
      body: { statusCode: 409, error: 'Conflict', message: 'Já existe um registro com esses dados.', errors: [] },
    });
  });
});

describe('dados de exemplo', () => {
  it('o seed carrega dados que respeitam as regras de uso', async () => {
    await seedDatabase(ctx.prisma);

    const vehicles = (await ctx.http().get('/vehicles').expect(200)).body as { id: string; plate: string }[];
    const drivers = (await ctx.http().get('/drivers').expect(200)).body as { id: string; name: string }[];
    const usages = (await ctx.http().get('/usages').expect(200)).body as {
      endedAt: string | null;
      driver: { id: string };
      vehicle: { id: string };
    }[];
    expect(vehicles).toHaveLength(SEED_VEHICLES.length);
    expect(drivers).toHaveLength(SEED_DRIVERS.length);
    expect(usages).toHaveLength(SEED_USAGES.length);

    const active = usages.filter((usage) => usage.endedAt === null);
    expect(active).toHaveLength(1);

    const freeDriver = drivers.find((driver) => !usages.some((usage) => usage.driver.id === driver.id))!;
    const freeVehicle = vehicles.find((vehicle) => !usages.some((usage) => usage.vehicle.id === vehicle.id))!;
    await ctx.http().post('/usages').send({ vehicleId: active[0].vehicle.id, driverId: freeDriver.id, reason: 'Visita' }).expect(409);
    await ctx.http().post('/usages').send({ vehicleId: freeVehicle.id, driverId: active[0].driver.id, reason: 'Visita' }).expect(409);
    await ctx.http().post('/usages').send({ vehicleId: freeVehicle.id, driverId: freeDriver.id, reason: 'Visita' }).expect(201);
  });
});
