import { validateEnv } from '../src/config/env.validation.js';

const DATABASE_URL = 'postgresql://vehicle:change-me@localhost:5435/vehicle_api?schema=public';

describe('validateEnv', () => {
  it('converte os números e trata valores vazios como ausentes', () => {
    const env = validateEnv({ DATABASE_URL, PORT: '3000', THROTTLE_LIMIT: '', THROTTLE_TTL_SECONDS: '30', API_KEY: '' });
    expect(env).toMatchObject({ DATABASE_URL, PORT: 3000, THROTTLE_TTL_SECONDS: 30, API_KEY: '' });
    expect(env.THROTTLE_LIMIT).toBeUndefined();
  });

  it('exige DATABASE_URL', () => {
    expect(() => validateEnv({})).toThrow('Informe DATABASE_URL');
    expect(() => validateEnv({ DATABASE_URL: '' })).toThrow('Informe DATABASE_URL');
  });

  it.each([
    ['abc', 'PORT deve ser um número inteiro'],
    ['3000.5', 'PORT deve ser um número inteiro'],
    ['0', 'PORT deve ser no mínimo 1'],
    ['70000', 'PORT deve ser no máximo 65535'],
  ])('recusa PORT=%s', (PORT, message) => {
    expect(() => validateEnv({ DATABASE_URL, PORT })).toThrow(message);
  });

  it('recusa limites de requisição menores que 1', () => {
    expect(() => validateEnv({ DATABASE_URL, THROTTLE_LIMIT: '0' })).toThrow('THROTTLE_LIMIT deve ser maior que zero');
    expect(() => validateEnv({ DATABASE_URL, THROTTLE_TTL_SECONDS: '-5' })).toThrow('THROTTLE_TTL_SECONDS deve ser maior que zero');
  });

  it('reúne todos os problemas na mesma mensagem', () => {
    expect(() => validateEnv({ PORT: 'abc' })).toThrow(/Informe DATABASE_URL.*;.*PORT deve ser um número inteiro/);
  });
});
