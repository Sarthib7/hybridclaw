import { expect, test } from 'vitest';

import { sanitizeUploadedMediaFilename } from '../src/media/uploaded-media-cache.js';

test('sanitizeUploadedMediaFilename keeps an existing extension', () => {
  expect(sanitizeUploadedMediaFilename(' Screen Shot.PNG ', 'image/jpeg')).toBe(
    'Screen-Shot.png',
  );
});

test('sanitizeUploadedMediaFilename infers a preferred extension when missing', () => {
  expect(sanitizeUploadedMediaFilename('clipboard image', 'image/png')).toBe(
    'clipboard-image.png',
  );
});
