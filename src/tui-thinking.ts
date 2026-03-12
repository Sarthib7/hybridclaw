export function appendThinkingPreview(
  current: string,
  delta: string,
  maxChars: number,
): string {
  const normalizedCurrent = String(current || '');
  const normalizedDelta = String(delta || '');
  if (!normalizedDelta) return normalizedCurrent;

  const combined = `${normalizedCurrent}${normalizedDelta}`
    .replace(/\s+/g, ' ')
    .trim();
  if (combined.length <= maxChars) return combined;
  if (maxChars <= 1) return combined.slice(-maxChars);
  return `…${combined.slice(-(maxChars - 1))}`;
}
