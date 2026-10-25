import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiSecurity,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { API_KEY_SECURITY } from '../../common/auth/api-key.guard.js';
import { ErrorResponseDto } from '../../common/http/error-response.dto.js';
import { uuidPipe } from '../../common/http/validation.js';
import { FinishUsageRequestDto, StartUsageRequestDto } from './dto/usages-request.dto.js';
import { UsageResponseDto } from './dto/usages-response.dto.js';
import { UsagesService } from './usages.service.js';

@ApiTags('usages')
@ApiSecurity(API_KEY_SECURITY)
@ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Entrada em formato inválido.' })
@Controller('usages')
export class UsagesController {
  constructor(private readonly service: UsagesService) {}

  @Get()
  @ApiOkResponse({ type: UsageResponseDto, isArray: true, description: 'Utilizações da mais recente para a mais antiga.' })
  list(): Promise<UsageResponseDto[]> {
    return this.service.list();
  }

  @Post()
  @ApiBody({
    type: StartUsageRequestDto,
    examples: {
      agora: {
        summary: 'Inicia agora',
        value: { vehicleId: '<id do automóvel>', driverId: '<id do motorista>', reason: 'Visita ao cliente em Campinas' },
      },
    },
  })
  @ApiCreatedResponse({ type: UsageResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Automóvel em uso ou motorista já utilizando outro automóvel.' })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'Automóvel ou motorista inexistente, ou data de início no futuro.',
  })
  start(@Body() dto: StartUsageRequestDto): Promise<UsageResponseDto> {
    return this.service.start(dto);
  }

  @Patch(':id/finish')
  @ApiBody({ type: FinishUsageRequestDto, required: false, examples: { agora: { summary: 'Finaliza agora', value: {} } } })
  @ApiOkResponse({ type: UsageResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Utilização não encontrada.' })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Utilização já finalizada.' })
  @ApiUnprocessableEntityResponse({ type: ErrorResponseDto, description: 'Data de término no futuro ou anterior ao início.' })
  finish(@Param('id', uuidPipe()) id: string, @Body() dto: FinishUsageRequestDto): Promise<UsageResponseDto> {
    return this.service.finish(id, dto);
  }
}
