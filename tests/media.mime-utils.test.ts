import { expect, test } from 'vitest';

import {
  AUDIO_FILE_EXTENSION_RE,
  normalizeMimeType,
} from '../src/media/mime-utils.js';

test('matches supported audio file extensions', () => {
  expect(AUDIO_FILE_EXTENSION_RE.test('voice-note.ogg')).toBe(true);
  expect(AUDIO_FILE_EXTENSION_RE.test('recording.MP3')).toBe(true);
  expect(AUDIO_FILE_EXTENSION_RE.test('clip.webm')).toBe(true);
});

test('does not match non-audio file extensions', () => {
  expect(AUDIO_FILE_EXTENSION_RE.test('document.pdf')).toBe(false);
  expect(AUDIO_FILE_EXTENSION_RE.test('photo.png')).toBe(false);
});

test('normalizes MIME types to their canonical base value', () => {
  expect(normalizeMimeType(' audio/ogg; codecs=opus ')).toBe('audio/ogg');
  expect(normalizeMimeType('IMAGE/PNG')).toBe('image/png');
  expect(normalizeMimeType('')).toBeNull();
  expect(normalizeMimeType(undefined)).toBeNull();
});
