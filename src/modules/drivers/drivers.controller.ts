import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { API_KEY_SECURITY } from '../../common/auth/api-key.guard.js';
import { ErrorResponseDto } from '../../common/http/error-response.dto.js';
import { uuidPipe } from '../../common/http/validation.js';
import { DriversService } from './drivers.service.js';
import { CreateDriverRequestDto, ListDriversQueryDto, UpdateDriverRequestDto } from './dto/drivers-request.dto.js';
import { DriverResponseDto } from './dto/drivers-response.dto.js';

@ApiTags('drivers')
@ApiSecurity(API_KEY_SECURITY)
@ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Entrada em formato inválido.' })
@Controller('drivers')
export class DriversController {
  constructor(private readonly service: DriversService) {}

  @Get()
  @ApiOkResponse({ type: DriverResponseDto, isArray: true })
  list(@Query() query: ListDriversQueryDto): Promise<DriverResponseDto[]> {
    return this.service.list(query);
  }

  @Get(':id')
  @ApiOkResponse({ type: DriverResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Motorista não encontrado.' })
  findOne(@Param('id', uuidPipe()) id: string): Promise<DriverResponseDto> {
    return this.service.findOne(id);
  }

  @Post()
  @ApiCreatedResponse({ type: DriverResponseDto })
  create(@Body() dto: CreateDriverRequestDto): Promise<DriverResponseDto> {
    return this.service.create(dto);
  }

  @Patch(':id')
  @ApiOkResponse({ type: DriverResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Motorista não encontrado.' })
  update(@Param('id', uuidPipe()) id: string, @Body() dto: UpdateDriverRequestDto): Promise<DriverResponseDto> {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Motorista excluído.' })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Motorista não encontrado.' })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Motorista utilizando um automóvel.' })
  remove(@Param('id', uuidPipe()) id: string): Promise<void> {
    return this.service.remove(id);
  }
}
