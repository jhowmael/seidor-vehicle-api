import { execSync } from 'node:child_process';
import { clearDatabase } from '../../prisma/seed-data.js';
import { createPgAdapter } from '../../src/database/pg-adapter.js';
import { PrismaClient } from '../../src/generated/prisma/client.js';

const simulateServerOutsideUtc = (prisma: PrismaClient) =>
  prisma.$executeRawUnsafe(
    `DO $$ BEGIN EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'America/Sao_Paulo'); END $$`,
  );

export default async function setup() {
  const url = process.env['TEST_DATABASE_URL'];
  if (!url) {
    throw new Error(
      'Defina TEST_DATABASE_URL (ou DATABASE_URL) apontando para um PostgreSQL de teste. Os testes de integração apagam os dados desse banco.',
    );
  }
  if (process.env['NODE_ENV'] === 'production') throw new Error('Os testes de integração não podem rodar com NODE_ENV=production.');

  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url }, stdio: 'inherit' });

  const prisma = new PrismaClient({ adapter: createPgAdapter(url) });
  try {
    await simulateServerOutsideUtc(prisma);
    await clearDatabase(prisma);
  } finally {
    await prisma.$disconnect();
  }
}
