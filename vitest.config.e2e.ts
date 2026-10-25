import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'vitest/config';

const explicitDatabaseUrl = process.env['DATABASE_URL'];
loadEnv({ quiet: true });

const databaseUrl = process.env['TEST_DATABASE_URL'] || explicitDatabaseUrl || '';

process.env['TEST_DATABASE_URL'] = databaseUrl;

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    globalSetup: ['./test/support/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      TEST_DATABASE_URL: databaseUrl,
      API_KEY: '',
      THROTTLE_LIMIT: '100000',
      THROTTLE_TTL_SECONDS: '60',
      CORS_ORIGIN: 'http://localhost:5173',
    },
  },
});
