export const PLATE_PATTERN = /^[A-Z]{3}\d[A-Z\d]\d{2}$/;

export const normalizePlate = (value: unknown) => (typeof value === 'string' ? value.replace(/[\s-]/g, '').toUpperCase() : value);
