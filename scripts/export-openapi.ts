import { writeFileSync } from 'node:fs';
import { OFFLINE_DATABASE_URL, OPENAPI_FILE, renderOpenApi } from './openapi-document.js';

process.env['DATABASE_URL'] ||= OFFLINE_DATABASE_URL;

const load = async <T>(path: string): Promise<T> => (await import(new URL(path, import.meta.url).href)) as T;

const [{ AppModule }, { PrismaService }, { buildOpenApiDocument }] = await Promise.all([
  load<typeof import('../src/app.module.js')>('../dist/app.module.js'),
  load<typeof import('../src/database/prisma.service.js')>('../dist/database/prisma.service.js'),
  load<typeof import('../src/app.setup.js')>('../dist/app.setup.js'),
]);

writeFileSync(OPENAPI_FILE, await renderOpenApi({ AppModule, PrismaService, buildOpenApiDocument }));
console.log(`OpenAPI gravado em ${OPENAPI_FILE}`);
