import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { driverSelect } from '../drivers/drivers.repository.js';
import { vehicleSelect } from '../vehicles/vehicles.repository.js';
import type { UsagePeriod } from './domain/usage-rules.js';

export type Db = PrismaService | Prisma.TransactionClient;
export type UsageRecord = Prisma.UsageGetPayload<{ include: typeof usageInclude }>;

export interface UsageData {
  vehicleId: string;
  driverId: string;
  startedAt: Date;
  reason: string;
}

export const usageInclude = {
  vehicle: { select: vehicleSelect },
  driver: { select: driverSelect },
} satisfies Prisma.UsageInclude;

const periodSelect = { startedAt: true, endedAt: true } satisfies Prisma.UsageSelect;

@Injectable()
export class UsagesRepository {
  constructor(private readonly prisma: PrismaService) {}

  transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work);
  }

  findMany(): Promise<UsageRecord[]> {
    return this.prisma.usage.findMany({ include: usageInclude, orderBy: [{ startedAt: 'desc' }, { id: 'asc' }] });
  }

  async lockPeriod(id: string, tx: Prisma.TransactionClient): Promise<UsagePeriod | null> {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "usages" WHERE "id" = ${id}::uuid FOR UPDATE`;
    if (rows.length === 0) return null;
    return tx.usage.findUnique({ where: { id }, select: periodSelect });
  }

  findLatest(where: { vehicleId: string } | { driverId: string }, db: Db = this.prisma): Promise<UsagePeriod | null> {
    return db.usage.findFirst({ where, select: periodSelect, orderBy: { startedAt: 'desc' } });
  }

  create(data: UsageData, db: Db = this.prisma): Promise<UsageRecord> {
    return db.usage.create({ data, include: usageInclude });
  }

  finish(id: string, endedAt: Date, db: Db = this.prisma): Promise<UsageRecord> {
    return db.usage.update({ where: { id }, data: { endedAt }, include: usageInclude });
  }
}
