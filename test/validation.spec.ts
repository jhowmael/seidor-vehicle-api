import { BadRequestException, type Paramtype, type Type } from '@nestjs/common';
import { ValidationError } from 'class-validator';
import { createValidationPipe, flattenValidationErrors, trim, trimOrOmit, uuidPipe } from '../src/common/http/validation.js';
import { CreateDriverRequestDto, ListDriversQueryDto, UpdateDriverRequestDto } from '../src/modules/drivers/dto/drivers-request.dto.js';
import { FinishUsageRequestDto, StartUsageRequestDto } from '../src/modules/usages/dto/usages-request.dto.js';
import {
  CreateVehicleRequestDto,
  ListVehiclesQueryDto,
  UpdateVehicleRequestDto,
} from '../src/modules/vehicles/dto/vehicles-request.dto.js';

interface Rejection {
  message: string;
  errors: { field: string; message: string }[];
}

const VEHICLE_ID = '3f1c2d4e-5b6a-4c7d-8e9f-0a1b2c3d4e5f';
const DRIVER_ID = '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d';

const PLATE_MESSAGE = 'Placa inválida: use o formato ABC1234 ou ABC1D23.';
const STARTED_AT_MESSAGE = 'Data de início inválida: use data e hora com fuso, por exemplo 2026-10-25T08:00:00-03:00.';
const ENDED_AT_MESSAGE = 'Data de término inválida: use data e hora com fuso, por exemplo 2026-10-25T08:00:00-03:00.';

const pipe = createValidationPipe();

const accept = async <T>(metatype: Type<T>, value: unknown, type: Paramtype = 'body'): Promise<T> =>
  (await pipe.transform(value, { type, metatype })) as T;

async function reject(metatype: Type<unknown>, value: unknown, type: Paramtype = 'body'): Promise<Rejection> {
  const error: unknown = await pipe.transform(value, { type, metatype }).then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error, 'a validação deveria ter falhado').toBeInstanceOf(BadRequestException);
  const exception = error as BadRequestException;
  expect(exception.getStatus()).toBe(400);
  const response = exception.getResponse() as Rejection;
  expect(response.errors.length).toBeGreaterThan(0);
  expect(response.message).toBe(response.errors[0].message);
  return response;
}

const messagesOf = (rejection: Rejection, field: string) =>
  rejection.errors.filter((error) => error.field === field).map((error) => error.message);

const fieldsOf = (rejection: Rejection) => [...new Set(rejection.errors.map((error) => error.field))].sort();

const DRIVER_DTOS = [
  ['CreateDriverRequestDto', CreateDriverRequestDto],
  ['UpdateDriverRequestDto', UpdateDriverRequestDto],
] as const;

const validVehicle = { plate: 'ABC1D23', color: 'Prata', brand: 'Fiat' };
const validStart = { vehicleId: VEHICLE_ID, driverId: DRIVER_ID, reason: 'Visita ao cliente' };

