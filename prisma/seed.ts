import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { createPgAdapter } from '../src/database/pg-adapter.js';
import { SEED_DRIVERS, SEED_USAGES, SEED_VEHICLES, seedDatabase } from './seed-data.js';

const prisma = new PrismaClient({ adapter: createPgAdapter(process.env['DATABASE_URL']) });

seedDatabase(prisma)
  .then(async () => {
    console.log(
      `Seed concluído: ${SEED_VEHICLES.length} automóveis, ${SEED_DRIVERS.length} motoristas e ${SEED_USAGES.length} utilizações.`,
    );
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
