import { ApiProperty } from '@nestjs/swagger';

export class HealthResponseDto {
  @ApiProperty({ enum: ['ok', 'error'], enumName: 'HealthStatus' })
  status: 'ok' | 'error';

  @ApiProperty({ enum: ['up', 'down'], enumName: 'DatabaseStatus' })
  database: 'up' | 'down';
}
