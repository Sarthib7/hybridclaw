import {
  MissingRequiredEnvVarError,
  refreshRuntimeSecretsFromEnv,
} from '../config/config.js';

const PROVIDER_API_KEY_REFRESH_DEBOUNCE_MS = 250;
let lastProviderApiKeyRefreshAt = 0;

function refreshProviderSecretsIfNeeded(): void {
  const now = Date.now();
  if (
    lastProviderApiKeyRefreshAt > 0 &&
    now - lastProviderApiKeyRefreshAt < PROVIDER_API_KEY_REFRESH_DEBOUNCE_MS
  ) {
    return;
  }
  refreshRuntimeSecretsFromEnv();
  lastProviderApiKeyRefreshAt = now;
}

export function readProviderApiKey(
  getEnvValues: () => Array<string | undefined>,
  missingEnvVar: string,
  opts?: { required?: boolean },
): string {
  refreshProviderSecretsIfNeeded();
  const apiKey =
    getEnvValues().find((value) => typeof value === 'string' && value) || '';
  const normalized = apiKey.trim();
  if (!normalized && opts?.required !== false) {
    throw new MissingRequiredEnvVarError(missingEnvVar);
  }
  return normalized;
}
