import { expect, test } from 'vitest';

import {
  buildSessionBoundaryPreview,
  buildSessionConversationPreview,
} from '../src/session/session-preview.ts';

test('buildSessionBoundaryPreview combines first and last snippets', () => {
  expect(
    buildSessionBoundaryPreview({
      firstMessage:
        'First message that should be kept near the start of the preview.',
      lastMessage:
        'Last message that should also appear so recent chat lists carry more context.',
      maxLength: 24,
    }),
  ).toEqual({
    firstMessage: 'First message that sh...',
    lastMessage: 'Last message that sho...',
    summary: '"First message that sh..." ... "Last message that sho..."',
  });
});

test('buildSessionConversationPreview returns the latest user and assistant snippets', () => {
  expect(
    buildSessionConversationPreview([
      { role: 'user', content: 'Initial prompt' },
      { role: 'assistant', content: 'Initial answer' },
      { role: 'user', content: 'Most recent question with extra detail' },
      { role: 'assistant', content: 'Most recent answer with extra detail' },
    ]),
  ).toEqual({
    lastQuestion: 'Most recent question with extra detail',
    lastAnswer: 'Most recent answer with extra detail',
  });
});
