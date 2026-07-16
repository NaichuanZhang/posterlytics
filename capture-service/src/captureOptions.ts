export type ColorScheme = 'light' | 'dark';

export class InvalidColorSchemeError extends Error {
  constructor(value: unknown) {
    super(`color_scheme must be "light" or "dark"; received ${JSON.stringify(value)}.`);
    this.name = 'InvalidColorSchemeError';
  }
}

export function normalizeColorScheme(value: unknown): ColorScheme {
  if (value === undefined || value === null) return 'light';
  if (value === 'light' || value === 'dark') return value;
  throw new InvalidColorSchemeError(value);
}
