import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { trim, trimOrOmit } from '../../../common/http/validation.js';
import { normalizePlate, PLATE_PATTERN } from '../domain/plate.js';

const PLATE_DESCRIPTION =
  'Placa no padrão antigo (ABC1234) ou Mercosul (ABC1D23). Minúsculas viram maiúsculas; espaços e hífen são removidos.';
const PLATE_MESSAGE = 'Placa inválida: use o formato ABC1234 ou ABC1D23.';

const WhenSent = () => ValidateIf((_object, value) => value !== undefined);

export class CreateVehicleRequestDto {
  @ApiProperty({ example: 'ABC1D23', description: PLATE_DESCRIPTION })
  @Transform(({ value }) => normalizePlate(value))
  @IsString({ message: PLATE_MESSAGE })
  @Matches(PLATE_PATTERN, { message: PLATE_MESSAGE })
  plate: string;

  @ApiProperty({ example: 'Prata' })
  @Transform(trim)
  @IsNotEmpty({ message: 'Informe a cor.' })
  @IsString({ message: 'Cor inválida.' })
  @MaxLength(40, { message: 'A cor deve ter no máximo 40 caracteres.' })
  color: string;

  @ApiProperty({ example: 'Fiat' })
  @Transform(trim)
  @IsNotEmpty({ message: 'Informe a marca.' })
  @IsString({ message: 'Marca inválida.' })
  @MaxLength(60, { message: 'A marca deve ter no máximo 60 caracteres.' })
  brand: string;
}

export class UpdateVehicleRequestDto {
  @ApiPropertyOptional({ example: 'ABC1D23', description: PLATE_DESCRIPTION })
  @WhenSent()
  @Transform(({ value }) => normalizePlate(value))
  @IsString({ message: PLATE_MESSAGE })
  @Matches(PLATE_PATTERN, { message: PLATE_MESSAGE })
  plate?: string;

  @ApiPropertyOptional({ example: 'Preto' })
  @WhenSent()
  @Transform(trim)
  @IsNotEmpty({ message: 'Informe a cor.' })
  @IsString({ message: 'Cor inválida.' })
  @MaxLength(40, { message: 'A cor deve ter no máximo 40 caracteres.' })
  color?: string;

  @ApiPropertyOptional({ example: 'Volkswagen' })
  @WhenSent()
  @Transform(trim)
  @IsNotEmpty({ message: 'Informe a marca.' })
  @IsString({ message: 'Marca inválida.' })
  @MaxLength(60, { message: 'A marca deve ter no máximo 60 caracteres.' })
  brand?: string;
}

export class ListVehiclesQueryDto {
  @ApiPropertyOptional({ example: 'Prata', description: 'Filtra pela cor exata, sem diferenciar maiúsculas.' })
  @IsOptional()
  @Transform(trimOrOmit)
  @IsString({ message: 'Cor inválida.' })
  @MaxLength(40, { message: 'A cor deve ter no máximo 40 caracteres.' })
  color?: string;

  @ApiPropertyOptional({ example: 'Fiat', description: 'Filtra pela marca exata, sem diferenciar maiúsculas.' })
  @IsOptional()
  @Transform(trimOrOmit)
  @IsString({ message: 'Marca inválida.' })
  @MaxLength(60, { message: 'A marca deve ter no máximo 60 caracteres.' })
  brand?: string;
}
