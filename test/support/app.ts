import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import request from 'supertest';
import { clearDatabase } from '../../prisma/seed-data.js';
import type { PrismaService } from '../../src/database/prisma.service.js';

export interface TestApp {
  app: INestApplication;
  prisma: PrismaService;
  http: () => ReturnType<typeof request>;
  close: () => Promise<void>;
}

export interface TestAppOptions {
  env?: Record<string, string>;
  override?: (builder: TestingModuleBuilder, tokens: { PrismaService: typeof PrismaService }) => TestingModuleBuilder;
}

export const resetDatabase = (prisma: PrismaService) => clearDatabase(prisma);

export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  Object.assign(process.env, options.env ?? {});

  const [{ AppModule }, { configureApp, setupSwagger }, prismaModule] = await Promise.all([
    import('../../src/app.module.js'),
    import('../../src/app.setup.js'),
    import('../../src/database/prisma.service.js'),
  ]);

  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (options.override) builder = options.override(builder, { PrismaService: prismaModule.PrismaService });

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  setupSwagger(app);
  await app.init();

  return {
    app,
    prisma: app.get(prismaModule.PrismaService),
    http: () => request(app.getHttpServer()),
    close: () => app.close(),
  };
}

export async function createVehicle(ctx: TestApp, data: { plate: string; color?: string; brand?: string }) {
  const response = await ctx
    .http()
    .post('/vehicles')
    .send({ color: 'Prata', brand: 'Fiat', ...data })
    .expect(201);
  return response.body as { id: string; plate: string; color: string; brand: string };
}

export async function createDriver(ctx: TestApp, name: string) {
  const response = await ctx.http().post('/drivers').send({ name }).expect(201);
  return response.body as { id: string; name: string };
}

export const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