describe('CreateVehicleRequestDto', () => {
  it('normaliza a placa e apara cor e marca', async () => {
    const dto = await accept(CreateVehicleRequestDto, { plate: 'abc-1d23', color: '  Prata ', brand: ' Fiat  ' });
    expect(dto).toBeInstanceOf(CreateVehicleRequestDto);
    expect(dto).toEqual({ plate: 'ABC1D23', color: 'Prata', brand: 'Fiat' });
  });

  it('aceita placa no padrão antigo e Mercosul, com espaços e hífen', async () => {
    expect((await accept(CreateVehicleRequestDto, { ...validVehicle, plate: 'xyz 9876' })).plate).toBe('XYZ9876');
    expect((await accept(CreateVehicleRequestDto, { ...validVehicle, plate: ' bra-2e19 ' })).plate).toBe('BRA2E19');
    expect((await accept(CreateVehicleRequestDto, { ...validVehicle, plate: 'Qwe4R56' })).plate).toBe('QWE4R56');
  });

  it.each(['AB12345', 'ABCD123', 'ABC12345', 'ABC123', '1BC1D23', 'ABC1DD3', 'ABC1D2Z', 'ÁBC1234', '', '   '])(
    'rejeita a placa %j',
    async (plate) => {
      const rejection = await reject(CreateVehicleRequestDto, { ...validVehicle, plate });
      expect(rejection.errors).toEqual([{ field: 'plate', message: PLATE_MESSAGE }]);
      expect(rejection.message).toBe(PLATE_MESSAGE);
    },
  );

  it('rejeita placa ausente ou que não é texto com a mesma mensagem', async () => {
    const { plate: _plate, ...withoutPlate } = validVehicle;
    expect(new Set(messagesOf(await reject(CreateVehicleRequestDto, withoutPlate), 'plate'))).toEqual(new Set([PLATE_MESSAGE]));
    expect(new Set(messagesOf(await reject(CreateVehicleRequestDto, { ...validVehicle, plate: 1234567 }), 'plate'))).toEqual(
      new Set([PLATE_MESSAGE]),
    );
  });

  it('rejeita cor e marca em branco depois de aparar', async () => {
    const rejection = await reject(CreateVehicleRequestDto, { ...validVehicle, color: '   ', brand: '' });
    expect(rejection.errors).toEqual([
      { field: 'color', message: 'Informe a cor.' },
      { field: 'brand', message: 'Informe a marca.' },
    ]);
  });

  it('limita a cor a 40 e a marca a 60 caracteres, contando depois de aparar', async () => {
    expect(
      await accept(CreateVehicleRequestDto, { ...validVehicle, color: ` ${'c'.repeat(40)} `, brand: ` ${'m'.repeat(60)} ` }),
    ).toMatchObject({
      color: 'c'.repeat(40),
      brand: 'm'.repeat(60),
    });

    const rejection = await reject(CreateVehicleRequestDto, { ...validVehicle, color: 'c'.repeat(41), brand: 'm'.repeat(61) });
    expect(rejection.errors).toEqual([
      { field: 'color', message: 'A cor deve ter no máximo 40 caracteres.' },
      { field: 'brand', message: 'A marca deve ter no máximo 60 caracteres.' },
    ]);
  });

  it('rejeita cor e marca que não são texto', async () => {
    const rejection = await reject(CreateVehicleRequestDto, { ...validVehicle, color: 10, brand: ['Fiat'] });
    expect(messagesOf(rejection, 'color')).toContain('Cor inválida.');
    expect(messagesOf(rejection, 'brand')).toContain('Marca inválida.');
  });

  it('informa o tipo inválido como mensagem principal, não o limite de tamanho', async () => {
    expect((await reject(CreateVehicleRequestDto, { ...validVehicle, color: 10 })).message).toBe('Cor inválida.');
    expect((await reject(CreateVehicleRequestDto, { ...validVehicle, brand: ['Fiat'] })).message).toBe('Marca inválida.');
  });

  it('pede o campo ausente como mensagem principal, não o limite de tamanho', async () => {
    expect((await reject(CreateVehicleRequestDto, { plate: 'ABC1D23', brand: 'Fiat' })).message).toBe('Informe a cor.');
    expect((await reject(CreateVehicleRequestDto, { plate: 'ABC1D23', color: 'Prata' })).message).toBe('Informe a marca.');
  });

  it('exige todos os campos quando o corpo vem vazio ou ausente', async () => {
    expect(fieldsOf(await reject(CreateVehicleRequestDto, {}))).toEqual(['brand', 'color', 'plate']);
    expect(fieldsOf(await reject(CreateVehicleRequestDto, undefined))).toEqual(['brand', 'color', 'plate']);
    expect(messagesOf(await reject(CreateVehicleRequestDto, {}), 'color')).toContain('Informe a cor.');
  });

  it('não permite campos fora do contrato', async () => {
    const rejection = await reject(CreateVehicleRequestDto, { ...validVehicle, id: VEHICLE_ID, model: 'Uno' });
    expect(rejection.errors).toEqual([
      { field: 'id', message: 'O campo id não é permitido.' },
      { field: 'model', message: 'O campo model não é permitido.' },
    ]);
    expect(rejection.message).toBe('O campo id não é permitido.');
  });

  it('rejeita corpo que não é objeto', async () => {
    await reject(CreateVehicleRequestDto, [validVehicle]);
    await reject(CreateVehicleRequestDto, 'ABC1D23');
  });
});

