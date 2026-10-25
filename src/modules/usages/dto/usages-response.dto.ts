import { ApiProperty } from '@nestjs/swagger';
import { DriverResponseDto } from '../../drivers/dto/drivers-response.dto.js';
import { VehicleResponseDto } from '../../vehicles/dto/vehicles-response.dto.js';

export class UsageResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-25T11:00:00.000Z' })
  startedAt: string;

  @ApiProperty({
    nullable: true,
    type: String,
    format: 'date-time',
    example: null,
    description: 'Vazio enquanto a utilização está em andamento.',
  })
  endedAt: string | null;

  @ApiProperty({ example: 'Visita ao cliente em Campinas' })
  reason: string;

  @ApiProperty({ type: DriverResponseDto })
  driver: DriverResponseDto;

  @ApiProperty({ type: VehicleResponseDto })
  vehicle: VehicleResponseDto;
}
