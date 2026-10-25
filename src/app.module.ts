import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { seconds, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ApiKeyGuard } from './common/auth/api-key.guard.js';
import { ClockModule } from './common/clock/clock.module.js';
import { HealthModule } from './common/health/health.module.js';
import { DEFAULT_THROTTLE_LIMIT, DEFAULT_THROTTLE_TTL_SECONDS, validateEnv } from './config/env.validation.js';
import { DatabaseModule } from './database/database.module.js';
import { DriversModule } from './modules/drivers/drivers.module.js';
import { UsagesModule } from './modules/usages/usages.module.js';
import { VehiclesModule } from './modules/vehicles/vehicles.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: seconds(config.get<number>('THROTTLE_TTL_SECONDS') ?? DEFAULT_THROTTLE_TTL_SECONDS),
            limit: config.get<number>('THROTTLE_LIMIT') ?? DEFAULT_THROTTLE_LIMIT,
          },
        ],
        errorMessage: 'Muitas requisições. Aguarde um instante e tente novamente.',
      }),
    }),
    DatabaseModule,
    ClockModule,
    HealthModule,
    VehiclesModule,
    DriversModule,
    UsagesModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: ApiKeyGuard },
  ],
})
export class AppModule {}
