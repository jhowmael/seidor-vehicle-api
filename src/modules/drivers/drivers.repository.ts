import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { escapeLike } from '../../database/like.js';
import { PrismaService } from '../../database/prisma.service.js';

export type Db = PrismaService | Prisma.TransactionClient;
export type DriverRecord = Prisma.DriverGetPayload<{ select: typeof driverSelect }>;

export interface DriverFilters {
  name?: string;
}

export const driverSelect = { id: true, name: true } satisfies Prisma.DriverSelect;

@Injectable()
export class DriversRepository {
  constructor(private readonly prisma: PrismaService) {}

  transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work);
  }

  findMany({ name }: DriverFilters): Promise<DriverRecord[]> {
    const where: Prisma.DriverWhereInput = { deletedAt: null };
    if (name) where.name = { contains: escapeLike(name), mode: 'insensitive' };
    return this.prisma.driver.findMany({ where, select: driverSelect, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
  }

  findById(id: string, db: Db = this.prisma): Promise<DriverRecord | null> {
    return db.driver.findFirst({ where: { id, deletedAt: null }, select: driverSelect });
  }

  async lockById(id: string, tx: Prisma.TransactionClient): Promise<boolean> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "drivers" WHERE "id" = ${id}::uuid AND "deleted_at" IS NULL FOR UPDATE`;
    return rows.length > 0;
  }

  async isDriving(id: string, db: Db = this.prisma): Promise<boolean> {
    return (await db.usage.count({ where: { driverId: id, endedAt: null } })) > 0;
  }

  create(data: { name: string }, db: Db = this.prisma): Promise<DriverRecord> {
    return db.driver.create({ data, select: driverSelect });
  }

  update(id: string, data: { name: string }, db: Db = this.prisma): Promise<DriverRecord> {
    return db.driver.update({ where: { id }, data, select: driverSelect });
  }

  async softDelete(id: string, deletedAt: Date, db: Db = this.prisma): Promise<void> {
    await db.driver.update({ where: { id }, data: { deletedAt } });
  }
}
