export function normalizeMimeType(
  value: string | null | undefined,
): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase().split(';')[0]?.trim();
  return normalized || null;
}

export const AUDIO_FILE_EXTENSION_RE =
  /\.(aac|aif|aiff|alac|flac|m4a|mp3|mp4|mpeg|mpga|oga|ogg|opus|wav|webm|wma)$/i;
