import type { INestApplication, Type } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface OpenApiSources {
  AppModule: Type;
  PrismaService: Type;
  buildOpenApiDocument: (app: INestApplication) => OpenAPIObject;
}

export const OPENAPI_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'openapi.json');

export const OFFLINE_DATABASE_URL = 'postgresql://openapi:openapi@localhost:5432/openapi';

export function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

export async function renderOpenApi({ AppModule, PrismaService, buildOpenApiDocument }: OpenApiSources): Promise<string> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue({})
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  try {
    return `${JSON.stringify(sortKeys(buildOpenApiDocument(app)), null, 2)}\n`;
  } finally {
    await app.close();
  }
}
