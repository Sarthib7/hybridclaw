export const HYBRIDAI_MODEL_PREFIX = 'hybridai/';

const NON_HYBRID_PROVIDER_PREFIXES = [
  'openai-codex/',
  'openrouter/',
  'anthropic/',
  'ollama/',
  'lmstudio/',
  'vllm/',
] as const;

function hasKnownNonHybridProviderPrefix(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return NON_HYBRID_PROVIDER_PREFIXES.some((prefix) =>
    normalized.startsWith(prefix),
  );
}

function hasDisplayOnlyHybridAIPrefix(model: string): boolean {
  const normalized = model.trim();
  if (!normalized.toLowerCase().startsWith(HYBRIDAI_MODEL_PREFIX)) {
    return false;
  }
  const upstreamModel = normalized.slice(HYBRIDAI_MODEL_PREFIX.length).trim();
  return (
    Boolean(upstreamModel) && !hasKnownNonHybridProviderPrefix(upstreamModel)
  );
}

export function normalizeHybridAIModelForRuntime(model: string): string {
  const normalized = String(model || '').trim();
  if (!hasDisplayOnlyHybridAIPrefix(normalized)) {
    return normalized;
  }
  return normalized.slice(HYBRIDAI_MODEL_PREFIX.length).trim();
}

export function formatModelForDisplay(model: string): string {
  const normalized = String(model || '').trim();
  if (!normalized) return '';
  if (normalized.toLowerCase().startsWith(HYBRIDAI_MODEL_PREFIX)) {
    return normalized;
  }
  if (hasKnownNonHybridProviderPrefix(normalized)) {
    return normalized;
  }
  return `${HYBRIDAI_MODEL_PREFIX}${normalized}`;
}
