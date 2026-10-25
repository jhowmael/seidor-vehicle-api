import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { escapeLike } from '../../database/like.js';
import { PrismaService } from '../../database/prisma.service.js';

export type Db = PrismaService | Prisma.TransactionClient;
export type VehicleRecord = Prisma.VehicleGetPayload<{ select: typeof vehicleSelect }>;

export interface VehicleFilters {
  color?: string;
  brand?: string;
}

export interface VehicleData {
  plate: string;
  color: string;
  brand: string;
}

export const vehicleSelect = { id: true, plate: true, color: true, brand: true } satisfies Prisma.VehicleSelect;

@Injectable()
export class VehiclesRepository {
  constructor(private readonly prisma: PrismaService) {}

  transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work);
  }

  findMany({ color, brand }: VehicleFilters): Promise<VehicleRecord[]> {
    const where: Prisma.VehicleWhereInput = { deletedAt: null };
    if (color) where.color = { equals: escapeLike(color), mode: 'insensitive' };
    if (brand) where.brand = { equals: escapeLike(brand), mode: 'insensitive' };
    return this.prisma.vehicle.findMany({ where, select: vehicleSelect, orderBy: [{ plate: 'asc' }] });
  }

  findById(id: string, db: Db = this.prisma): Promise<VehicleRecord | null> {
    return db.vehicle.findFirst({ where: { id, deletedAt: null }, select: vehicleSelect });
  }

  async isPlateTaken(plate: string, exceptId?: string, db: Db = this.prisma): Promise<boolean> {
    const found = await db.vehicle.findFirst({
      where: { plate, deletedAt: null, id: exceptId ? { not: exceptId } : undefined },
      select: { id: true },
    });
    return found !== null;
  }

  async lockById(id: string, tx: Prisma.TransactionClient): Promise<boolean> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "vehicles" WHERE "id" = ${id}::uuid AND "deleted_at" IS NULL FOR UPDATE`;
    return rows.length > 0;
  }

  async isInUse(id: string, db: Db = this.prisma): Promise<boolean> {
    return (await db.usage.count({ where: { vehicleId: id, endedAt: null } })) > 0;
  }

  create(data: VehicleData, db: Db = this.prisma): Promise<VehicleRecord> {
    return db.vehicle.create({ data, select: vehicleSelect });
  }

  update(id: string, data: Partial<VehicleData>, db: Db = this.prisma): Promise<VehicleRecord> {
    return db.vehicle.update({ where: { id }, data, select: vehicleSelect });
  }

  async softDelete(id: string, deletedAt: Date, db: Db = this.prisma): Promise<void> {
    await db.vehicle.update({ where: { id }, data: { deletedAt } });
  }
}
