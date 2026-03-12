import { expect, test } from 'vitest';
import {
  guessWhatsAppExtensionFromMimeType,
  resolveWhatsAppMimeTypeFromPath,
} from '../src/channels/whatsapp/mime-utils.js';

test('maps WhatsApp MIME types to canonical extensions', () => {
  expect(guessWhatsAppExtensionFromMimeType('image/jpeg')).toBe('.jpg');
  expect(guessWhatsAppExtensionFromMimeType('audio/ogg; codecs=opus')).toBe(
    '.ogg',
  );
  expect(guessWhatsAppExtensionFromMimeType('video/quicktime')).toBe('.mov');
  expect(guessWhatsAppExtensionFromMimeType('application/unknown')).toBe('');
});

test('resolves WhatsApp MIME types from file paths', () => {
  expect(resolveWhatsAppMimeTypeFromPath('/tmp/picture.jpeg')).toBe(
    'image/jpeg',
  );
  expect(resolveWhatsAppMimeTypeFromPath('/tmp/voice.ogg')).toBe('audio/ogg');
  expect(resolveWhatsAppMimeTypeFromPath('/tmp/movie.mov')).toBe(
    'video/quicktime',
  );
  expect(resolveWhatsAppMimeTypeFromPath('/tmp/archive.bin')).toBe(
    'application/octet-stream',
  );
});
