import { ApiProperty } from '@nestjs/swagger';

export class VehicleResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'ABC1D23' })
  plate: string;

  @ApiProperty({ example: 'Prata' })
  color: string;

  @ApiProperty({ example: 'Fiat' })
  brand: string;
}
