import { PrismaPg } from '@prisma/adapter-pg';

export const createPgAdapter = (connectionString: string | undefined) => new PrismaPg({ connectionString, options: '-c TimeZone=UTC' });
