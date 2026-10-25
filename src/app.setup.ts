import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import helmet from 'helmet';
import { API_KEY_HEADER, API_KEY_SECURITY } from './common/auth/api-key.guard.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { REQUEST_ID_HEADER, requestIdMiddleware } from './common/http/request-id.middleware.js';
import { createValidationPipe } from './common/http/validation.js';

export const DOCS_PATH = 'docs';

export function allowedOrigins(value: string | undefined): string[] | true {
  const origins = (value ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return origins.length > 0 ? origins : true;
}

export function configureApp(app: INestApplication): INestApplication {
  const config = app.get(ConfigService);

  app.use(requestIdMiddleware);
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { 'upgrade-insecure-requests': null } },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.enableCors({
    origin: allowedOrigins(config.get<string>('CORS_ORIGIN')),
    allowedHeaders: ['Content-Type', API_KEY_HEADER, REQUEST_ID_HEADER],
    exposedHeaders: ['X-Request-Id'],
  });
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());

  return app;
}

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  return SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Vehicle API')
      .setDescription(
        'API para controlar a utilização dos automóveis de uma empresa: cadastro de automóveis, de motoristas e registro de utilizações. Quando a variável API_KEY está definida no servidor, envie o cabeçalho x-api-key em todas as rotas, exceto /health e /docs.',
      )
      .setVersion('0.1.0')
      .addApiKey(
        { type: 'apiKey', in: 'header', name: API_KEY_HEADER, description: 'Chave de API (exigida quando API_KEY está definida).' },
        API_KEY_SECURITY,
      )
      .build(),
  );
}

export function setupSwagger(app: INestApplication): OpenAPIObject {
  const document = buildOpenApiDocument(app);
  SwaggerModule.setup(DOCS_PATH, app, document);
  return document;
}
