import path from 'node:path';

import { normalizeMimeType } from '../../media/mime-utils.js';

const MIME_TABLE = [
  { mimeType: 'image/jpeg', extensions: ['.jpg', '.jpeg'] },
  { mimeType: 'image/png', extensions: ['.png'] },
  { mimeType: 'image/gif', extensions: ['.gif'] },
  { mimeType: 'image/webp', extensions: ['.webp'] },
  { mimeType: 'video/mp4', extensions: ['.mp4'] },
  { mimeType: 'video/quicktime', extensions: ['.mov'] },
  { mimeType: 'audio/ogg', extensions: ['.ogg'] },
  { mimeType: 'audio/mpeg', extensions: ['.mp3'] },
  { mimeType: 'audio/wav', extensions: ['.wav'] },
  { mimeType: 'application/pdf', extensions: ['.pdf'] },
] as const;

const EXTENSION_TO_MIME = new Map<string, string>();
const MIME_TO_EXTENSION = new Map<string, string>();

for (const entry of MIME_TABLE) {
  MIME_TO_EXTENSION.set(entry.mimeType, entry.extensions[0]);
  for (const extension of entry.extensions) {
    EXTENSION_TO_MIME.set(extension, entry.mimeType);
  }
}

export function guessWhatsAppExtensionFromMimeType(
  mimeType: string | null | undefined,
): string {
  const normalized = normalizeMimeType(mimeType);
  if (!normalized) return '';
  return MIME_TO_EXTENSION.get(normalized) || '';
}

export function resolveWhatsAppMimeTypeFromPath(filePath: string): string {
  const extension = path.extname(String(filePath || '')).toLowerCase();
  return EXTENSION_TO_MIME.get(extension) || 'application/octet-stream';
}
