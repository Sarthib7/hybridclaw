import { expect, test } from 'vitest';

import {
  buildTuiSlashMenuEntries,
  rankTuiSlashMenuEntries,
  resolveTuiSlashMenuQuery,
} from '../src/tui-slash-menu.js';

test('builds canonical, choice-based, and TUI-only slash menu entries', () => {
  const entries = buildTuiSlashMenuEntries();
  const labels = entries.map((entry) => entry.label);

  expect(labels).toContain('/show tools');
  expect(labels).toContain('/model select');
  expect(labels).toContain('/approve yes [approval_id]');
  expect(labels).toContain('/fullauto on [prompt]');
  expect(labels).toContain('/bots');
});

test('resolves slash menu queries only at the end of the active line', () => {
  const slashInput = '/mod';
  const spacedInput = '/model ';
  const quotedInput = '/schedule add "*/5 * * * *"';
  const plainInput = 'plain text';

  expect(resolveTuiSlashMenuQuery(slashInput, slashInput.length)).toBe('mod');
  expect(resolveTuiSlashMenuQuery(spacedInput, spacedInput.length)).toBe(
    'model',
  );
  expect(resolveTuiSlashMenuQuery('/model set', 3)).toBeNull();
  expect(resolveTuiSlashMenuQuery(quotedInput, quotedInput.length)).toBeNull();
  expect(resolveTuiSlashMenuQuery(plainInput, plainInput.length)).toBeNull();
});

test('fuzzy ranking prefers the model command for compact queries', () => {
  const ranked = rankTuiSlashMenuEntries(buildTuiSlashMenuEntries(), 'mdl');

  expect(ranked[0]?.label).toBe('/model');
  expect(ranked.some((entry) => entry.label === '/model set <name>')).toBe(
    true,
  );
});

test('fuzzy ranking can target nested command variants', () => {
  const ranked = rankTuiSlashMenuEntries(
    buildTuiSlashMenuEntries(),
    'approve ag',
  );

  expect(ranked[0]?.label).toBe('/approve agent [approval_id]');
});
