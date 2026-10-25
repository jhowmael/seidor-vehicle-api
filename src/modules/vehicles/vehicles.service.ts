import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ClockService } from '../../common/clock/clock.service.js';
import type { CreateVehicleRequestDto, ListVehiclesQueryDto, UpdateVehicleRequestDto } from './dto/vehicles-request.dto.js';
import type { VehicleResponseDto } from './dto/vehicles-response.dto.js';
import { VehiclesRepository } from './vehicles.repository.js';

const NOT_FOUND_MESSAGE = 'Automóvel não encontrado.';

const plateTaken = (plate: string) => new ConflictException(`Já existe um automóvel cadastrado com a placa ${plate}.`);

@Injectable()
export class VehiclesService {
  constructor(
    private readonly repository: VehiclesRepository,
    private readonly clock: ClockService,
  ) {}

  list(query: ListVehiclesQueryDto): Promise<VehicleResponseDto[]> {
    return this.repository.findMany({ color: query.color, brand: query.brand });
  }

  async findOne(id: string): Promise<VehicleResponseDto> {
    const vehicle = await this.repository.findById(id);
    if (!vehicle) throw new NotFoundException(NOT_FOUND_MESSAGE);
    return vehicle;
  }

  async create(dto: CreateVehicleRequestDto): Promise<VehicleResponseDto> {
    if (await this.repository.isPlateTaken(dto.plate)) throw plateTaken(dto.plate);
    return this.repository.create({ plate: dto.plate, color: dto.color, brand: dto.brand });
  }

  async update(id: string, dto: UpdateVehicleRequestDto): Promise<VehicleResponseDto> {
    if (dto.plate === undefined && dto.color === undefined && dto.brand === undefined) {
      throw new BadRequestException('Informe ao menos um campo para atualizar: plate, color ou brand.');
    }
    return this.repository.transaction(async (tx) => {
      if (!(await this.repository.lockById(id, tx))) throw new NotFoundException(NOT_FOUND_MESSAGE);
      if (dto.plate !== undefined && (await this.repository.isPlateTaken(dto.plate, id, tx))) throw plateTaken(dto.plate);
      return this.repository.update(id, { plate: dto.plate, color: dto.color, brand: dto.brand }, tx);
    });
  }

  async remove(id: string): Promise<void> {
    await this.repository.transaction(async (tx) => {
      if (!(await this.repository.lockById(id, tx))) throw new NotFoundException(NOT_FOUND_MESSAGE);
      if (await this.repository.isInUse(id, tx)) {
        throw new ConflictException('O automóvel está em uso e não pode ser excluído. Finalize a utilização antes.');
      }
      await this.repository.softDelete(id, this.clock.now(), tx);
    });
  }
}
