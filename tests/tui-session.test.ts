import { expect, test } from 'vitest';

import {
  buildTuiExitSummaryLines,
  formatTuiSessionDuration,
  generateTuiSessionId,
  resolveTuiRunOptions,
} from '../src/tui-session.js';

test('generateTuiSessionId uses a hermes-style timestamp and short hex suffix', () => {
  const sessionId = generateTuiSessionId(
    new Date(2026, 2, 16, 12, 22, 38),
    '532f05',
  );

  expect(sessionId).toBe('20260316_122238_532f05');
});

test('resolveTuiRunOptions preserves explicit resume session ids', () => {
  const now = new Date(2026, 2, 16, 12, 22, 38);

  expect(
    resolveTuiRunOptions({
      resumeSessionId: '20260316_122238_532f05',
      now,
    }),
  ).toEqual({
    sessionId: '20260316_122238_532f05',
    startedAtMs: now.getTime(),
    resumeCommand: 'hybridclaw --resume',
  });
});

test('buildTuiExitSummaryLines formats the resume hint and session stats', () => {
  expect(
    buildTuiExitSummaryLines({
      sessionId: '20260316_122238_532f05',
      durationMs: 461_000,
      messageCount: 6,
      userMessageCount: 2,
      toolCallCount: 2,
      resumeCommand: 'hybridclaw --resume',
    }),
  ).toEqual([
    'Resume this session with:',
    '  hybridclaw --resume 20260316_122238_532f05',
    '',
    'Session:        20260316_122238_532f05',
    'Duration:       7m 41s',
    'Messages:       6 (2 user, 2 tool calls)',
  ]);
});

test('formatTuiSessionDuration includes hours when needed', () => {
  expect(formatTuiSessionDuration(3_723_000)).toBe('1h 2m 3s');
});
