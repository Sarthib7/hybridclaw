import path from 'node:path';

export const WORKSPACE_ROOT_DISPLAY = '/workspace';
export const DISCORD_MEDIA_CACHE_ROOT_DISPLAY = '/discord-media-cache';

export const WORKSPACE_ROOT = path.resolve(
  process.env.HYBRIDCLAW_AGENT_WORKSPACE_ROOT || WORKSPACE_ROOT_DISPLAY,
);
export const DISCORD_MEDIA_CACHE_ROOT = path.resolve(
  process.env.HYBRIDCLAW_AGENT_MEDIA_ROOT || DISCORD_MEDIA_CACHE_ROOT_DISPLAY,
);
export const IPC_DIR = path.resolve(
  process.env.HYBRIDCLAW_AGENT_IPC_DIR || '/ipc',
);

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, '/');
}

function isWithinRoot(candidate: string, root: string): boolean {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedRoot = path.resolve(root);
  return (
    resolvedCandidate === resolvedRoot ||
    resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)
  );
}

function resolveDisplayAbsoluteToActual(
  normalizedInput: string,
  displayRoot: string,
  actualRoot: string,
): string | null {
  const normalizedDisplayRoot = path.posix.normalize(displayRoot);
  if (
    normalizedInput !== normalizedDisplayRoot &&
    !normalizedInput.startsWith(`${normalizedDisplayRoot}/`)
  ) {
    return null;
  }

  const relative = normalizedInput
    .slice(normalizedDisplayRoot.length)
    .replace(/^\/+/, '');
  return relative
    ? path.resolve(actualRoot, relative)
    : path.resolve(actualRoot);
}

function resolveRootBoundPath(
  rawPath: string,
  actualRoot: string,
  displayRoot: string,
): string | null {
  const input = String(rawPath || '').trim();
  if (!input) return null;

  const normalizedInput = normalizeSlashes(input);
  if (path.posix.isAbsolute(normalizedInput)) {
    const fromDisplay = resolveDisplayAbsoluteToActual(
      path.posix.normalize(normalizedInput),
      displayRoot,
      actualRoot,
    );
    if (fromDisplay) {
      return isWithinRoot(fromDisplay, actualRoot) ? fromDisplay : null;
    }

    const resolvedActual = path.resolve(input);
    return isWithinRoot(resolvedActual, actualRoot) ? resolvedActual : null;
  }

  const clean = path.posix.normalize(normalizedInput);
  if (clean === '..' || clean.startsWith('../')) return null;
  const resolved = path.resolve(actualRoot, clean);
  return isWithinRoot(resolved, actualRoot) ? resolved : null;
}

export function resolveWorkspacePath(rawPath: string): string | null {
  return resolveRootBoundPath(rawPath, WORKSPACE_ROOT, WORKSPACE_ROOT_DISPLAY);
}

export function resolveMediaPath(rawPath: string): string | null {
  return resolveRootBoundPath(
    rawPath,
    DISCORD_MEDIA_CACHE_ROOT,
    DISCORD_MEDIA_CACHE_ROOT_DISPLAY,
  );
}

export function toWorkspaceRelativePath(rawPath: string): string | null {
  const resolved = resolveWorkspacePath(rawPath);
  if (!resolved) return null;
  return path.relative(WORKSPACE_ROOT, resolved).replace(/\\/g, '/');
}

function stripRootPrefix(value: string, root: string): string {
  const normalizedValue = normalizeSlashes(value);
  const normalizedRoot = normalizeSlashes(root).replace(/\/+$/, '');
  if (normalizedValue === normalizedRoot) return '';
  if (normalizedValue.startsWith(`${normalizedRoot}/`)) {
    return normalizedValue.slice(normalizedRoot.length + 1);
  }
  return value;
}

export function stripWorkspaceRootPrefix(rawPath: string): string {
  const strippedDisplay = stripRootPrefix(rawPath, WORKSPACE_ROOT_DISPLAY);
  return stripRootPrefix(strippedDisplay, WORKSPACE_ROOT);
}

export function replaceWorkspaceRootInOutput(text: string): string {
  return text
    .replaceAll(`${WORKSPACE_ROOT.replace(/\\/g, '/')}/`, '')
    .replaceAll(`${WORKSPACE_ROOT_DISPLAY}/`, '');
}
