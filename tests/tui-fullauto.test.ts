import { expect, test } from 'vitest';

import {
  DEFAULT_TUI_FULLAUTO_STATE,
  deriveTuiFullAutoState,
  formatTuiFullAutoPromptLabel,
  parseFullAutoStatusText,
  shouldRouteTuiInputToFullAuto,
} from '../src/tui-fullauto.js';

test('parses full-auto status text from the gateway command response', () => {
  expect(
    parseFullAutoStatusText(
      ['Enabled: yes', 'State: running', 'Prompt: ask questions'].join('\n'),
    ),
  ).toEqual({
    enabled: true,
    runtimeState: 'running',
  });
});

test('derives enabled prompt state from fullauto enable commands', () => {
  const next = deriveTuiFullAutoState({
    current: DEFAULT_TUI_FULLAUTO_STATE,
    args: ['fullauto', 'ask', 'questions'],
    result: {
      kind: 'info',
      title: 'Full-Auto Enabled',
      text: 'Full-auto mode enabled. Agent will run indefinitely.',
    },
  });

  expect(next).toEqual({
    enabled: true,
    runtimeState: 'armed',
  });
  expect(formatTuiFullAutoPromptLabel(next)).toBe('fullauto:armed');
});

test('clears prompt state on stop and fullauto off', () => {
  const runningState = {
    enabled: true,
    runtimeState: 'running',
  };

  expect(
    deriveTuiFullAutoState({
      current: runningState,
      args: ['stop'],
      result: {
        kind: 'plain',
        text: 'Stopped the current session run and disabled full-auto mode.',
      },
    }),
  ).toEqual(DEFAULT_TUI_FULLAUTO_STATE);

  expect(
    deriveTuiFullAutoState({
      current: runningState,
      args: ['fullauto', 'off'],
      result: {
        kind: 'plain',
        text: 'Full-auto mode disabled.',
      },
    }),
  ).toEqual(DEFAULT_TUI_FULLAUTO_STATE);
});

test('routes plain input to background steering whenever full-auto is enabled', () => {
  expect(
    shouldRouteTuiInputToFullAuto({
      enabled: true,
      runtimeState: 'armed',
    }),
  ).toBe(true);
  expect(
    shouldRouteTuiInputToFullAuto({
      enabled: true,
      runtimeState: 'running',
    }),
  ).toBe(true);
  expect(shouldRouteTuiInputToFullAuto(DEFAULT_TUI_FULLAUTO_STATE)).toBe(false);
});
