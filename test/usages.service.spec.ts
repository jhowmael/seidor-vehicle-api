import { ConflictException, NotFoundException, UnprocessableEntityException, type HttpException } from '@nestjs/common';
import type { ClockService } from '../src/common/clock/clock.service.js';
import type { Prisma } from '../src/generated/prisma/client.js';
import type { DriversRepository } from '../src/modules/drivers/drivers.repository.js';
import type { UsagePeriod } from '../src/modules/usages/domain/usage-rules.js';
import type { UsageRecord, UsagesRepository } from '../src/modules/usages/usages.repository.js';
import { UsagesService } from '../src/modules/usages/usages.service.js';
import type { VehiclesRepository } from '../src/modules/vehicles/vehicles.repository.js';

const NOW = new Date('2026-10-25T12:00:00.000Z');
const USAGE_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const VEHICLE_ID = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b';
const DRIVER_ID = '2b7e4c1a-9d3f-4e8b-a6c5-0f1e2d3c4b5a';
const TX = { tx: 'usages' } as unknown as Prisma.TransactionClient;
const VEHICLE = { id: VEHICLE_ID, plate: 'ABC1D23', color: 'Prata', brand: 'Fiat' };
const DRIVER = { id: DRIVER_ID, name: 'Ana Souza' };
const REASON = 'Visita ao cliente em Campinas';

const usageRecord = (overrides: Partial<UsageRecord> = {}): UsageRecord => ({
  id: USAGE_ID,
  vehicleId: VEHICLE_ID,
  driverId: DRIVER_ID,
  startedAt: new Date('2026-10-25T11:00:00.000Z'),
  endedAt: null,
  reason: REASON,
  createdAt: NOW,
  updatedAt: NOW,
  vehicle: VEHICLE,
  driver: DRIVER,
  ...overrides,
});

const period = (startedAt: string, endedAt: string | null = null): UsagePeriod => ({
  startedAt: new Date(startedAt),
  endedAt: endedAt === null ? null : new Date(endedAt),
});

const rejectionOf = (promise: Promise<unknown>) =>
  promise.then(
    () => expect.unreachable('a operação deveria ter falhado'),
    (error: unknown) => error as HttpException,
  );

function setup() {
  const repository = {
    transaction: vi.fn<UsagesRepository['transaction']>((work) => work(TX)),
    findMany: vi.fn<UsagesRepository['findMany']>().mockResolvedValue([]),
    lockPeriod: vi.fn<UsagesRepository['lockPeriod']>().mockResolvedValue(period('2026-10-25T11:00:00.000Z')),
    findLatest: vi.fn<UsagesRepository['findLatest']>().mockResolvedValue(null),
    create: vi
      .fn<UsagesRepository['create']>()
      .mockImplementation(async (data) => usageRecord({ startedAt: data.startedAt, reason: data.reason })),
    finish: vi.fn<UsagesRepository['finish']>().mockImplementation(async (_id, endedAt) => usageRecord({ endedAt })),
  };
  const vehicles = { lockById: vi.fn<VehiclesRepository['lockById']>().mockResolvedValue(true) };
  const drivers = { lockById: vi.fn<DriversRepository['lockById']>().mockResolvedValue(true) };
  const clock: ClockService = { now: () => NOW };
  const service = new UsagesService(
    repository as unknown as UsagesRepository,
    vehicles as unknown as VehiclesRepository,
    drivers as unknown as DriversRepository,
    clock,
  );
  return { repository, vehicles, drivers, service };
}

function latestBy(byVehicle: UsagePeriod | null, byDriver: UsagePeriod | null) {
  return async (where: { vehicleId: string } | { driverId: string }) => ('vehicleId' in where ? byVehicle : byDriver);
}

const startDto = (startedAt?: string) => ({ vehicleId: VEHICLE_ID, driverId: DRIVER_ID, reason: REASON, startedAt });

