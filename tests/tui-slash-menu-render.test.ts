import { expect, test } from 'vitest';

import { renderTuiSlashMenuLines } from '../src/tui-slash-menu-render.js';

const palette = {
  reset: '',
  separator: '',
  marker: '',
  markerSelected: '',
  command: '',
  commandSelected: '',
  description: '',
  descriptionSelected: '',
};

test('renders empty slash menu states with a fallback message', () => {
  const lines = renderTuiSlashMenuLines({
    query: 'zzz',
    entries: [],
    selectedIndex: 0,
    width: 40,
    palette,
  });

  expect(lines[0]).toContain('─');
  expect(lines[1]).toContain('No slash commands match "/zzz".');
});

test('expands the selected item description across continuation lines', () => {
  const lines = renderTuiSlashMenuLines({
    query: 'model',
    entries: [
      {
        id: 'model',
        label: '/model',
        insertText: '/model ',
        description:
          'Inspect or set the session model with a deliberately long description for wrapping.',
        searchTerms: ['/model', 'model'],
        depth: 1,
        sortIndex: 0,
      },
      {
        id: 'status',
        label: '/status',
        insertText: '/status',
        description: 'Show runtime status.',
        searchTerms: ['/status', 'status'],
        depth: 1,
        sortIndex: 1,
      },
    ],
    selectedIndex: 0,
    width: 40,
    palette,
  });

  expect(lines.length).toBeGreaterThan(2);
  expect(lines[1]).toContain('› /model');
  expect(lines[2]).toContain('session model');
});
