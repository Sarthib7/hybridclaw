import os from 'node:os';
import path from 'node:path';

import { expect, test } from 'vitest';

import { expandUserPath } from '../src/media/path-utils.js';

test('expands tilde-prefixed paths relative to the home directory', () => {
  expect(expandUserPath('~/voice-note.ogg')).toBe(
    path.join(os.homedir(), 'voice-note.ogg'),
  );
  expect(expandUserPath('~')).toBe(os.homedir());
});

test('trims surrounding whitespace before expanding', () => {
  expect(expandUserPath('  ~/voice-note.ogg  ')).toBe(
    path.join(os.homedir(), 'voice-note.ogg'),
  );
  expect(expandUserPath('  ./relative/path  ')).toBe('./relative/path');
});