describe('UpdateVehicleRequestDto', () => {
  it('aceita corpo vazio, já que todos os campos são opcionais', async () => {
    const dto = await accept(UpdateVehicleRequestDto, {});
    expect(dto).toBeInstanceOf(UpdateVehicleRequestDto);
    expect(dto.plate).toBeUndefined();
    expect(dto.color).toBeUndefined();
    expect(dto.brand).toBeUndefined();
  });

  it('aplica as mesmas normalizações do cadastro', async () => {
    expect(await accept(UpdateVehicleRequestDto, { plate: 'xyz-9876' })).toEqual({ plate: 'XYZ9876' });
    expect(await accept(UpdateVehicleRequestDto, { color: ' Preto ', brand: ' Volkswagen ' })).toEqual({
      color: 'Preto',
      brand: 'Volkswagen',
    });
  });

  it('aplica as mesmas regras do cadastro aos campos enviados', async () => {
    expect((await reject(UpdateVehicleRequestDto, { plate: 'ABC' })).errors).toEqual([{ field: 'plate', message: PLATE_MESSAGE }]);
    expect((await reject(UpdateVehicleRequestDto, { color: '  ' })).errors).toEqual([{ field: 'color', message: 'Informe a cor.' }]);
    expect((await reject(UpdateVehicleRequestDto, { brand: '' })).errors).toEqual([{ field: 'brand', message: 'Informe a marca.' }]);
    expect((await reject(UpdateVehicleRequestDto, { color: 'c'.repeat(41) })).message).toBe('A cor deve ter no máximo 40 caracteres.');
    expect((await reject(UpdateVehicleRequestDto, { brand: 'm'.repeat(61) })).message).toBe('A marca deve ter no máximo 60 caracteres.');
    expect((await reject(UpdateVehicleRequestDto, { createdAt: '2026-10-25' })).message).toBe('O campo createdAt não é permitido.');
  });

  it.each(['plate', 'color', 'brand'])('rejeita null em %s em vez de repassar ao banco', async (field) => {
    const rejection = await reject(UpdateVehicleRequestDto, { [field]: null });
    expect(fieldsOf(rejection)).toEqual([field]);
  });
});

describe('ListVehiclesQueryDto', () => {
  it('apara os filtros e ignora filtros em branco', async () => {
    const trimmed = await accept(ListVehiclesQueryDto, { color: ' Prata ', brand: '  Fiat' }, 'query');
    expect(trimmed).toEqual({ color: 'Prata', brand: 'Fiat' });

    const blank = await accept(ListVehiclesQueryDto, { color: '   ', brand: '' }, 'query');
    expect(blank.color).toBeUndefined();
    expect(blank.brand).toBeUndefined();

    expect(await accept(ListVehiclesQueryDto, {}, 'query')).toEqual({});
  });

  it('rejeita filtro repetido apenas no campo repetido', async () => {
    expect(fieldsOf(await reject(ListVehiclesQueryDto, { color: ['Prata', 'Preto'] }, 'query'))).toEqual(['color']);
    expect(messagesOf(await reject(ListVehiclesQueryDto, { brand: ['Fiat', 'Toyota'] }, 'query'), 'brand')).toContain('Marca inválida.');
  });

  it('informa filtro repetido como inválido, não como longo demais', async () => {
    expect((await reject(ListVehiclesQueryDto, { color: ['Prata', 'Preto'] }, 'query')).message).toBe('Cor inválida.');
    expect((await reject(ListVehiclesQueryDto, { brand: ['Fiat', 'Toyota'] }, 'query')).message).toBe('Marca inválida.');
  });

  it('rejeita filtro longo demais ou desconhecido', async () => {
    expect((await reject(ListVehiclesQueryDto, { color: 'c'.repeat(41) }, 'query')).message).toBe(
      'A cor deve ter no máximo 40 caracteres.',
    );
    expect((await reject(ListVehiclesQueryDto, { brand: 'm'.repeat(61) }, 'query')).message).toBe(
      'A marca deve ter no máximo 60 caracteres.',
    );
    expect((await reject(ListVehiclesQueryDto, { plate: 'ABC1D23' }, 'query')).errors).toEqual([
      { field: 'plate', message: 'O campo plate não é permitido.' },
    ]);
  });
});

