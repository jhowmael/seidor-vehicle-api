import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ClockService } from '../../common/clock/clock.service.js';
import { DriversRepository } from '../drivers/drivers.repository.js';
import { VehiclesRepository } from '../vehicles/vehicles.repository.js';
import { availabilityConflict, validateFinish, validateStart, type RuleViolation } from './domain/usage-rules.js';
import type { FinishUsageRequestDto, StartUsageRequestDto } from './dto/usages-request.dto.js';
import type { UsageResponseDto } from './dto/usages-response.dto.js';
import { UsagesRepository, type UsageRecord } from './usages.repository.js';

const unprocessable = (violations: RuleViolation[]) =>
  new UnprocessableEntityException({ message: violations[0].message, errors: violations });

const conflict = (violation: RuleViolation) => new ConflictException({ message: violation.message, errors: [violation] });

const toResponse = (usage: UsageRecord): UsageResponseDto => ({
  id: usage.id,
  startedAt: usage.startedAt.toISOString(),
  endedAt: usage.endedAt ? usage.endedAt.toISOString() : null,
  reason: usage.reason,
  driver: usage.driver,
  vehicle: usage.vehicle,
});

@Injectable()
export class UsagesService {
  constructor(
    private readonly repository: UsagesRepository,
    private readonly vehicles: VehiclesRepository,
    private readonly drivers: DriversRepository,
    private readonly clock: ClockService,
  ) {}

  async list(): Promise<UsageResponseDto[]> {
    const usages = await this.repository.findMany();
    return usages.map(toResponse);
  }

  async start(dto: StartUsageRequestDto): Promise<UsageResponseDto> {
    const now = this.clock.now();
    const startedAt = dto.startedAt ? new Date(dto.startedAt) : now;
    const violations = validateStart(startedAt, now);
    if (violations.length > 0) throw unprocessable(violations);

    const usage = await this.repository.transaction(async (tx) => {
      if (!(await this.vehicles.lockById(dto.vehicleId, tx))) {
        throw unprocessable([{ field: 'vehicleId', message: 'Automóvel não encontrado.' }]);
      }
      if (!(await this.drivers.lockById(dto.driverId, tx))) {
        throw unprocessable([{ field: 'driverId', message: 'Motorista não encontrado.' }]);
      }

      const vehicleBusy = availabilityConflict('vehicle', await this.repository.findLatest({ vehicleId: dto.vehicleId }, tx), startedAt);
      if (vehicleBusy) throw conflict(vehicleBusy);

      const driverBusy = availabilityConflict('driver', await this.repository.findLatest({ driverId: dto.driverId }, tx), startedAt);
      if (driverBusy) throw conflict(driverBusy);

      return this.repository.create({ vehicleId: dto.vehicleId, driverId: dto.driverId, startedAt, reason: dto.reason }, tx);
    });
    return toResponse(usage);
  }

  async finish(id: string, dto: FinishUsageRequestDto): Promise<UsageResponseDto> {
    const now = this.clock.now();
    const endedAt = dto.endedAt ? new Date(dto.endedAt) : now;

    const usage = await this.repository.transaction(async (tx) => {
      const current = await this.repository.lockPeriod(id, tx);
      if (!current) throw new NotFoundException('Utilização não encontrada.');
      if (current.endedAt) throw new ConflictException('Esta utilização já foi finalizada.');

      const violations = validateFinish(current, endedAt, now);
      if (violations.length > 0) throw unprocessable(violations);

      return this.repository.finish(id, endedAt, tx);
    });
    return toResponse(usage);
  }
}
