import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

describe('skill install metadata', () => {
  const originalHome = process.env.HOME;
  const originalDisableWatcher = process.env.HYBRIDCLAW_DISABLE_CONFIG_WATCHER;

  beforeEach(() => {
    const tempHome = fs.mkdtempSync(
      path.join(os.tmpdir(), 'hybridclaw-skills-install-'),
    );
    vi.stubEnv('HOME', tempHome);
    vi.stubEnv('HYBRIDCLAW_DISABLE_CONFIG_WATCHER', '1');
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalDisableWatcher === undefined) {
      delete process.env.HYBRIDCLAW_DISABLE_CONFIG_WATCHER;
    } else {
      process.env.HYBRIDCLAW_DISABLE_CONFIG_WATCHER = originalDisableWatcher;
    }
  });

  test('loads install metadata declared by the pdf skill', async () => {
    const { findSkillCatalogEntry } = await import(
      '../src/skills/skills-install.ts'
    );
    const skill = findSkillCatalogEntry('pdf');
    expect(skill).not.toBeNull();
    expect(skill?.metadata.hybridclaw.install).toEqual([
      {
        id: 'brew-poppler',
        kind: 'brew',
        formula: 'poppler',
        bins: ['pdftotext', 'pdftoppm', 'pdfinfo', 'pdfimages'],
        label: 'Install Poppler CLI tools (brew)',
      },
      {
        id: 'brew-qpdf',
        kind: 'brew',
        formula: 'qpdf',
        bins: ['qpdf'],
        label: 'Install qpdf (brew)',
      },
    ]);
  });

  test('resolves a declared install option by id', async () => {
    const { resolveSkillInstallSelection } = await import(
      '../src/skills/skills-install.ts'
    );
    const selection = resolveSkillInstallSelection({
      skillName: 'pdf',
      installId: 'brew-poppler',
    });

    if ('error' in selection) {
      throw new Error(selection.error);
    }

    expect(selection.installId).toBe('brew-poppler');
    expect(selection.spec.kind).toBe('brew');
    expect(selection.spec.formula).toBe('poppler');
  });

  test('reads install metadata and requires from metadata.openclaw', async () => {
    const { DEFAULT_RUNTIME_HOME_DIR } = await import(
      '../src/config/runtime-config.ts'
    );
    const { findSkillCatalogEntry } = await import(
      '../src/skills/skills-install.ts'
    );

    const skillDir = path.join(DEFAULT_RUNTIME_HOME_DIR, 'skills', 'openhue');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      [
        '---',
        'name: openhue',
        'description: Control Philips Hue lights and scenes.',
        'metadata: {"openclaw":{"requires":{"bins":["openhue"]},"install":[{"id":"brew","kind":"brew","formula":"openhue/cli/openhue-cli","bins":["openhue"],"label":"Install OpenHue CLI (brew)"}]}}',
        '---',
        '',
        '# OpenHue',
      ].join('\n'),
      'utf8',
    );

    const skill = findSkillCatalogEntry('openhue');

    expect(skill).not.toBeNull();
    expect(skill?.requires).toEqual({
      bins: ['openhue'],
      env: [],
    });
    expect(skill?.metadata.hybridclaw.install).toEqual([
      {
        id: 'brew',
        kind: 'brew',
        formula: 'openhue/cli/openhue-cli',
        bins: ['openhue'],
        label: 'Install OpenHue CLI (brew)',
      },
    ]);
  });
});
