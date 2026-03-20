import fs from 'node:fs';
import path from 'node:path';

export function hasExecutableCommand(
  command: string,
  options?: {
    cwd?: string;
  },
): boolean {
  const normalized = String(command || '').trim();
  if (!normalized) return false;

  const cwd = options?.cwd || process.cwd();
  const isPathLike =
    path.isAbsolute(normalized) ||
    normalized.includes('/') ||
    normalized.includes('\\');
  if (isPathLike) {
    const candidate = path.isAbsolute(normalized)
      ? normalized
      : path.resolve(cwd, normalized);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  const currentPath = process.env.PATH || '';
  const currentPathExt =
    process.platform === 'win32' ? process.env.PATHEXT || '' : '';

  const exts =
    process.platform === 'win32'
      ? [
          '',
          ...currentPathExt
            .split(';')
            .map((ext) => ext.trim())
            .filter(Boolean),
        ]
      : [''];
  for (const part of currentPath.split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const candidate = path.join(part, `${normalized}${ext}`);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return true;
      } catch {
        // continue scanning
      }
    }
  }

  return false;
}
