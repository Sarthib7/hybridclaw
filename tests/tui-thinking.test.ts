import { expect, test } from 'vitest';

import { appendThinkingPreview } from '../src/tui-thinking.js';

test('appends thinking deltas into a normalized single-line preview', () => {
  expect(appendThinkingPreview('Thinking', '   about\nmusic  tastes', 80)).toBe(
    'Thinking about music tastes',
  );
});

test('keeps the tail of long thinking previews', () => {
  expect(
    appendThinkingPreview('0123456789', 'abcdefghijklmnopqrstuvwxyz', 12),
  ).toBe('…pqrstuvwxyz');
});