describe('UsagesService: listagem', () => {
  it('converte cada registro com datas em ISO e mantém o término vazio enquanto ativo', async () => {
    const { repository, service } = setup();
    repository.findMany.mockResolvedValue([
      usageRecord(),
      usageRecord({
        id: '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
        startedAt: new Date('2026-10-24T08:00:00.000Z'),
        endedAt: new Date('2026-10-24T18:30:00.000Z'),
        reason: 'Entrega de documentos no centro',
      }),
    ]);

    await expect(service.list()).resolves.toEqual([
      { id: USAGE_ID, startedAt: '2026-10-25T11:00:00.000Z', endedAt: null, reason: REASON, driver: DRIVER, vehicle: VEHICLE },
      {
        id: '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
        startedAt: '2026-10-24T08:00:00.000Z',
        endedAt: '2026-10-24T18:30:00.000Z',
        reason: 'Entrega de documentos no centro',
        driver: DRIVER,
        vehicle: VEHICLE,
      },
    ]);
    expect(repository.findMany).toHaveBeenCalledTimes(1);
  });

  it('devolve lista vazia quando não há utilizações', async () => {
    const { service } = setup();

    await expect(service.list()).resolves.toEqual([]);
  });
});

describe('UsagesService: início de utilização', () => {
  it('usa o horário do relógio quando startedAt não é informado e devolve a utilização criada', async () => {
    const { repository, vehicles, drivers, service } = setup();

    await expect(service.start(startDto())).resolves.toEqual({
      id: USAGE_ID,
      startedAt: '2026-10-25T12:00:00.000Z',
      endedAt: null,
      reason: REASON,
      driver: DRIVER,
      vehicle: VEHICLE,
    });
    expect(repository.transaction).toHaveBeenCalledTimes(1);
    expect(vehicles.lockById).toHaveBeenCalledWith(VEHICLE_ID, TX);
    expect(drivers.lockById).toHaveBeenCalledWith(DRIVER_ID, TX);
    expect(repository.findLatest).toHaveBeenCalledWith({ vehicleId: VEHICLE_ID }, TX);
    expect(repository.findLatest).toHaveBeenCalledWith({ driverId: DRIVER_ID }, TX);
    expect(repository.create).toHaveBeenCalledTimes(1);
    expect(repository.create).toHaveBeenCalledWith({ vehicleId: VEHICLE_ID, driverId: DRIVER_ID, startedAt: NOW, reason: REASON }, TX);
  });

  it('converte o startedAt informado com fuso para o instante correto', async () => {
    const { repository, service } = setup();

    const created = await service.start(startDto('2026-10-25T08:00:00-03:00'));
    expect(created.startedAt).toBe('2026-10-25T11:00:00.000Z');
    expect(repository.create).toHaveBeenCalledWith(
      { vehicleId: VEHICLE_ID, driverId: DRIVER_ID, startedAt: new Date('2026-10-25T11:00:00.000Z'), reason: REASON },
      TX,
    );
  });

  it('aceita início exatamente no instante atual', async () => {
    const { repository, service } = setup();

    await expect(service.start(startDto('2026-10-25T12:00:00.000Z'))).resolves.toMatchObject({ startedAt: '2026-10-25T12:00:00.000Z' });
    expect(repository.create).toHaveBeenCalledTimes(1);
  });

  it('rejeita início no futuro com 422 no campo startedAt sem abrir transação', async () => {
    const { repository, vehicles, service } = setup();

    const error = await rejectionOf(service.start(startDto('2026-10-25T12:00:01.000Z')));
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect(error.getStatus()).toBe(422);
    expect(error.getResponse()).toEqual({
      message: 'A data de início não pode estar no futuro.',
      errors: [{ field: 'startedAt', message: 'A data de início não pode estar no futuro.' }],
    });
    expect(repository.transaction).not.toHaveBeenCalled();
    expect(vehicles.lockById).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('responde 422 no campo vehicleId quando o automóvel não existe', async () => {
    const { repository, vehicles, drivers, service } = setup();
    vehicles.lockById.mockResolvedValue(false);

    const error = await rejectionOf(service.start(startDto()));
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect(error.getResponse()).toEqual({
      message: 'Automóvel não encontrado.',
      errors: [{ field: 'vehicleId', message: 'Automóvel não encontrado.' }],
    });
    expect(vehicles.lockById).toHaveBeenCalledWith(VEHICLE_ID, TX);
    expect(drivers.lockById).not.toHaveBeenCalled();
    expect(repository.findLatest).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('responde 422 no campo driverId quando o motorista não existe', async () => {
    const { repository, drivers, service } = setup();
    drivers.lockById.mockResolvedValue(false);

    const error = await rejectionOf(service.start(startDto()));
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect(error.getResponse()).toEqual({
      message: 'Motorista não encontrado.',
      errors: [{ field: 'driverId', message: 'Motorista não encontrado.' }],
    });
    expect(drivers.lockById).toHaveBeenCalledWith(DRIVER_ID, TX);
    expect(repository.findLatest).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('responde 409 no campo vehicleId quando o automóvel está em uso e não consulta o motorista', async () => {
    const { repository, service } = setup();
    repository.findLatest.mockImplementation(latestBy(period('2026-10-25T09:00:00.000Z'), null));

    const error = await rejectionOf(service.start(startDto()));
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toEqual({
      message: 'O automóvel já está em uso por um motorista.',
      errors: [{ field: 'vehicleId', message: 'O automóvel já está em uso por um motorista.' }],
    });
    expect(repository.findLatest).toHaveBeenCalledTimes(1);
    expect(repository.findLatest).toHaveBeenCalledWith({ vehicleId: VEHICLE_ID }, TX);
    expect(repository.findLatest).not.toHaveBeenCalledWith({ driverId: DRIVER_ID }, TX);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('responde 409 quando o automóvel estava em uso no período retroativo', async () => {
    const { repository, service } = setup();
    repository.findLatest.mockImplementation(latestBy(period('2026-10-25T08:00:00.000Z', '2026-10-25T11:30:00.000Z'), null));

    const error = await rejectionOf(service.start(startDto('2026-10-25T11:00:00.000Z')));
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toEqual({
      message: 'O automóvel já estava em uso no período informado.',
      errors: [{ field: 'vehicleId', message: 'O automóvel já estava em uso no período informado.' }],
    });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('responde 409 no campo driverId quando o motorista já está utilizando outro automóvel', async () => {
    const { repository, service } = setup();
    repository.findLatest.mockImplementation(latestBy(null, period('2026-10-25T10:00:00.000Z')));

    const error = await rejectionOf(service.start(startDto()));
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toEqual({
      message: 'O motorista já está utilizando outro automóvel.',
      errors: [{ field: 'driverId', message: 'O motorista já está utilizando outro automóvel.' }],
    });
    expect(repository.findLatest).toHaveBeenCalledWith({ driverId: DRIVER_ID }, TX);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('responde 409 quando o motorista estava em outra utilização no período retroativo', async () => {
    const { repository, service } = setup();
    repository.findLatest.mockImplementation(latestBy(null, period('2026-10-25T07:00:00.000Z', '2026-10-25T09:00:00.000Z')));

    const error = await rejectionOf(service.start(startDto('2026-10-25T05:30:00-03:00')));
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toEqual({
      message: 'O motorista já estava utilizando um automóvel no período informado.',
      errors: [{ field: 'driverId', message: 'O motorista já estava utilizando um automóvel no período informado.' }],
    });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('permite iniciar exatamente quando as utilizações anteriores terminaram', async () => {
    const { repository, service } = setup();
    repository.findLatest.mockImplementation(
      latestBy(
        period('2026-10-25T08:00:00.000Z', '2026-10-25T11:00:00.000Z'),
        period('2026-10-25T06:00:00.000Z', '2026-10-25T10:00:00.000Z'),
      ),
    );

    await expect(service.start(startDto('2026-10-25T11:00:00.000Z'))).resolves.toMatchObject({ startedAt: '2026-10-25T11:00:00.000Z' });
    expect(repository.findLatest).toHaveBeenCalledTimes(2);
    expect(repository.create).toHaveBeenCalledTimes(1);
  });
});

describe('UsagesService: finalização', () => {
  it('responde 404 quando a utilização não existe', async () => {
    const { repository, service } = setup();
    repository.lockPeriod.mockResolvedValue(null);

    const error = await rejectionOf(service.finish(USAGE_ID, {}));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.getResponse()).toEqual({ statusCode: 404, error: 'Not Found', message: 'Utilização não encontrada.' });
    expect(repository.lockPeriod).toHaveBeenCalledWith(USAGE_ID, TX);
    expect(repository.finish).not.toHaveBeenCalled();
  });

  it('responde 409 quando a utilização já foi finalizada', async () => {
    const { repository, service } = setup();
    repository.lockPeriod.mockResolvedValue(period('2026-10-25T08:00:00.000Z', '2026-10-25T10:00:00.000Z'));

    const error = await rejectionOf(service.finish(USAGE_ID, {}));
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toEqual({ statusCode: 409, error: 'Conflict', message: 'Esta utilização já foi finalizada.' });
    expect(repository.finish).not.toHaveBeenCalled();
  });

  it('rejeita término anterior ao início com 422 no campo endedAt', async () => {
    const { repository, service } = setup();

    const error = await rejectionOf(service.finish(USAGE_ID, { endedAt: '2026-10-25T10:59:59.000Z' }));
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect(error.getResponse()).toEqual({
      message: 'A data de término deve ser posterior à data de início.',
      errors: [{ field: 'endedAt', message: 'A data de término deve ser posterior à data de início.' }],
    });
    expect(repository.finish).not.toHaveBeenCalled();
  });

  it('rejeita término igual ao início', async () => {
    const { repository, service } = setup();

    const error = await rejectionOf(service.finish(USAGE_ID, { endedAt: '2026-10-25T08:00:00-03:00' }));
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect(error.getResponse()).toEqual({
      message: 'A data de término deve ser posterior à data de início.',
      errors: [{ field: 'endedAt', message: 'A data de término deve ser posterior à data de início.' }],
    });
    expect(repository.finish).not.toHaveBeenCalled();
  });

  it('rejeita término no futuro com 422 no campo endedAt', async () => {
    const { repository, service } = setup();

    const error = await rejectionOf(service.finish(USAGE_ID, { endedAt: '2026-10-25T12:00:01.000Z' }));
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect(error.getStatus()).toBe(422);
    expect(error.getResponse()).toEqual({
      message: 'A data de término não pode estar no futuro.',
      errors: [{ field: 'endedAt', message: 'A data de término não pode estar no futuro.' }],
    });
    expect(repository.finish).not.toHaveBeenCalled();
  });

  it('usa o horário do relógio quando endedAt não é informado e devolve a utilização finalizada', async () => {
    const { repository, service } = setup();

    await expect(service.finish(USAGE_ID, {})).resolves.toEqual({
      id: USAGE_ID,
      startedAt: '2026-10-25T11:00:00.000Z',
      endedAt: '2026-10-25T12:00:00.000Z',
      reason: REASON,
      driver: DRIVER,
      vehicle: VEHICLE,
    });
    expect(repository.transaction).toHaveBeenCalledTimes(1);
    expect(repository.lockPeriod).toHaveBeenCalledWith(USAGE_ID, TX);
    expect(repository.finish).toHaveBeenCalledTimes(1);
    expect(repository.finish).toHaveBeenCalledWith(USAGE_ID, NOW, TX);
  });

  it('converte o endedAt informado com fuso para o instante correto', async () => {
    const { repository, service } = setup();

    const finished = await service.finish(USAGE_ID, { endedAt: '2026-10-25T08:30:00-03:00' });
    expect(finished.endedAt).toBe('2026-10-25T11:30:00.000Z');
    expect(repository.finish).toHaveBeenCalledWith(USAGE_ID, new Date('2026-10-25T11:30:00.000Z'), TX);
  });

  it('aceita término exatamente no instante atual', async () => {
    const { repository, service } = setup();

    await expect(service.finish(USAGE_ID, { endedAt: '2026-10-25T12:00:00.000Z' })).resolves.toMatchObject({
      endedAt: '2026-10-25T12:00:00.000Z',
    });
    expect(repository.finish).toHaveBeenCalledWith(USAGE_ID, NOW, TX);
  });
});
