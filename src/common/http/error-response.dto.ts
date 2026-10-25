import { ApiProperty } from '@nestjs/swagger';

export class RuleViolationResponseDto {
  @ApiProperty({ example: 'plate', description: 'Campo ou regra que impediu a operação.' })
  field: string;

  @ApiProperty({ example: 'Placa inválida: use o formato ABC1234 ou ABC1D23.' })
  message: string;
}

export class ErrorResponseDto {
  @ApiProperty({ example: 400 })
  statusCode: number;

  @ApiProperty({ example: 'Bad Request' })
  error: string;

  @ApiProperty({ example: 'Placa inválida: use o formato ABC1234 ou ABC1D23.' })
  message: string;

  @ApiProperty({ type: [RuleViolationResponseDto], description: 'Lista de violações; vazia quando o erro não é de campo.' })
  errors: RuleViolationResponseDto[];
}
