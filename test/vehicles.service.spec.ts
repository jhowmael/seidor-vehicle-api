import { BadRequestException, ConflictException, NotFoundException, type HttpException } from '@nestjs/common';
import type { ClockService } from '../src/common/clock/clock.service.js';
import type { Prisma } from '../src/generated/prisma/client.js';
import type { VehiclesRepository } from '../src/modules/vehicles/vehicles.repository.js';
import { VehiclesService } from '../src/modules/vehicles/vehicles.service.js';

const NOW = new Date('2026-10-25T12:00:00.000Z');
const ID = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b';
const TX = { tx: 'vehicles' } as unknown as Prisma.TransactionClient;
const VEHICLE = { id: ID, plate: 'ABC1D23', color: 'Prata', brand: 'Fiat' };

const rejectionOf = (promise: Promise<unknown>) =>
  promise.then(
    () => expect.unreachable('a operação deveria ter falhado'),
    (error: unknown) => error as HttpException,
  );

function setup() {
  const repository = {
    transaction: vi.fn<VehiclesRepository['transaction']>((work) => work(TX)),
    findMany: vi.fn<VehiclesRepository['findMany']>().mockResolvedValue([VEHICLE]),
    findById: vi.fn<VehiclesRepository['findById']>().mockResolvedValue(VEHICLE),
    isPlateTaken: vi.fn<VehiclesRepository['isPlateTaken']>().mockResolvedValue(false),
    lockById: vi.fn<VehiclesRepository['lockById']>().mockResolvedValue(true),
    isInUse: vi.fn<VehiclesRepository['isInUse']>().mockResolvedValue(false),
    create: vi.fn<VehiclesRepository['create']>().mockResolvedValue(VEHICLE),
    update: vi.fn<VehiclesRepository['update']>().mockResolvedValue(VEHICLE),
    softDelete: vi.fn<VehiclesRepository['softDelete']>().mockResolvedValue(undefined),
  };
  const clock: ClockService = { now: () => NOW };
  const service = new VehiclesService(repository as unknown as VehiclesRepository, clock);
  return { repository, service };
}

describe('VehiclesService: listagem e consulta', () => {
  it('repassa os filtros de cor e marca ao repositório e devolve o resultado', async () => {
    const { repository, service } = setup();

    await expect(service.list({ color: 'Prata', brand: 'Fiat' })).resolves.toEqual([VEHICLE]);
    expect(repository.findMany).toHaveBeenCalledTimes(1);
    expect(repository.findMany).toHaveBeenCalledWith({ color: 'Prata', brand: 'Fiat' });
  });

  it('lista sem filtros quando a consulta vem vazia', async () => {
    const { repository, service } = setup();
    repository.findMany.mockResolvedValue([]);

    await expect(service.list({})).resolves.toEqual([]);
    expect(repository.findMany).toHaveBeenCalledWith({ color: undefined, brand: undefined });
  });

  it('devolve o automóvel encontrado pelo id', async () => {
    const { repository, service } = setup();

    await expect(service.findOne(ID)).resolves.toEqual(VEHICLE);
    expect(repository.findById).toHaveBeenCalledWith(ID);
  });

  it('responde 404 quando o automóvel não existe', async () => {
    const { repository, service } = setup();
    repository.findById.mockResolvedValue(null);

    const error = await rejectionOf(service.findOne(ID));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.getResponse()).toEqual({ statusCode: 404, error: 'Not Found', message: 'Automóvel não encontrado.' });
  });
});

describe('VehiclesService: cadastro', () => {
  it('cria o automóvel quando a placa está livre', async () => {
    const { repository, service } = setup();

    await expect(service.create({ plate: 'ABC1D23', color: 'Prata', brand: 'Fiat' })).resolves.toEqual(VEHICLE);
    expect(repository.isPlateTaken).toHaveBeenCalledTimes(1);
    expect(repository.isPlateTaken).toHaveBeenCalledWith('ABC1D23');
    expect(repository.create).toHaveBeenCalledTimes(1);
    expect(repository.create).toHaveBeenCalledWith({ plate: 'ABC1D23', color: 'Prata', brand: 'Fiat' });
  });

  it('rejeita placa já cadastrada sem chamar a criação', async () => {
    const { repository, service } = setup();
    repository.isPlateTaken.mockResolvedValue(true);

    const error = await rejectionOf(service.create({ plate: 'ABC1D23', color: 'Prata', brand: 'Fiat' }));
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toEqual({
      statusCode: 409,
      error: 'Conflict',
      message: 'Já existe um automóvel cadastrado com a placa ABC1D23.',
    });
    expect(repository.create).not.toHaveBeenCalled();
  });
});

