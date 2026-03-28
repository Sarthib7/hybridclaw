import { describe, expect, test } from 'vitest';
import { HybridAIRequestError } from '../container/src/providers/shared.js';

describe('HybridAIRequestError', () => {
  test('rewrites premium-model permission errors into an actionable message', () => {
    const error = new HybridAIRequestError(
      403,
      JSON.stringify({
        error: {
          message:
            'Premium models require a paid plan or token-credit balance.',
          type: 'permission_error',
          code: 403,
        },
      }),
    );

    expect(error.message).toBe(
      'HybridAI API error 403: Premium model access requires a paid plan or token-credit balance. The non-premium HybridAI model is `gpt-4.1-mini`; use `/model set gpt-4.1-mini`, add credits, or switch to a configured `huggingface/...`, `openrouter/...`, or `openai-codex/...` model.',
    );
  });

  test('formats nested JSON error bodies with only the extracted message', () => {
    const error = new HybridAIRequestError(
      500,
      JSON.stringify({
        error: {
          code: 500,
          message: 'An error occurred while processing your request',
          type: 'server_error',
        },
      }),
    );

    expect(error.message).toBe(
      'HybridAI API error 500: An error occurred while processing your request',
    );
  });

  test('preserves the original response body for debugging', () => {
    const body = JSON.stringify({
      error: {
        code: 500,
        message: 'An error occurred while processing your request',
        type: 'server_error',
      },
    });
    const error = new HybridAIRequestError(500, body);

    expect(error.body).toBe(body);
  });
});
