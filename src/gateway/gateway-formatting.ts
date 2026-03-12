export function formatCompactNumber(value: number | null): string {
  if (value == null) return 'n/a';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    const scaled =
      abs >= 10_000_000
        ? (value / 1_000_000).toFixed(0)
        : (value / 1_000_000).toFixed(1);
    return `${scaled.replace(/\.0$/, '')}M`;
  }
  if (abs >= 1_000) {
    const scaled =
      abs >= 10_000 ? (value / 1_000).toFixed(0) : (value / 1_000).toFixed(1);
    return `${scaled.replace(/\.0$/, '')}k`;
  }
  return String(Math.round(value));
}

export function abbreviateForUser(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}