describe('VehiclesService: atualização', () => {
  it('exige ao menos um campo e não abre transação', async () => {
    const { repository, service } = setup();

    const error = await rejectionOf(service.update(ID, {}));
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getResponse()).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Informe ao menos um campo para atualizar: plate, color ou brand.',
    });
    expect(repository.transaction).not.toHaveBeenCalled();
    expect(repository.lockById).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('responde 404 quando o automóvel não existe e não altera nada', async () => {
    const { repository, service } = setup();
    repository.lockById.mockResolvedValue(false);

    const error = await rejectionOf(service.update(ID, { plate: 'BRA2E19' }));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.getResponse()).toEqual({ statusCode: 404, error: 'Not Found', message: 'Automóvel não encontrado.' });
    expect(repository.lockById).toHaveBeenCalledWith(ID, TX);
    expect(repository.isPlateTaken).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('verifica a placa ignorando o próprio automóvel dentro da transação', async () => {
    const { repository, service } = setup();
    const updated = { ...VEHICLE, plate: 'BRA2E19' };
    repository.update.mockResolvedValue(updated);

    await expect(service.update(ID, { plate: 'BRA2E19' })).resolves.toEqual(updated);
    expect(repository.transaction).toHaveBeenCalledTimes(1);
    expect(repository.lockById).toHaveBeenCalledWith(ID, TX);
    expect(repository.isPlateTaken).toHaveBeenCalledWith('BRA2E19', ID, TX);
    expect(repository.update).toHaveBeenCalledWith(ID, { plate: 'BRA2E19', color: undefined, brand: undefined }, TX);
  });

  it('rejeita placa usada por outro automóvel sem atualizar', async () => {
    const { repository, service } = setup();
    repository.isPlateTaken.mockResolvedValue(true);

    const error = await rejectionOf(service.update(ID, { plate: 'BRA2E19', color: 'Preto' }));
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toEqual({
      statusCode: 409,
      error: 'Conflict',
      message: 'Já existe um automóvel cadastrado com a placa BRA2E19.',
    });
    expect(repository.isPlateTaken).toHaveBeenCalledWith('BRA2E19', ID, TX);
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('não consulta a placa quando ela não é enviada', async () => {
    const { repository, service } = setup();
    const updated = { ...VEHICLE, color: 'Preto', brand: 'Volkswagen' };
    repository.update.mockResolvedValue(updated);

    await expect(service.update(ID, { color: 'Preto', brand: 'Volkswagen' })).resolves.toEqual(updated);
    expect(repository.isPlateTaken).not.toHaveBeenCalled();
    expect(repository.update).toHaveBeenCalledWith(ID, { plate: undefined, color: 'Preto', brand: 'Volkswagen' }, TX);
  });

  it('atualiza todos os campos de uma vez', async () => {
    const { repository, service } = setup();
    const updated = { id: ID, plate: 'XYZ9876', color: 'Preto', brand: 'Chevrolet' };
    repository.update.mockResolvedValue(updated);

    await expect(service.update(ID, { plate: 'XYZ9876', color: 'Preto', brand: 'Chevrolet' })).resolves.toEqual(updated);
    expect(repository.isPlateTaken).toHaveBeenCalledWith('XYZ9876', ID, TX);
    expect(repository.update).toHaveBeenCalledWith(ID, { plate: 'XYZ9876', color: 'Preto', brand: 'Chevrolet' }, TX);
  });
});

describe('VehiclesService: exclusão', () => {
  it('responde 404 quando o automóvel não existe', async () => {
    const { repository, service } = setup();
    repository.lockById.mockResolvedValue(false);

    const error = await rejectionOf(service.remove(ID));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.getResponse()).toEqual({ statusCode: 404, error: 'Not Found', message: 'Automóvel não encontrado.' });
    expect(repository.lockById).toHaveBeenCalledWith(ID, TX);
    expect(repository.isInUse).not.toHaveBeenCalled();
    expect(repository.softDelete).not.toHaveBeenCalled();
  });

  it('bloqueia a exclusão enquanto o automóvel está em uso', async () => {
    const { repository, service } = setup();
    repository.isInUse.mockResolvedValue(true);

    const error = await rejectionOf(service.remove(ID));
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toEqual({
      statusCode: 409,
      error: 'Conflict',
      message: 'O automóvel está em uso e não pode ser excluído. Finalize a utilização antes.',
    });
    expect(repository.isInUse).toHaveBeenCalledWith(ID, TX);
    expect(repository.softDelete).not.toHaveBeenCalled();
  });

  it('faz a exclusão lógica com a data do relógio dentro da transação', async () => {
    const { repository, service } = setup();

    await expect(service.remove(ID)).resolves.toBeUndefined();
    expect(repository.transaction).toHaveBeenCalledTimes(1);
    expect(repository.lockById).toHaveBeenCalledWith(ID, TX);
    expect(repository.isInUse).toHaveBeenCalledWith(ID, TX);
    expect(repository.softDelete).toHaveBeenCalledTimes(1);
    expect(repository.softDelete).toHaveBeenCalledWith(ID, NOW, TX);
  });
});
