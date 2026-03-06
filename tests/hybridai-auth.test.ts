import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_HYBRIDAI_API_KEY = process.env.HYBRIDAI_API_KEY;
const ORIGINAL_SSH_CONNECTION = process.env.SSH_CONNECTION;
const ORIGINAL_SSH_CLIENT = process.env.SSH_CLIENT;
const ORIGINAL_SSH_TTY = process.env.SSH_TTY;
const ORIGINAL_CI = process.env.CI;
const ORIGINAL_CONTAINER = process.env.CONTAINER;
const ORIGINAL_DOCKER_CONTAINER = process.env.DOCKER_CONTAINER;
const ORIGINAL_KUBERNETES_SERVICE_HOST = process.env.KUBERNETES_SERVICE_HOST;
const ORIGINAL_DISPLAY = process.env.DISPLAY;
const ORIGINAL_WAYLAND_DISPLAY = process.env.WAYLAND_DISPLAY;
const ORIGINAL_CWD = process.cwd();
const ORIGINAL_STDIN_IS_TTY = process.stdin.isTTY;
const ORIGINAL_STDOUT_IS_TTY = process.stdout.isTTY;

function makeTempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hybridclaw-hybridai-auth-'));
}

function restoreEnvVar(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

async function importFreshHybridAIAuth(
  homeDir: string,
  options?: {
    readlineAnswers?: string[];
    spawnMock?: ReturnType<typeof vi.fn>;
  },
) {
  process.env.HOME = homeDir;
  process.chdir(homeDir);
  vi.resetModules();

  if (options?.readlineAnswers) {
    const answers = [...options.readlineAnswers];
    vi.doMock('node:readline/promises', () => ({
      default: {
        createInterface: () => ({
          question: vi.fn(async () => answers.shift() || ''),
          close: vi.fn(),
        }),
      },
    }));
  }

  if (options?.spawnMock) {
    vi.doMock('node:child_process', () => ({
      spawn: options.spawnMock,
    }));
  }

  return import('../src/auth/hybridai-auth.ts');
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.doUnmock('node:child_process');
  vi.doUnmock('node:readline/promises');
  vi.resetModules();
  restoreEnvVar('HOME', ORIGINAL_HOME);
  restoreEnvVar('HYBRIDAI_API_KEY', ORIGINAL_HYBRIDAI_API_KEY);
  restoreEnvVar('SSH_CONNECTION', ORIGINAL_SSH_CONNECTION);
  restoreEnvVar('SSH_CLIENT', ORIGINAL_SSH_CLIENT);
  restoreEnvVar('SSH_TTY', ORIGINAL_SSH_TTY);
  restoreEnvVar('CI', ORIGINAL_CI);
  restoreEnvVar('CONTAINER', ORIGINAL_CONTAINER);
  restoreEnvVar('DOCKER_CONTAINER', ORIGINAL_DOCKER_CONTAINER);
  restoreEnvVar('KUBERNETES_SERVICE_HOST', ORIGINAL_KUBERNETES_SERVICE_HOST);
  restoreEnvVar('DISPLAY', ORIGINAL_DISPLAY);
  restoreEnvVar('WAYLAND_DISPLAY', ORIGINAL_WAYLAND_DISPLAY);
  process.chdir(ORIGINAL_CWD);
  Object.defineProperty(process.stdin, 'isTTY', {
    value: ORIGINAL_STDIN_IS_TTY,
    configurable: true,
  });
  Object.defineProperty(process.stdout, 'isTTY', {
    value: ORIGINAL_STDOUT_IS_TTY,
    configurable: true,
  });
});

describe('HybridAI auth status', () => {
  it('resolves the API key from runtime secrets', async () => {
    const homeDir = makeTempHome();
    process.env.HOME = homeDir;
    process.chdir(homeDir);
    delete process.env.HYBRIDAI_API_KEY;
    vi.resetModules();

    const runtimeSecrets = await import('../src/security/runtime-secrets.ts');
    runtimeSecrets.saveRuntimeSecrets(
      { HYBRIDAI_API_KEY: 'hai-1234567890abcdef' },
      homeDir,
    );

    const hybridAIAuth = await importFreshHybridAIAuth(homeDir);
    expect(hybridAIAuth.getHybridAIApiKey()).toBe('hai-1234567890abcdef');
    expect(hybridAIAuth.getHybridAIAuthStatus(homeDir)).toEqual({
      authenticated: true,
      path: path.join(homeDir, '.hybridclaw', 'credentials.json'),
      maskedApiKey: 'hai-…cdef',
      source: 'runtime-secrets',
    });
  });

  it('reports shell-exported API keys as env sourced', async () => {
    const homeDir = makeTempHome();
    process.env.HOME = homeDir;
    process.env.HYBRIDAI_API_KEY = 'hai-fedcba0987654321';

    const hybridAIAuth = await importFreshHybridAIAuth(homeDir);
    expect(hybridAIAuth.getHybridAIAuthStatus(homeDir)).toEqual({
      authenticated: true,
      path: path.join(homeDir, '.hybridclaw', 'credentials.json'),
      maskedApiKey: 'hai-…4321',
      source: 'env',
    });
  });
});

