export function numberFromUnknown(value: unknown): number | null {
  if (
    typeof value !== 'number' ||
    Number.isNaN(value) ||
    !Number.isFinite(value)
  ) {
    return null;
  }
  return value;
}

export function firstNumber(values: unknown[]): number | null {
  for (const value of values) {
    const parsed = numberFromUnknown(value);
    if (parsed != null) return parsed;
  }
  return null;
}
