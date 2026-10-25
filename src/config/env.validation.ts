import { plainToInstance, Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, Min, validateSync } from 'class-validator';

const toNumber = ({ value }: { value: unknown }) => (value === undefined || value === '' ? undefined : Number(value));

export const DEFAULT_THROTTLE_LIMIT = 120;
export const DEFAULT_THROTTLE_TTL_SECONDS = 60;

class EnvironmentVariables {
  @IsString({ message: 'DATABASE_URL deve ser um texto' })
  @IsNotEmpty({ message: 'Informe DATABASE_URL' })
  DATABASE_URL: string;

  @IsOptional()
  @Transform(toNumber)
  @IsInt({ message: 'PORT deve ser um número inteiro' })
  @Min(1, { message: 'PORT deve ser no mínimo 1' })
  @Max(65535, { message: 'PORT deve ser no máximo 65535' })
  PORT?: number;

  @IsOptional()
  @IsString()
  CORS_ORIGIN?: string;

  @IsOptional()
  @IsString()
  API_KEY?: string;

  @IsOptional()
  @Transform(toNumber)
  @IsInt({ message: 'THROTTLE_LIMIT deve ser um número inteiro' })
  @Min(1, { message: 'THROTTLE_LIMIT deve ser maior que zero' })
  THROTTLE_LIMIT?: number;

  @IsOptional()
  @Transform(toNumber)
  @IsInt({ message: 'THROTTLE_TTL_SECONDS deve ser um número inteiro' })
  @Min(1, { message: 'THROTTLE_TTL_SECONDS deve ser maior que zero' })
  THROTTLE_TTL_SECONDS?: number;
}

export function validateEnv(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, { enableImplicitConversion: false });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(errors.map((error) => Object.values(error.constraints ?? {}).join(', ')).join('; '));
  }
  return validated;
}
