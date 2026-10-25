import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ClockService } from '../../common/clock/clock.service.js';
import { DriversRepository } from './drivers.repository.js';
import type { CreateDriverRequestDto, ListDriversQueryDto, UpdateDriverRequestDto } from './dto/drivers-request.dto.js';
import type { DriverResponseDto } from './dto/drivers-response.dto.js';

const NOT_FOUND_MESSAGE = 'Motorista não encontrado.';

@Injectable()
export class DriversService {
  constructor(
    private readonly repository: DriversRepository,
    private readonly clock: ClockService,
  ) {}

  list(query: ListDriversQueryDto): Promise<DriverResponseDto[]> {
    return this.repository.findMany({ name: query.name });
  }

  async findOne(id: string): Promise<DriverResponseDto> {
    const driver = await this.repository.findById(id);
    if (!driver) throw new NotFoundException(NOT_FOUND_MESSAGE);
    return driver;
  }

  create(dto: CreateDriverRequestDto): Promise<DriverResponseDto> {
    return this.repository.create({ name: dto.name });
  }

  update(id: string, dto: UpdateDriverRequestDto): Promise<DriverResponseDto> {
    return this.repository.transaction(async (tx) => {
      if (!(await this.repository.lockById(id, tx))) throw new NotFoundException(NOT_FOUND_MESSAGE);
      return this.repository.update(id, { name: dto.name }, tx);
    });
  }

  async remove(id: string): Promise<void> {
    await this.repository.transaction(async (tx) => {
      if (!(await this.repository.lockById(id, tx))) throw new NotFoundException(NOT_FOUND_MESSAGE);
      if (await this.repository.isDriving(id, tx)) {
        throw new ConflictException('O motorista está utilizando um automóvel e não pode ser excluído. Finalize a utilização antes.');
      }
      await this.repository.softDelete(id, this.clock.now(), tx);
    });
  }
}
