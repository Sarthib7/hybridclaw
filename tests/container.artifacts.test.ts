import { expect, test } from 'vitest';

import { inferArtifactMimeType } from '../container/src/artifacts.js';

test('infers OOXML artifact mime types', () => {
  expect(inferArtifactMimeType('report.docx')).toBe(
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );
  expect(inferArtifactMimeType('deck.pptx')).toBe(
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  );
  expect(inferArtifactMimeType('model.xlsx')).toBe(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  expect(inferArtifactMimeType('preview.png')).toBe('image/png');
});
