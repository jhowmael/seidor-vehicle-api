import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsISO8601, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { trim } from '../../../common/http/validation.js';

const DATE_TIME_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

const dateTimeMessage = (label: string) => `${label} inválida: use data e hora com fuso, por exemplo 2026-10-25T08:00:00-03:00.`;

export class StartUsageRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'Automóvel inválido.' })
  vehicleId: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'Motorista inválido.' })
  driverId: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Data e hora de início com fuso, por exemplo 2026-10-25T08:00:00-03:00. Padrão: agora. Não pode estar no futuro.',
  })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: dateTimeMessage('Data de início') })
  @Matches(DATE_TIME_WITH_ZONE, { message: dateTimeMessage('Data de início') })
  startedAt?: string;

  @ApiProperty({ example: 'Visita ao cliente em Campinas' })
  @Transform(trim)
  @IsNotEmpty({ message: 'Informe o motivo da utilização.' })
  @IsString({ message: 'Motivo inválido.' })
  @MaxLength(500, { message: 'O motivo deve ter no máximo 500 caracteres.' })
  reason: string;
}

export class FinishUsageRequestDto {
  @ApiPropertyOptional({
    format: 'date-time',
    description:
      'Data e hora de término com fuso, por exemplo 2026-10-25T18:00:00-03:00. Padrão: agora. Deve ser posterior ao início e não pode estar no futuro.',
  })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: dateTimeMessage('Data de término') })
  @Matches(DATE_TIME_WITH_ZONE, { message: dateTimeMessage('Data de término') })
  endedAt?: string;
}
