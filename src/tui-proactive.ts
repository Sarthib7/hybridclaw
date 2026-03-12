export function proactiveBadgeLabel(source: string | null | undefined): string {
  return source === 'fullauto' ? 'fullauto' : 'reminder';
}

export function proactiveSourceSuffix(
  source: string | null | undefined,
): string {
  if (!source || source === 'fullauto') return '';
  return `(${source})`;
}
