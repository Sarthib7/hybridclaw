import type readline from 'node:readline';

import { expect, test, vi } from 'vitest';

import type { GatewayAdminSkillsResponse } from '../src/gateway/gateway-types.js';
import {
  collectTuiSkillConfigMutations,
  createTuiSkillConfigDraft,
  promptTuiSkillConfig,
  renderTuiSkillConfigLines,
  setTuiSkillEnabledInScope,
} from '../src/tui-skill-config.js';

const PALETTE = {
  reset: '',
  bold: '',
  muted: '',
  teal: '',
  gold: '',
  green: '',
  red: '',
};

function makeResponse(): GatewayAdminSkillsResponse {
  return {
    extraDirs: [],
    disabled: ['alpha'],
    channelDisabled: {
      discord: ['beta'],
      msteams: [],
      whatsapp: [],
      email: [],
    },
    skills: [
      {
        name: 'alpha',
        description: 'Alpha skill',
        source: 'bundled',
        available: true,
        enabled: false,
        missing: [],
        userInvocable: true,
        disableModelInvocation: false,
        always: false,
        tags: [],
        relatedSkills: [],
      },
      {
        name: 'beta',
        description: 'Beta skill',
        source: 'bundled',
        available: true,
        enabled: true,
        missing: [],
        userInvocable: true,
        disableModelInvocation: false,
        always: false,
        tags: [],
        relatedSkills: [],
      },
      {
        name: 'gamma',
        description: 'Gamma skill',
        source: 'workspace',
        available: false,
        enabled: true,
        missing: ['python3'],
        userInvocable: false,
        disableModelInvocation: false,
        always: false,
        tags: [],
        relatedSkills: [],
      },
    ],
  };
}

test('collectTuiSkillConfigMutations compares global and per-channel diffs', () => {
  const response = makeResponse();
  const draft = createTuiSkillConfigDraft(response);

  setTuiSkillEnabledInScope(draft, 'alpha', true, 'global');
  setTuiSkillEnabledInScope(draft, 'gamma', false, 'discord');

  expect(collectTuiSkillConfigMutations(response, draft)).toEqual([
    {
      name: 'alpha',
      enabled: true,
      channel: undefined,
    },
    {
      name: 'gamma',
      enabled: false,
      channel: 'discord',
    },
  ]);
});

test('renderTuiSkillConfigLines shows global override notes inside channel scopes', () => {
  const response = makeResponse();
  const draft = createTuiSkillConfigDraft(response);
  const rendered = renderTuiSkillConfigLines({
    response,
    draft,
    scope: 'discord',
    cursor: 0,
    scrollOffset: 0,
    width: 80,
    height: 12,
    palette: PALETTE,
  });

  expect(rendered.lines.join('\n')).toContain('[discord]');
  expect(rendered.lines.join('\n')).toContain('global disable still applies');
  expect(rendered.lines.join('\n')).toContain('missing: python3');
});

test('promptTuiSkillConfig saves local toggles across multiple scopes', async () => {
  const response = makeResponse();
  const writes: string[] = [];
  const output = {
    isTTY: true,
    columns: 80,
    rows: 12,
    write: (chunk: string) => {
      writes.push(chunk);
      return true;
    },
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as NodeJS.WriteStream;
  const rl = {
    line: '',
    cursor: 0,
    _ttyWrite: vi.fn(),
  } as unknown as readline.Interface;
  const saveMutation = vi.fn(async () => undefined);

  const prompt = promptTuiSkillConfig({
    rl,
    response,
    saveMutation,
    palette: PALETTE,
    output,
  });

  const ttyWrite = (
    rl as unknown as { _ttyWrite: (chunk: string, key: readline.Key) => void }
  )._ttyWrite;

  ttyWrite(' ', { name: 'space' });
  ttyWrite('', { name: 'right' });
  ttyWrite('', { name: 'down' });
  ttyWrite(' ', { name: 'space' });
  ttyWrite('', { name: 'return' });

  await expect(prompt).resolves.toEqual({
    cancelled: false,
    savedCount: 2,
    changedScopeCount: 2,
  });
  expect(saveMutation.mock.calls.map(([mutation]) => mutation)).toEqual([
    {
      name: 'alpha',
      enabled: true,
      channel: undefined,
    },
    {
      name: 'beta',
      enabled: true,
      channel: 'discord',
    },
  ]);
  expect(writes.length).toBeGreaterThan(0);
});