describe('HybridAI auth credential management', () => {
  it('imports the current shell key into runtime secrets', async () => {
    const homeDir = makeTempHome();
    process.env.HOME = homeDir;
    process.env.HYBRIDAI_API_KEY = 'hai-import1234567890';

    const hybridAIAuth = await importFreshHybridAIAuth(homeDir);
    const result = hybridAIAuth.importHybridAIEnvCredentials(homeDir);

    expect(result).toMatchObject({
      method: 'env-import',
      maskedApiKey: 'hai-…7890',
      path: path.join(homeDir, '.hybridclaw', 'credentials.json'),
      validated: false,
    });
    expect(
      JSON.parse(fs.readFileSync(result.path, 'utf-8')) as {
        HYBRIDAI_API_KEY?: string;
      },
    ).toEqual({
      HYBRIDAI_API_KEY: 'hai-import1234567890',
    });
  });

  it('clears stored HybridAI credentials', async () => {
    const homeDir = makeTempHome();
    process.env.HOME = homeDir;
    delete process.env.HYBRIDAI_API_KEY;
    process.chdir(homeDir);
    vi.resetModules();

    const runtimeSecrets = await import('../src/security/runtime-secrets.ts');
    runtimeSecrets.saveRuntimeSecrets(
      { HYBRIDAI_API_KEY: 'hai-clear1234567890' },
      homeDir,
    );

    const hybridAIAuth = await importFreshHybridAIAuth(homeDir);
    const filePath = hybridAIAuth.clearHybridAICredentials(homeDir);

    expect(filePath).toBe(
      path.join(homeDir, '.hybridclaw', 'credentials.json'),
    );
    expect(fs.existsSync(filePath)).toBe(false);
    expect(hybridAIAuth.getHybridAIAuthStatus(homeDir)).toEqual({
      authenticated: false,
      path: filePath,
      maskedApiKey: null,
      source: null,
    });
  });
});

describe('HybridAI login helpers', () => {
  it('prefers headless login in SSH-like environments', async () => {
    const homeDir = makeTempHome();
    process.env.HOME = homeDir;
    process.env.SSH_CONNECTION = 'host 1 2';

    const hybridAIAuth = await importFreshHybridAIAuth(homeDir);
    expect(hybridAIAuth.selectDefaultHybridAILoginMethod()).toBe('device-code');
  });

  it('prefers browser login when a local interactive environment is available', async () => {
    const homeDir = makeTempHome();
    process.env.HOME = homeDir;
    delete process.env.SSH_CONNECTION;
    delete process.env.SSH_CLIENT;
    delete process.env.SSH_TTY;
    delete process.env.CI;
    delete process.env.CONTAINER;
    delete process.env.DOCKER_CONTAINER;
    delete process.env.KUBERNETES_SERVICE_HOST;
    if (process.platform === 'linux') {
      process.env.DISPLAY = ':0';
      delete process.env.WAYLAND_DISPLAY;
    }

    const hybridAIAuth = await importFreshHybridAIAuth(homeDir);
    expect(hybridAIAuth.selectDefaultHybridAILoginMethod()).toBe('browser');
  });

  it('stores a validated API key through the headless login flow', async () => {
    const homeDir = makeTempHome();
    process.env.HOME = homeDir;
    delete process.env.HYBRIDAI_API_KEY;
    Object.defineProperty(process.stdin, 'isTTY', {
      value: true,
      configurable: true,
    });
    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      configurable: true,
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );

    const hybridAIAuth = await importFreshHybridAIAuth(homeDir, {
      readlineAnswers: ['hai-login1234567890'],
    });
    const result = await hybridAIAuth.loginHybridAIInteractive({
      method: 'device-code',
      homeDir,
    });

    expect(result).toMatchObject({
      method: 'device-code',
      maskedApiKey: 'hai-…7890',
      path: path.join(homeDir, '.hybridclaw', 'credentials.json'),
      validated: true,
    });
    expect(hybridAIAuth.getHybridAIAuthStatus(homeDir)).toEqual({
      authenticated: true,
      path: result.path,
      maskedApiKey: 'hai-…7890',
      source: 'runtime-secrets',
    });
  });
});
