import { BadRequestException, ParseUUIDPipe, ValidationPipe, type ValidationError } from '@nestjs/common';
import type { RuleViolationResponseDto } from './error-response.dto.js';

const NEST_OBJECT_EXPECTED = 'Validation failed (object is expected)';

const describe = (field: string, key: string, message: string) => {
  if (key === 'whitelistValidation') return `O campo ${field} não é permitido.`;
  if (key === 'isObject' && message === NEST_OBJECT_EXPECTED) return 'O corpo da requisição deve ser um objeto.';
  return message;
};

export const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export const trimOrOmit = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || undefined : value);

export const createValidationPipe = () =>
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
    exceptionFactory: (errors) => {
      const violations = flattenValidationErrors(errors);
      return new BadRequestException({ message: violations[0]?.message ?? 'Dados inválidos.', errors: violations });
    },
  });

export const uuidPipe = () =>
  new ParseUUIDPipe({ exceptionFactory: () => new BadRequestException('Identificador inválido: informe um UUID.') });

const inDeclarationOrder = (constraints: Record<string, string> = {}) => Object.entries(constraints).reverse();

export function flattenValidationErrors(errors: ValidationError[], parent = ''): RuleViolationResponseDto[] {
  return errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    const [first] = inDeclarationOrder(error.constraints);
    const own = first ? [{ field, message: describe(field, ...first) }] : [];
    return [...own, ...flattenValidationErrors(error.children ?? [], field)];
  });
}
