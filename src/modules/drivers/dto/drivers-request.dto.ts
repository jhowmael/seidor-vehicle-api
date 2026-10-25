import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { trim, trimOrOmit } from '../../../common/http/validation.js';

export class CreateDriverRequestDto {
  @ApiProperty({ example: 'Ana Souza' })
  @Transform(trim)
  @IsNotEmpty({ message: 'Informe o nome do motorista.' })
  @IsString({ message: 'Nome inválido.' })
  @MaxLength(120, { message: 'O nome deve ter no máximo 120 caracteres.' })
  name: string;
}

export class UpdateDriverRequestDto extends CreateDriverRequestDto {}

export class ListDriversQueryDto {
  @ApiPropertyOptional({ example: 'carla', description: 'Filtra pelo nome ou parte dele, sem diferenciar maiúsculas.' })
  @IsOptional()
  @Transform(trimOrOmit)
  @IsString({ message: 'Nome inválido.' })
  @MaxLength(120, { message: 'O nome deve ter no máximo 120 caracteres.' })
  name?: string;
}
