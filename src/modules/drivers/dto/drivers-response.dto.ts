import { ApiProperty } from '@nestjs/swagger';

export class DriverResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Ana Souza' })
  name: string;
}
