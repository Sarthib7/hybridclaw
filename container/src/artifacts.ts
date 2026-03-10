import path from 'node:path';

export const ARTIFACT_MIME_TYPES: Record<string, string> = {
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.pptx':
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.xlsx':
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export function inferArtifactMimeType(filePath: string): string {
  const normalized = String(filePath || '').replace(/\\/g, '/');
  const ext = path.posix.extname(normalized).toLowerCase();
  return ARTIFACT_MIME_TYPES[ext] || 'application/octet-stream';
}
