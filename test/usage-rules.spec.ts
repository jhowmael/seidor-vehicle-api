import { availabilityConflict, validateFinish, validateStart, type UsageParty } from '../src/modules/usages/domain/usage-rules.js';

const NOW = new Date('2026-10-25T12:00:00.000Z');

const at = (iso: string) => new Date(iso);

const BUSY: Record<UsageParty, { field: string; now: string; inPeriod: string }> = {
  vehicle: {
    field: 'vehicleId',
    now: 'O automóvel já está em uso por um motorista.',
    inPeriod: 'O automóvel já estava em uso no período informado.',
  },
  driver: {
    field: 'driverId',
    now: 'O motorista já está utilizando outro automóvel.',
    inPeriod: 'O motorista já estava utilizando um automóvel no período informado.',
  },
};

describe('regras de utilização', () => {
  describe.each([
    ['automóvel', 'vehicle'],
    ['motorista', 'driver'],
  ] as const)('availabilityConflict do %s', (_, party) => {
    const { field, now, inPeriod } = BUSY[party];
    const startedAt = at('2026-10-25T10:00:00.000Z');

    it('libera quando não há utilização anterior', () => {
      expect(availabilityConflict(party, null, startedAt)).toBeNull();
    });

    it('bloqueia quando a última utilização ainda está ativa', () => {
      const latest = { startedAt: at('2026-10-25T08:00:00.000Z'), endedAt: null };
      expect(availabilityConflict(party, latest, startedAt)).toEqual({ field, message: now });
    });

    it('bloqueia utilização ativa mesmo quando ela começou depois do início pedido', () => {
      const latest = { startedAt: at('2026-10-25T11:00:00.000Z'), endedAt: null };
      expect(availabilityConflict(party, latest, startedAt)).toEqual({ field, message: now });
    });

    it('bloqueia quando a última utilização terminou depois do início pedido', () => {
      const latest = { startedAt: at('2026-10-25T08:00:00.000Z'), endedAt: at('2026-10-25T10:00:00.001Z') };
      expect(availabilityConflict(party, latest, startedAt)).toEqual({ field, message: inPeriod });
    });

    it('bloqueia quando a última utilização está inteira depois do início pedido', () => {
      const latest = { startedAt: at('2026-10-25T10:30:00.000Z'), endedAt: at('2026-10-25T11:00:00.000Z') };
      expect(availabilityConflict(party, latest, startedAt)).toEqual({ field, message: inPeriod });
    });

    it('libera quando a última utilização terminou exatamente no início pedido', () => {
      const latest = { startedAt: at('2026-10-25T08:00:00.000Z'), endedAt: at('2026-10-25T10:00:00.000Z') };
      expect(availabilityConflict(party, latest, startedAt)).toBeNull();
    });

    it('libera quando a última utilização terminou antes do início pedido', () => {
      const latest = { startedAt: at('2026-10-25T08:00:00.000Z'), endedAt: at('2026-10-25T09:59:59.999Z') };
      expect(availabilityConflict(party, latest, startedAt)).toBeNull();
    });
  });

  describe('validateStart', () => {
    it('aceita início no passado', () => {
      expect(validateStart(at('2026-10-25T11:59:59.999Z'), NOW)).toEqual([]);
      expect(validateStart(at('2026-10-01T08:00:00.000Z'), NOW)).toEqual([]);
    });

    it('aceita início exatamente agora', () => {
      expect(validateStart(new Date(NOW), NOW)).toEqual([]);
    });

    it('rejeita início no futuro', () => {
      const expected = [{ field: 'startedAt', message: 'A data de início não pode estar no futuro.' }];
      expect(validateStart(at('2026-10-25T12:00:00.001Z'), NOW)).toEqual(expected);
      expect(validateStart(at('2026-10-26T12:00:00.000Z'), NOW)).toEqual(expected);
    });
  });

  describe('validateFinish', () => {
    const usage = { startedAt: at('2026-10-25T08:00:00.000Z'), endedAt: null };
    const future = [{ field: 'endedAt', message: 'A data de término não pode estar no futuro.' }];
    const notAfterStart = [{ field: 'endedAt', message: 'A data de término deve ser posterior à data de início.' }];

    it('rejeita término no futuro', () => {
      expect(validateFinish(usage, at('2026-10-25T12:00:00.001Z'), NOW)).toEqual(future);
      expect(validateFinish(usage, at('2026-10-30T12:00:00.000Z'), NOW)).toEqual(future);
    });

    it('rejeita término igual ao início', () => {
      expect(validateFinish(usage, new Date(usage.startedAt), NOW)).toEqual(notAfterStart);
    });

    it('rejeita término antes do início', () => {
      expect(validateFinish(usage, at('2026-10-25T07:59:59.999Z'), NOW)).toEqual(notAfterStart);
      expect(validateFinish(usage, at('2026-10-20T08:00:00.000Z'), NOW)).toEqual(notAfterStart);
    });

    it('aceita término entre o início e agora', () => {
      expect(validateFinish(usage, at('2026-10-25T08:00:00.001Z'), NOW)).toEqual([]);
      expect(validateFinish(usage, at('2026-10-25T10:00:00.000Z'), NOW)).toEqual([]);
    });

    it('aceita término exatamente agora', () => {
      expect(validateFinish(usage, new Date(NOW), NOW)).toEqual([]);
    });

    it('devolve uma única violação, priorizando o término no futuro', () => {
      const futureUsage = { startedAt: at('2026-10-25T14:00:00.000Z'), endedAt: null };
      expect(validateFinish(futureUsage, at('2026-10-25T13:00:00.000Z'), NOW)).toEqual(future);
    });
  });
});
