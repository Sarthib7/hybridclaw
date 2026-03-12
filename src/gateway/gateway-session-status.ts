import { getRecentStructuredAuditForSession } from '../memory/db.js';
import { firstNumber, parseAuditPayload } from './gateway-utils.js';

export interface SessionStatusSnapshot {
  promptTokens: number | null;
  completionTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  cacheHitPercent: number | null;
  contextUsedTokens: number | null;
  contextBudgetTokens: number | null;
  contextUsagePercent: number | null;
}

export function readSessionStatusSnapshot(
  sessionId: string,
  options?: { modelContextWindowTokens?: number | null },
): SessionStatusSnapshot {
  const entries = getRecentStructuredAuditForSession(sessionId, 160);
  let usagePayload: Record<string, unknown> | null = null;

  for (const entry of entries) {
    const payload = parseAuditPayload(entry);
    if (!payload) continue;
    const payloadType =
      typeof payload.type === 'string' ? payload.type : entry.event_type;
    if (!usagePayload && payloadType === 'model.usage') {
      usagePayload = payload;
    }
    if (usagePayload) break;
  }

  const promptTokens = firstNumber([
    usagePayload?.promptTokens,
    usagePayload?.apiPromptTokens,
    usagePayload?.estimatedPromptTokens,
  ]);
  const completionTokens = firstNumber([
    usagePayload?.completionTokens,
    usagePayload?.apiCompletionTokens,
    usagePayload?.estimatedCompletionTokens,
  ]);

  const cacheReadTokens = firstNumber([
    usagePayload?.cacheReadTokens,
    usagePayload?.cacheReadInputTokens,
    usagePayload?.apiCacheReadTokens,
    usagePayload?.cacheRead,
    usagePayload?.cache_read,
    usagePayload?.cache_read_tokens,
    usagePayload?.cache_read_input_tokens,
    usagePayload?.cached_tokens,
    (usagePayload?.prompt_tokens_details as Record<string, unknown> | undefined)
      ?.cached_tokens,
  ]);
  const cacheWriteTokens = firstNumber([
    usagePayload?.cacheWriteTokens,
    usagePayload?.cacheWriteInputTokens,
    usagePayload?.apiCacheWriteTokens,
    usagePayload?.cacheWrite,
    usagePayload?.cache_write,
    usagePayload?.cache_write_tokens,
    usagePayload?.cache_write_input_tokens,
    usagePayload?.cache_creation_input_tokens,
  ]);
  const cacheRead = Math.max(0, cacheReadTokens || 0);
  const cacheWrite = Math.max(0, cacheWriteTokens || 0);
  const cacheTotal = cacheRead + cacheWrite;
  const cacheHitPercent =
    cacheTotal > 0 ? (cacheRead / cacheTotal) * 100 : null;

  const contextUsedTokens = firstNumber([
    usagePayload?.contextTokens,
    usagePayload?.context_tokens,
    usagePayload?.tokensInContext,
    usagePayload?.tokens_in_context,
    usagePayload?.promptTokens,
    usagePayload?.apiPromptTokens,
    usagePayload?.estimatedPromptTokens,
  ]);
  const contextBudgetTokens = firstNumber([
    usagePayload?.contextWindowTokens,
    usagePayload?.context_window_tokens,
    usagePayload?.modelContextWindowTokens,
    usagePayload?.model_context_window_tokens,
    usagePayload?.modelContextWindow,
    usagePayload?.model_context_window,
    usagePayload?.maxContextTokens,
    usagePayload?.max_context_tokens,
    usagePayload?.contextWindow,
    usagePayload?.context_window,
    usagePayload?.contextLength,
    usagePayload?.context_length,
    usagePayload?.maxContextSize,
    usagePayload?.max_context_size,
    options?.modelContextWindowTokens,
  ]);
  const contextUsagePercent =
    contextUsedTokens != null &&
    contextBudgetTokens != null &&
    contextBudgetTokens > 0
      ? (contextUsedTokens / contextBudgetTokens) * 100
      : null;

  return {
    promptTokens,
    completionTokens,
    cacheReadTokens,
    cacheWriteTokens,
    cacheHitPercent,
    contextUsedTokens,
    contextBudgetTokens,
    contextUsagePercent,
  };
}
