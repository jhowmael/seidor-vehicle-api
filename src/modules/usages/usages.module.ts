import { Module } from '@nestjs/common';
import { DriversModule } from '../drivers/drivers.module.js';
import { VehiclesModule } from '../vehicles/vehicles.module.js';
import { UsagesController } from './usages.controller.js';
import { UsagesRepository } from './usages.repository.js';
import { UsagesService } from './usages.service.js';

@Module({
  imports: [VehiclesModule, DriversModule],
  controllers: [UsagesController],
  providers: [UsagesService, UsagesRepository],
})
export class UsagesModule {}