describe('CreateDriverRequestDto e UpdateDriverRequestDto', () => {
  it.each(DRIVER_DTOS)('%s apara o nome', async (_name, metatype) => {
    const dto = await accept(metatype, { name: '  Ana Souza ' });
    expect(dto).toBeInstanceOf(metatype);
    expect(dto).toEqual({ name: 'Ana Souza' });
  });

  it.each(DRIVER_DTOS)('%s exige o nome', async (_name, metatype) => {
    expect((await reject(metatype, { name: '   ' })).errors).toEqual([{ field: 'name', message: 'Informe o nome do motorista.' }]);
    expect(messagesOf(await reject(metatype, {}), 'name')).toEqual(['Informe o nome do motorista.']);
    expect(messagesOf(await reject(metatype, undefined), 'name')).toEqual(['Informe o nome do motorista.']);
    expect(messagesOf(await reject(metatype, { name: null }), 'name')).toEqual(['Informe o nome do motorista.']);
    expect(messagesOf(await reject(metatype, { name: 42 }), 'name')).toEqual(['Nome inválido.']);
  });

  it.each(DRIVER_DTOS)('%s informa nome que não é texto como inválido, não como longo demais', async (_name, metatype) => {
    expect((await reject(metatype, { name: 42 })).message).toBe('Nome inválido.');
  });

  it.each(DRIVER_DTOS)('%s pede o nome ausente como mensagem principal, não o limite de tamanho', async (_name, metatype) => {
    expect((await reject(metatype, {})).message).toBe('Informe o nome do motorista.');
  });

  it.each(DRIVER_DTOS)('%s limita o nome a 120 caracteres', async (_name, metatype) => {
    expect((await accept(metatype, { name: ` ${'n'.repeat(120)} ` })).name).toBe('n'.repeat(120));
    expect((await reject(metatype, { name: 'n'.repeat(121) })).errors).toEqual([
      { field: 'name', message: 'O nome deve ter no máximo 120 caracteres.' },
    ]);
  });

  it.each(DRIVER_DTOS)('%s não permite campos fora do contrato', async (_name, metatype) => {
    expect((await reject(metatype, { name: 'Ana', cpf: '000' })).errors).toEqual([
      { field: 'cpf', message: 'O campo cpf não é permitido.' },
    ]);
  });
});

describe('ListDriversQueryDto', () => {
  it('apara o filtro de nome e ignora filtro em branco', async () => {
    expect(await accept(ListDriversQueryDto, { name: ' ana ' }, 'query')).toEqual({ name: 'ana' });
    expect((await accept(ListDriversQueryDto, { name: '  ' }, 'query')).name).toBeUndefined();
    expect(await accept(ListDriversQueryDto, {}, 'query')).toEqual({});
  });

  it('rejeita filtro repetido informando nome inválido', async () => {
    const repeated = await reject(ListDriversQueryDto, { name: ['Ana', 'Bruno'] }, 'query');
    expect(fieldsOf(repeated)).toEqual(['name']);
    expect(repeated.message).toBe('Nome inválido.');
  });

  it('rejeita filtro longo demais ou desconhecido', async () => {
    expect((await reject(ListDriversQueryDto, { name: 'n'.repeat(121) }, 'query')).message).toBe(
      'O nome deve ter no máximo 120 caracteres.',
    );
    expect((await reject(ListDriversQueryDto, { search: 'Ana' }, 'query')).message).toBe('O campo search não é permitido.');
  });
});

