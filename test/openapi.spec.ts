import { existsSync, readFileSync } from 'node:fs';
import { OFFLINE_DATABASE_URL, OPENAPI_FILE, renderOpenApi } from '../scripts/openapi-document.js';

describe('openapi.json', () => {
  it('está atualizado em relação ao app (rode npm run openapi:export se falhar)', async () => {
    process.env['DATABASE_URL'] ||= OFFLINE_DATABASE_URL;
    const [{ AppModule }, { PrismaService }, { buildOpenApiDocument }] = await Promise.all([
      import('../src/app.module.js'),
      import('../src/database/prisma.service.js'),
      import('../src/app.setup.js'),
    ]);

    const generated = await renderOpenApi({ AppModule, PrismaService, buildOpenApiDocument });

    expect(existsSync(OPENAPI_FILE), 'openapi.json não existe').toBe(true);
    expect(JSON.parse(readFileSync(OPENAPI_FILE, 'utf8'))).toEqual(JSON.parse(generated));
    expect(readFileSync(OPENAPI_FILE, 'utf8').replace(/\r\n/g, '\n')).toBe(generated);
  }, 30_000);
});
