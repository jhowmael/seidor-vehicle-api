import type { PrismaClient } from '../src/generated/prisma/client.js';

const HOUR = 3_600_000;

const TRUNCATE_ALL = 'TRUNCATE TABLE "usages", "vehicles", "drivers"';

export const SEED_VEHICLES = [
  { plate: 'RIO2A18', color: 'Prata', brand: 'Fiat' },
  { plate: 'BRA2E19', color: 'Branco', brand: 'Volkswagen' },
  { plate: 'XYZ9876', color: 'Preto', brand: 'Chevrolet' },
  { plate: 'QWE4R56', color: 'Prata', brand: 'Toyota' },
];

export const SEED_DRIVERS = [{ name: 'Daniela Alves' }, { name: 'Bruno Lima' }, { name: 'Carla Mendes' }];

export const SEED_USAGES = [
  { vehicle: 0, driver: 0, startedHoursAgo: 26, endedHoursAgo: 22, reason: 'Visita a cliente' },
  { vehicle: 1, driver: 1, startedHoursAgo: 2, endedHoursAgo: null, reason: 'Entrega de documentos no centro' },
];

export async function clearDatabase(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(TRUNCATE_ALL);
}

export async function seedDatabase(prisma: PrismaClient, now = new Date()) {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('O seed de dados fictícios não pode rodar em produção.');
  }

  const hoursAgo = (hours: number) => new Date(now.getTime() - hours * HOUR);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(TRUNCATE_ALL);

    const vehicles = [];
    for (const data of SEED_VEHICLES) vehicles.push(await tx.vehicle.create({ data }));

    const drivers = [];
    for (const data of SEED_DRIVERS) drivers.push(await tx.driver.create({ data }));

    for (const usage of SEED_USAGES) {
      await tx.usage.create({
        data: {
          vehicleId: vehicles[usage.vehicle].id,
          driverId: drivers[usage.driver].id,
          startedAt: hoursAgo(usage.startedHoursAgo),
          endedAt: usage.endedHoursAgo === null ? null : hoursAgo(usage.endedHoursAgo),
          reason: usage.reason,
        },
      });
    }
  });
}
