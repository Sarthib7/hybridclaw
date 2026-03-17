export function normalizeTrimmedStringArray(
  values: readonly unknown[] | undefined,
): string[] {
  return (values ?? [])
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

export function normalizeTrimmedStringSet(
  values: readonly unknown[] | undefined,
): Set<string> {
  return new Set(normalizeTrimmedStringArray(values));
}
