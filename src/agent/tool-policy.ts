import {
  getRuntimeConfig,
  getRuntimeDisabledToolNames,
} from '../config/runtime-config.js';

function normalizeToolList(
  tools: Iterable<string | null | undefined>,
): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const entry of tools) {
    const name = String(entry || '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    normalized.push(name);
  }
  return normalized;
}

export function mergeBlockedToolNames(params?: {
  explicit?: readonly string[] | null;
  runtimeDisabled?: Iterable<string>;
}): string[] | undefined {
  const explicit = Array.isArray(params?.explicit) ? params.explicit : [];
  const runtimeDisabled =
    params?.runtimeDisabled ?? getRuntimeDisabledToolNames(getRuntimeConfig());
  const merged = normalizeToolList([...explicit, ...runtimeDisabled]);
  return merged.length > 0 ? merged : undefined;
}
