import { execSync } from 'node:child_process';
import { describe, test, expect } from 'vitest';

/**
 * E2E tests that verify the agent container image (hybridclaw-agent) contains
 * all required runtime tools, libraries, and binaries.
 *
 * The agent container is the sandboxed environment where tool calls execute.
 * Missing tools cause silent failures during agent sessions — these tests
 * catch that in CI before merge.
 *
 * Requires:
 *   HYBRIDCLAW_RUN_DOCKER_E2E=1            — gate flag
 *   HYBRIDCLAW_E2E_AGENT_IMAGE             — pre-built agent image tag
 *
 * All execSync calls use only hardcoded strings (no user input).
 */

const DOCKER_E2E = process.env.HYBRIDCLAW_RUN_DOCKER_E2E === '1';
const IMAGE =
  process.env.HYBRIDCLAW_E2E_AGENT_IMAGE || 'hybridclaw-agent:preflight';

function run(cmd: string): string {
  // All arguments are hardcoded — no user input, no injection risk.
  // Use single quotes for the outer shell -c argument to allow double
  // quotes and parentheses inside commands without escaping.
  return execSync(`docker run --rm --entrypoint sh ${IMAGE} -c '${cmd}'`, {
    encoding: 'utf-8',
    timeout: 30_000,
  }).trim();
}

function hasCommand(cmd: string): boolean {
  try {
    run(`which ${cmd}`);
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!DOCKER_E2E)('agent container image', { timeout: 30_000 }, () => {
  // ── Core runtime ────────────────────────────────────────────────────

  test('node is available', () => {
    const version = run('node --version');
    expect(version).toMatch(/^v22\./);
  });

  test('compiled agent entrypoint exists', () => {
    const result = run('test -f /app/dist/index.js && echo exists');
    expect(result).toBe('exists');
  });

  // ── CLI tools ───────────────────────────────────────────────────────

  const requiredCommands = [
    'git',
    'curl',
    'rg',
    'python3',
    'pip3',
    'pandoc',
    'pdftotext',
    'qpdf',
  ];

  test.each(requiredCommands)('%s is installed', (cmd) => {
    expect(hasCommand(cmd)).toBe(true);
  });

  // ── Python packages ─────────────────────────────────────────────────

  const pythonPackages = [
    'pypdf',
    'pdfplumber',
    'pdf2image',
    'reportlab',
    'PIL',
  ];

  test.each(pythonPackages)('python package %s is importable', (pkg) => {
    const result = run(`python3 -c "import ${pkg}; print(\\"ok\\")"`)
    expect(result).toBe('ok');
  });

  // ── Global npm packages ─────────────────────────────────────────────

  const npmPackages = [
    'docx',
    'pptxgenjs',
    'csv-parse',
    'iconv-lite',
    'xlsx-populate',
  ];

  test.each(npmPackages)('npm package %s is requireable', (pkg) => {
    const result = run(`node -e "require(\\"${pkg}\\"); console.log(\\"ok\\")"`)
    expect(result).toBe('ok');
  });

  // ── Browser automation ──────────────────────────────────────────────

  test('playwright chromium is installed', () => {
    const result = run(
      'node -e "var p = require(\\"playwright\\"); console.log(typeof p.chromium.launch)"',
    );
    expect(result).toBe('function');
  });

  // ── LibreOffice (full runtime target) ───────────────────────────────

  test('libreoffice is installed', () => {
    expect(hasCommand('libreoffice')).toBe(true);
  });
});
