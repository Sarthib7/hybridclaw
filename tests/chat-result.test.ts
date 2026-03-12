import { describe, expect, test } from 'vitest';

import { normalizePlaceholderToolReply } from '../src/gateway/chat-result.js';
import type { GatewayChatResult } from '../src/gateway/gateway-types.js';

function makeResult(
  overrides: Partial<GatewayChatResult> = {},
): GatewayChatResult {
  return {
    status: 'success',
    result: 'Done.',
    toolsUsed: ['vision_analyze'],
    artifacts: [],
    toolExecutions: [],
    ...overrides,
  };
}

describe('normalizePlaceholderToolReply', () => {
  test('uses the last successful vision analysis instead of a Done placeholder', () => {
    const result = makeResult({
      toolExecutions: [
        {
          name: 'vision_analyze',
          arguments: '{"file_path":"/tmp/image.jpg"}',
          result: JSON.stringify({
            success: true,
            analysis: 'A basil plant in a terracotta pot.',
          }),
          durationMs: 43800,
        },
      ],
    });

    expect(normalizePlaceholderToolReply(result)).toMatchObject({
      result: 'A basil plant in a terracotta pot.',
    });
  });

  test('leaves non-placeholder replies unchanged', () => {
    const result = makeResult({
      result: 'Direct model answer',
      toolExecutions: [
        {
          name: 'vision_analyze',
          arguments: '{}',
          result: JSON.stringify({
            success: true,
            analysis: 'Should not replace a real answer.',
          }),
          durationMs: 12,
        },
      ],
    });

    expect(normalizePlaceholderToolReply(result)).toBe(result);
  });

  test('ignores failed or malformed vision tool results', () => {
    const result = makeResult({
      toolExecutions: [
        {
          name: 'vision_analyze',
          arguments: '{}',
          result: JSON.stringify({
            success: false,
            error: 'model failed',
          }),
          durationMs: 12,
          isError: true,
        },
      ],
    });

    expect(normalizePlaceholderToolReply(result)).toBe(result);
  });
});