describe('StartUsageRequestDto', () => {
  it('aceita automóvel, motorista e motivo, aparando o motivo e sem data de início', async () => {
    const dto = await accept(StartUsageRequestDto, { ...validStart, reason: '  Visita ao cliente  ' });
    expect(dto).toBeInstanceOf(StartUsageRequestDto);
    expect(dto).toEqual(validStart);
    expect(dto.startedAt).toBeUndefined();
  });

  it('exige UUID v4 para automóvel e motorista', async () => {
    const rejection = await reject(StartUsageRequestDto, { ...validStart, vehicleId: 'abc', driverId: '123' });
    expect(rejection.errors).toEqual([
      { field: 'vehicleId', message: 'Automóvel inválido.' },
      { field: 'driverId', message: 'Motorista inválido.' },
    ]);

    const missing = await reject(StartUsageRequestDto, { reason: 'Visita' });
    expect(fieldsOf(missing)).toEqual(['driverId', 'vehicleId']);

    expect((await reject(StartUsageRequestDto, { ...validStart, vehicleId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8' })).message).toBe(
      'Automóvel inválido.',
    );
  });

  it('exige o motivo e limita a 500 caracteres', async () => {
    expect((await reject(StartUsageRequestDto, { ...validStart, reason: '   ' })).errors).toEqual([
      { field: 'reason', message: 'Informe o motivo da utilização.' },
    ]);
    expect(messagesOf(await reject(StartUsageRequestDto, { vehicleId: VEHICLE_ID, driverId: DRIVER_ID }), 'reason')).toContain(
      'Informe o motivo da utilização.',
    );
    expect(messagesOf(await reject(StartUsageRequestDto, { ...validStart, reason: 7 }), 'reason')).toContain('Motivo inválido.');
    expect((await accept(StartUsageRequestDto, { ...validStart, reason: 'r'.repeat(500) })).reason).toHaveLength(500);
    expect((await reject(StartUsageRequestDto, { ...validStart, reason: 'r'.repeat(501) })).errors).toEqual([
      { field: 'reason', message: 'O motivo deve ter no máximo 500 caracteres.' },
    ]);
  });

  it('informa motivo que não é texto como inválido, não como longo demais', async () => {
    expect((await reject(StartUsageRequestDto, { ...validStart, reason: 7 })).message).toBe('Motivo inválido.');
  });

  it('pede o motivo ausente como mensagem principal, não o limite de tamanho', async () => {
    expect((await reject(StartUsageRequestDto, { vehicleId: VEHICLE_ID, driverId: DRIVER_ID })).message).toBe(
      'Informe o motivo da utilização.',
    );
  });

  it.each([
    '2026-10-25T08:00:00Z',
    '2026-10-25T08:00:00-03:00',
    '2026-10-25T08:00:00+00:00',
    '2026-10-25T08:00-03:00',
    '2026-10-25T08:00:00.123Z',
    '2028-02-29T10:00:00Z',
  ])('aceita data de início %s', async (startedAt) => {
    expect((await accept(StartUsageRequestDto, { ...validStart, startedAt })).startedAt).toBe(startedAt);
  });

  it.each([
    ['só a data', '2026-10-25'],
    ['sem fuso', '2026-10-25T08:00:00'],
    ['dia inexistente', '2026-02-30T10:00:00Z'],
    ['29 de fevereiro em ano não bissexto', '2026-02-29T10:00:00Z'],
    ['mês inexistente', '2026-13-01T10:00:00Z'],
    ['hora inexistente', '2026-10-25T25:00:00Z'],
    ['espaço no lugar do T', '2026-10-25 08:00:00Z'],
    ['fuso sem dois-pontos', '2026-10-25T08:00:00-0300'],
    ['formato brasileiro', '25/10/2026 08:00'],
    ['texto livre', 'ontem'],
    ['número', 1761379200000],
  ])('rejeita data de início com %s', async (_label, startedAt) => {
    const rejection = await reject(StartUsageRequestDto, { ...validStart, startedAt });
    expect(new Set(messagesOf(rejection, 'startedAt'))).toEqual(new Set([STARTED_AT_MESSAGE]));
    expect(fieldsOf(rejection)).toEqual(['startedAt']);
  });

  it('não permite campos fora do contrato', async () => {
    expect((await reject(StartUsageRequestDto, { ...validStart, endedAt: '2026-10-25T08:00:00Z' })).errors).toEqual([
      { field: 'endedAt', message: 'O campo endedAt não é permitido.' },
    ]);
  });
});

describe('FinishUsageRequestDto', () => {
  it('aceita corpo ausente ou vazio, usando a data atual depois', async () => {
    const absent = await accept(FinishUsageRequestDto, undefined);
    expect(absent).toBeInstanceOf(FinishUsageRequestDto);
    expect(absent.endedAt).toBeUndefined();
    expect((await accept(FinishUsageRequestDto, {})).endedAt).toBeUndefined();
  });

  it('rejeita corpo que é uma lista em vez de um objeto', async () => {
    const expected = [{ field: 'body', message: 'O corpo da requisição deve ser um objeto.' }];
    expect((await reject(FinishUsageRequestDto, [])).errors).toEqual(expected);
    expect((await reject(UpdateVehicleRequestDto, [])).errors).toEqual(expected);
    expect((await reject(UpdateVehicleRequestDto, [{ color: 'Azul' }])).message).toBe('O campo 0 não é permitido.');
  });

  it.each(['2026-10-25T18:00:00Z', '2026-10-25T18:00:00-03:00', '2026-10-25T18:00:00.5+01:00'])(
    'aceita data de término %s',
    async (endedAt) => {
      expect((await accept(FinishUsageRequestDto, { endedAt })).endedAt).toBe(endedAt);
    },
  );

  it.each(['2026-10-25', '2026-10-25T18:00:00', '2026-02-30T10:00:00Z', '2026-10-25T18:00:00.1234Z', ''])(
    'rejeita data de término %j',
    async (endedAt) => {
      const rejection = await reject(FinishUsageRequestDto, { endedAt });
      expect(new Set(messagesOf(rejection, 'endedAt'))).toEqual(new Set([ENDED_AT_MESSAGE]));
      expect(rejection.message).toBe(ENDED_AT_MESSAGE);
    },
  );

  it('não permite campos fora do contrato', async () => {
    expect((await reject(FinishUsageRequestDto, { reason: 'Fim' })).errors).toEqual([
      { field: 'reason', message: 'O campo reason não é permitido.' },
    ]);
  });
});

describe('uuidPipe', () => {
  it('aceita UUID e rejeita o resto com mensagem em português', async () => {
    const pipeForId = uuidPipe();
    expect(await pipeForId.transform(VEHICLE_ID, { type: 'param', data: 'id' })).toBe(VEHICLE_ID);

    const error: unknown = await pipeForId.transform('abc', { type: 'param', data: 'id' }).then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).message).toBe('Identificador inválido: informe um UUID.');
  });
});

describe('trim e trimOrOmit', () => {
  it('só mexem em texto', () => {
    expect(trim({ value: '  a b  ' })).toBe('a b');
    expect(trim({ value: '   ' })).toBe('');
    expect(trim({ value: 5 })).toBe(5);
    expect(trimOrOmit({ value: ' a ' })).toBe('a');
    expect(trimOrOmit({ value: '   ' })).toBeUndefined();
    expect(trimOrOmit({ value: ['a'] })).toEqual(['a']);
  });
});

describe('flattenValidationErrors', () => {
  const error = (property: string, constraints?: Record<string, string>, children: ValidationError[] = []) =>
    Object.assign(new ValidationError(), { property, constraints, children });

  it('achata erros aninhados usando o caminho completo do campo', () => {
    const errors = [
      error('vehicle', { isObject: 'Automóvel inválido.' }, [
        error('plate', { matches: 'Placa inválida.' }),
        error('owner', undefined, [error('name', { maxLength: 'Nome longo.', isNotEmpty: 'Informe o nome.' })]),
      ]),
      error('items', undefined, [error('0', undefined, [error('code', { isString: 'Código inválido.' })])]),
    ];

    expect(flattenValidationErrors(errors)).toEqual([
      { field: 'vehicle', message: 'Automóvel inválido.' },
      { field: 'vehicle.plate', message: 'Placa inválida.' },
      { field: 'vehicle.owner.name', message: 'Informe o nome.' },
      { field: 'items.0.code', message: 'Código inválido.' },
    ]);
  });

  it('devolve só a primeira mensagem de cada campo, na ordem em que os decoradores foram escritos', () => {
    const errors = [error('plate', { matches: 'Placa inválida.', isString: 'Placa inválida.', isNotEmpty: 'Informe a placa.' })];
    expect(flattenValidationErrors(errors)).toEqual([{ field: 'plate', message: 'Informe a placa.' }]);
  });

  it('traduz em português o corpo que não é um objeto', () => {
    const errors = [error('body', { isObject: 'Validation failed (object is expected)' })];
    expect(flattenValidationErrors(errors)).toEqual([{ field: 'body', message: 'O corpo da requisição deve ser um objeto.' }]);
  });

  it('traduz campo não permitido usando o caminho completo', () => {
    const errors = [error('filters', undefined, [error('extra', { whitelistValidation: 'property extra should not exist' })])];
    expect(flattenValidationErrors(errors)).toEqual([{ field: 'filters.extra', message: 'O campo filters.extra não é permitido.' }]);
    expect(flattenValidationErrors(errors, 'body')).toEqual([
      { field: 'body.filters.extra', message: 'O campo body.filters.extra não é permitido.' },
    ]);
  });

  it('devolve lista vazia sem erros', () => {
    expect(flattenValidationErrors([])).toEqual([]);
    expect(flattenValidationErrors([error('name')])).toEqual([]);
  });
});
