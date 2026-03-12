import { describe, expect, test } from 'vitest';

import {
  parseRalphChoice,
  stripRalphChoiceTags,
} from '../container/src/ralph.js';

describe('container ralph helpers', () => {
  test('parses stop choice tags', () => {
    expect(parseRalphChoice('<choice>STOP</choice>')).toBe('STOP');
  });

  test('drops choice-only content from visible output', () => {
    expect(stripRalphChoiceTags('<choice>STOP</choice>')).toBeNull();
  });

  test('preserves text outside ralph choice tags', () => {
    expect(
      stripRalphChoiceTags('First question?\n\n<choice>CONTINUE</choice>'),
    ).toBe('First question?');
  });

  test('preserves ordinary text that has no choice tags', () => {
    expect(stripRalphChoiceTags('Nice to meet you.')).toBe('Nice to meet you.');
  });
});
