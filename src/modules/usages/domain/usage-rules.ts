export interface RuleViolation {
  field: string;
  message: string;
}

export interface UsagePeriod {
  startedAt: Date;
  endedAt: Date | null;
}

export type UsageParty = 'vehicle' | 'driver';

const BUSY_MESSAGES: Record<UsageParty, { now: string; inPeriod: string }> = {
  vehicle: {
    now: 'O automóvel já está em uso por um motorista.',
    inPeriod: 'O automóvel já estava em uso no período informado.',
  },
  driver: {
    now: 'O motorista já está utilizando outro automóvel.',
    inPeriod: 'O motorista já estava utilizando um automóvel no período informado.',
  },
};

export function availabilityConflict(party: UsageParty, latest: UsagePeriod | null, startedAt: Date): RuleViolation | null {
  if (!latest) return null;
  const field = `${party}Id`;
  if (latest.endedAt === null) return { field, message: BUSY_MESSAGES[party].now };
  if (latest.endedAt > startedAt) return { field, message: BUSY_MESSAGES[party].inPeriod };
  return null;
}

export function validateStart(startedAt: Date, now: Date): RuleViolation[] {
  if (startedAt > now) return [{ field: 'startedAt', message: 'A data de início não pode estar no futuro.' }];
  return [];
}

export function validateFinish(usage: UsagePeriod, endedAt: Date, now: Date): RuleViolation[] {
  if (endedAt > now) return [{ field: 'endedAt', message: 'A data de término não pode estar no futuro.' }];
  if (endedAt <= usage.startedAt) return [{ field: 'endedAt', message: 'A data de término deve ser posterior à data de início.' }];
  return [];
}
