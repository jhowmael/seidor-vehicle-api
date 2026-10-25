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
import { CreateVehicleRequestDto, ListVehiclesQueryDto, UpdateVehicleRequestDto } from './dto/vehicles-request.dto.js';
import { VehicleResponseDto } from './dto/vehicles-response.dto.js';
import { VehiclesService } from './vehicles.service.js';

@ApiTags('vehicles')
@ApiSecurity(API_KEY_SECURITY)
@ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Entrada em formato inválido.' })
@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly service: VehiclesService) {}

  @Get()
  @ApiOkResponse({ type: VehicleResponseDto, isArray: true })
  list(@Query() query: ListVehiclesQueryDto): Promise<VehicleResponseDto[]> {
    return this.service.list(query);
  }

  @Get(':id')
  @ApiOkResponse({ type: VehicleResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Automóvel não encontrado.' })
  findOne(@Param('id', uuidPipe()) id: string): Promise<VehicleResponseDto> {
    return this.service.findOne(id);
  }

  @Post()
  @ApiCreatedResponse({ type: VehicleResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Placa já cadastrada.' })
  create(@Body() dto: CreateVehicleRequestDto): Promise<VehicleResponseDto> {
    return this.service.create(dto);
  }

  @Patch(':id')
  @ApiOkResponse({ type: VehicleResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Automóvel não encontrado.' })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Placa já cadastrada em outro automóvel.' })
  update(@Param('id', uuidPipe()) id: string, @Body() dto: UpdateVehicleRequestDto): Promise<VehicleResponseDto> {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Automóvel excluído.' })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Automóvel não encontrado.' })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Automóvel em uso.' })
  remove(@Param('id', uuidPipe()) id: string): Promise<void> {
    return this.service.remove(id);
  }
}
