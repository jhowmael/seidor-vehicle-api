import { ConflictException, NotFoundException, type HttpException } from '@nestjs/common';
import type { ClockService } from '../src/common/clock/clock.service.js';
import type { Prisma } from '../src/generated/prisma/client.js';
import type { DriversRepository } from '../src/modules/drivers/drivers.repository.js';
import { DriversService } from '../src/modules/drivers/drivers.service.js';

const NOW = new Date('2026-10-25T12:00:00.000Z');
const ID = '2b7e4c1a-9d3f-4e8b-a6c5-0f1e2d3c4b5a';
const TX = { tx: 'drivers' } as unknown as Prisma.TransactionClient;
const DRIVER = { id: ID, name: 'Ana Souza' };

const rejectionOf = (promise: Promise<unknown>) =>
  promise.then(
    () => expect.unreachable('a operação deveria ter falhado'),
    (error: unknown) => error as HttpException,
  );

function setup() {
  const repository = {
    transaction: vi.fn<DriversRepository['transaction']>((work) => work(TX)),
    findMany: vi.fn<DriversRepository['findMany']>().mockResolvedValue([DRIVER]),
    findById: vi.fn<DriversRepository['findById']>().mockResolvedValue(DRIVER),
    lockById: vi.fn<DriversRepository['lockById']>().mockResolvedValue(true),
    isDriving: vi.fn<DriversRepository['isDriving']>().mockResolvedValue(false),
    create: vi.fn<DriversRepository['create']>().mockResolvedValue(DRIVER),
    update: vi.fn<DriversRepository['update']>().mockResolvedValue(DRIVER),
    softDelete: vi.fn<DriversRepository['softDelete']>().mockResolvedValue(undefined),
  };
  const clock: ClockService = { now: () => NOW };
  const service = new DriversService(repository as unknown as DriversRepository, clock);
  return { repository, service };
}

describe('DriversService: listagem e consulta', () => {
  it('repassa o filtro de nome ao repositório e devolve o resultado', async () => {
    const { repository, service } = setup();

    await expect(service.list({ name: 'ana' })).resolves.toEqual([DRIVER]);
    expect(repository.findMany).toHaveBeenCalledTimes(1);
    expect(repository.findMany).toHaveBeenCalledWith({ name: 'ana' });
  });

  it('lista sem filtro quando a consulta vem vazia', async () => {
    const { repository, service } = setup();
    repository.findMany.mockResolvedValue([]);

    await expect(service.list({})).resolves.toEqual([]);
    expect(repository.findMany).toHaveBeenCalledWith({ name: undefined });
  });

  it('devolve o motorista encontrado pelo id', async () => {
    const { repository, service } = setup();

    await expect(service.findOne(ID)).resolves.toEqual(DRIVER);
    expect(repository.findById).toHaveBeenCalledWith(ID);
  });

  it('responde 404 quando o motorista não existe', async () => {
    const { repository, service } = setup();
    repository.findById.mockResolvedValue(null);

    const error = await rejectionOf(service.findOne(ID));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.getResponse()).toEqual({ statusCode: 404, error: 'Not Found', message: 'Motorista não encontrado.' });
  });
});

describe('DriversService: cadastro e atualização', () => {
  it('cria o motorista repassando apenas o nome, sem abrir transação', async () => {
    const { repository, service } = setup();

    await expect(service.create({ name: 'Ana Souza' })).resolves.toEqual(DRIVER);
    expect(repository.create).toHaveBeenCalledTimes(1);
    expect(repository.create).toHaveBeenCalledWith({ name: 'Ana Souza' });
    expect(repository.transaction).not.toHaveBeenCalled();
  });

  it('atualiza o nome dentro da transação depois de travar o registro', async () => {
    const { repository, service } = setup();
    const updated = { id: ID, name: 'Ana Souza Lima' };
    repository.update.mockResolvedValue(updated);

    await expect(service.update(ID, { name: 'Ana Souza Lima' })).resolves.toEqual(updated);
    expect(repository.transaction).toHaveBeenCalledTimes(1);
    expect(repository.lockById).toHaveBeenCalledWith(ID, TX);
    expect(repository.update).toHaveBeenCalledWith(ID, { name: 'Ana Souza Lima' }, TX);
  });

  it('responde 404 ao atualizar motorista inexistente e não altera nada', async () => {
    const { repository, service } = setup();
    repository.lockById.mockResolvedValue(false);

    const error = await rejectionOf(service.update(ID, { name: 'Ana Souza Lima' }));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.getResponse()).toEqual({ statusCode: 404, error: 'Not Found', message: 'Motorista não encontrado.' });
    expect(repository.lockById).toHaveBeenCalledWith(ID, TX);
    expect(repository.update).not.toHaveBeenCalled();
  });
});

describe('DriversService: exclusão', () => {
  it('responde 404 quando o motorista não existe', async () => {
    const { repository, service } = setup();
    repository.lockById.mockResolvedValue(false);

    const error = await rejectionOf(service.remove(ID));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.getResponse()).toEqual({ statusCode: 404, error: 'Not Found', message: 'Motorista não encontrado.' });
    expect(repository.lockById).toHaveBeenCalledWith(ID, TX);
    expect(repository.isDriving).not.toHaveBeenCalled();
    expect(repository.softDelete).not.toHaveBeenCalled();
  });

  it('bloqueia a exclusão enquanto o motorista está utilizando um automóvel', async () => {
    const { repository, service } = setup();
    repository.isDriving.mockResolvedValue(true);

    const error = await rejectionOf(service.remove(ID));
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toEqual({
      statusCode: 409,
      error: 'Conflict',
      message: 'O motorista está utilizando um automóvel e não pode ser excluído. Finalize a utilização antes.',
    });
    expect(repository.isDriving).toHaveBeenCalledWith(ID, TX);
    expect(repository.softDelete).not.toHaveBeenCalled();
  });

  it('faz a exclusão lógica com a data do relógio dentro da transação', async () => {
    const { repository, service } = setup();

    await expect(service.remove(ID)).resolves.toBeUndefined();
    expect(repository.transaction).toHaveBeenCalledTimes(1);
    expect(repository.lockById).toHaveBeenCalledWith(ID, TX);
    expect(repository.isDriving).toHaveBeenCalledWith(ID, TX);
    expect(repository.softDelete).toHaveBeenCalledTimes(1);
    expect(repository.softDelete).toHaveBeenCalledWith(ID, NOW, TX);
  });
});
