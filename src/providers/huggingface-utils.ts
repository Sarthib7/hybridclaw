import {
  HUGGINGFACE_API_KEY,
  MissingRequiredEnvVarError,
  refreshRuntimeSecretsFromEnv,
} from '../config/config.js';

export const HUGGINGFACE_MODEL_PREFIX = 'huggingface/';

export function readHuggingFaceApiKey(opts?: { required?: boolean }): string {
  refreshRuntimeSecretsFromEnv();
  const apiKey =
    process.env.HF_TOKEN ||
    process.env.HUGGINGFACE_API_KEY ||
    HUGGINGFACE_API_KEY ||
    '';
  const normalized = apiKey.trim();
  if (!normalized && opts?.required !== false) {
    throw new MissingRequiredEnvVarError('HF_TOKEN');
  }
  return normalized;
}
