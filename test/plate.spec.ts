import { normalizePlate, PLATE_PATTERN } from '../src/modules/vehicles/domain/plate.js';

describe('placa', () => {
  describe('PLATE_PATTERN', () => {
    it.each(['ABC1234', 'XYZ0000', 'QWE9876'])('aceita a placa no padrão antigo %s', (plate) => {
      expect(PLATE_PATTERN.test(plate)).toBe(true);
    });

    it.each(['ABC1D23', 'BRA2E19', 'XYZ9Z99'])('aceita a placa no padrão Mercosul %s', (plate) => {
      expect(PLATE_PATTERN.test(plate)).toBe(true);
    });

    it.each([
      ['vazia', ''],
      ['curta demais no padrão antigo', 'ABC123'],
      ['curta demais no padrão Mercosul', 'ABC1D2'],
      ['longa demais no padrão antigo', 'ABC12345'],
      ['longa demais no padrão Mercosul', 'ABC1D234'],
      ['com apenas duas letras no início', 'AB12345'],
      ['com dígito na primeira posição', '1BC1234'],
      ['com dígito na terceira posição', 'AB01234'],
      ['com letra na quarta posição', 'ABCD234'],
      ['com letra na sexta posição', 'ABC12D4'],
      ['com letra na sétima posição', 'ABC123D'],
      ['com duas letras no bloco final', 'ABC1DE3'],
      ['somente com dígitos', '1234567'],
      ['somente com letras', 'ABCDEFG'],
      ['em minúsculas', 'abc1d23'],
      ['com hífen', 'ABC-1234'],
      ['com espaço', 'ABC 1D23'],
      ['com ponto', 'ABC.1234'],
      ['com sublinhado', 'ABC_1D23'],
      ['com barra', 'ABC/1234'],
      ['com letra acentuada', 'ÁBC1D23'],
      ['com cedilha', 'ÇBC1234'],
      ['com quebra de linha no final', 'ABC1234\n'],
      ['com símbolo no lugar da letra', 'AB#1D23'],
    ])('rejeita placa %s (%j)', (_, plate) => {
      expect(PLATE_PATTERN.test(plate)).toBe(false);
    });
  });

  describe('normalizePlate', () => {
    it('mantém a placa que já está no formato canônico', () => {
      expect(normalizePlate('ABC1234')).toBe('ABC1234');
      expect(normalizePlate('ABC1D23')).toBe('ABC1D23');
    });

    it('converte minúsculas para maiúsculas', () => {
      expect(normalizePlate('abc1234')).toBe('ABC1234');
      expect(normalizePlate('abc1d23')).toBe('ABC1D23');
      expect(normalizePlate('aBc1d23')).toBe('ABC1D23');
    });

    it('remove hífens', () => {
      expect(normalizePlate('ABC-1234')).toBe('ABC1234');
      expect(normalizePlate('ABC-1D23')).toBe('ABC1D23');
      expect(normalizePlate('A-B-C-1-D-2-3')).toBe('ABC1D23');
    });

    it('remove espaços nas bordas e no meio, inclusive tabulação e quebra de linha', () => {
      expect(normalizePlate('  ABC1234  ')).toBe('ABC1234');
      expect(normalizePlate('ABC 1D23')).toBe('ABC1D23');
      expect(normalizePlate('\tABC\n1D23\r\n')).toBe('ABC1D23');
    });

    it('combina minúsculas, hífen e espaços', () => {
      expect(normalizePlate(' abc - 1d23 ')).toBe('ABC1D23');
      expect(normalizePlate('bra-2e19')).toBe('BRA2E19');
    });

    it('não remove outros símbolos, que continuam reprovados pelo padrão', () => {
      expect(normalizePlate('abc.1234')).toBe('ABC.1234');
      expect(normalizePlate('abc_1d23')).toBe('ABC_1D23');
      expect(PLATE_PATTERN.test(normalizePlate('abc.1234') as string)).toBe(false);
      expect(PLATE_PATTERN.test(normalizePlate('abc_1d23') as string)).toBe(false);
    });

    it('produz placa aceita pelo padrão a partir de entradas válidas com formatação livre', () => {
      for (const input of ['abc-1234', ' ABC 1234 ', 'abc1d23', 'Abc-1D23', 'xyz 9z99']) {
        expect(PLATE_PATTERN.test(normalizePlate(input) as string), input).toBe(true);
      }
    });

    it('devolve string vazia quando só há espaços e hífens', () => {
      expect(normalizePlate('')).toBe('');
      expect(normalizePlate(' - - ')).toBe('');
    });

    it.each([
      ['número', 1234567],
      ['nulo', null],
      ['indefinido', undefined],
      ['booleano', true],
    ])('devolve valor do tipo %s sem alteração', (_, value) => {
      expect(normalizePlate(value)).toBe(value);
    });

    it('devolve objetos e listas sem alteração e com a mesma referência', () => {
      const object = { plate: 'abc-1234' };
      const list = ['abc-1234'];
      expect(normalizePlate(object)).toBe(object);
      expect(normalizePlate(list)).toBe(list);
      expect(object).toEqual({ plate: 'abc-1234' });
      expect(list).toEqual(['abc-1234']);
    });
  });
});
