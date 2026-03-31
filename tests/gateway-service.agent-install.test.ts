import { expect, test, vi } from 'vitest';
import { setupGatewayTest } from './helpers/gateway-test-setup.js';

const {
  ensurePluginManagerInitializedMock,
  reloadPluginManagerMock,
  setPluginInboundMessageDispatcherMock,
  resolveInstallArchiveSourceMock,
  unpackAgentMock,
} = vi.hoisted(() => ({
  ensurePluginManagerInitializedMock: vi.fn(async () => null),
  reloadPluginManagerMock: vi.fn(async () => null),
  setPluginInboundMessageDispatcherMock: vi.fn(),
  resolveInstallArchiveSourceMock: vi.fn(),
  unpackAgentMock: vi.fn(),
}));

vi.mock('../src/plugins/plugin-manager.js', () => ({
  ensurePluginManagerInitialized: ensurePluginManagerInitializedMock,
  reloadPluginManager: reloadPluginManagerMock,
  setPluginInboundMessageDispatcher: setPluginInboundMessageDispatcherMock,
  shutdownPluginManager: vi.fn(async () => {}),
  listLoadedPluginCommands: vi.fn(() => []),
}));

vi.mock('../src/agents/agent-install-source.js', () => ({
  resolveInstallArchiveSource: resolveInstallArchiveSourceMock,
}));

vi.mock('../src/agents/claw-archive.js', () => ({
  unpackAgent: unpackAgentMock,
}));

const { setupHome } = setupGatewayTest({
  tempHomePrefix: 'hybridclaw-gateway-agent-install-',
  cleanup: () => {
    ensurePluginManagerInitializedMock.mockClear();
    reloadPluginManagerMock.mockClear();
    setPluginInboundMessageDispatcherMock.mockClear();
    resolveInstallArchiveSourceMock.mockClear();
    unpackAgentMock.mockClear();
  },
});

test('handleGatewayCommand installs an agent from a local TUI/web session', async () => {
  setupHome();

  const cleanupMock = vi.fn();
  resolveInstallArchiveSourceMock.mockResolvedValue({
    archivePath: '/tmp/charly.claw',
    cleanup: cleanupMock,
  });
  unpackAgentMock.mockResolvedValue({
    archivePath: '/tmp/charly.claw',
    manifest: { id: 'charly' },
    agentId: 'research',
    workspacePath: '/tmp/.hybridclaw/agents/research/workspace',
    bundledSkills: ['office'],
    importedSkills: [{ guardSkipped: true }],
    installedPlugins: [{ pluginId: 'demo-plugin' }],
    externalActions: [],
    runtimeConfigChanged: true,
  });

  const { initDatabase } = await import('../src/memory/db.ts');
  const { handleGatewayCommand } = await import(
    '../src/gateway/gateway-service.ts'
  );

  initDatabase({ quiet: true });

  const result = await handleGatewayCommand({
    sessionId: 'session-agent-install',
    guildId: null,
    channelId: 'tui',
    args: [
      'agent',
      'install',
      'official:charly',
      '--id',
      'research',
      '--force',
      '--skip-skill-scan',
      '--yes',
    ],
  });

  expect(resolveInstallArchiveSourceMock).toHaveBeenCalledWith(
    'official:charly',
  );
  expect(unpackAgentMock).toHaveBeenCalledWith(
    '/tmp/charly.claw',
    expect.objectContaining({
      agentId: 'research',
      force: true,
      skipSkillScan: true,
      skipExternals: false,
      yes: true,
    }),
  );
  expect(cleanupMock).toHaveBeenCalled();
  expect(reloadPluginManagerMock).toHaveBeenCalled();
  expect(result.kind).toBe('info');
  if (result.kind !== 'info') {
    throw new Error(`Unexpected result kind: ${result.kind}`);
  }
  expect(result.title).toBe('Agent Installed');
  expect(result.text).toContain(
    'Installed agent `research` to `/tmp/.hybridclaw/agents/research/workspace`.',
  );
  expect(result.text).toContain('Bundled skills restored: 1');
  expect(result.text).toContain('Skill imports installed: 1');
  expect(result.text).toContain(
    'Skill scanner skipped for 1 imported skill because --skip-skill-scan was set.',
  );
  expect(result.text).toContain('Bundled plugins installed: 1');
  expect(result.text).toContain('Updated runtime config at');
  expect(result.text).toContain('Plugin runtime reloaded.');
});

test('handleGatewayCommand rejects agent install outside local TUI/web sessions', async () => {
  setupHome();

  const { initDatabase } = await import('../src/memory/db.ts');
  const { handleGatewayCommand } = await import(
    '../src/gateway/gateway-service.ts'
  );

  initDatabase({ quiet: true });

  const result = await handleGatewayCommand({
    sessionId: 'session-agent-install-remote',
    guildId: 'guild-1',
    channelId: 'discord-channel-1',
    args: ['agent', 'install', 'official:charly'],
  });

  expect(resolveInstallArchiveSourceMock).not.toHaveBeenCalled();
  expect(unpackAgentMock).not.toHaveBeenCalled();
  expect(result.kind).toBe('error');
  if (result.kind !== 'error') {
    throw new Error(`Unexpected result kind: ${result.kind}`);
  }
  expect(result.title).toBe('Agent Install Restricted');
  expect(result.text).toContain('only available from local TUI/web sessions');
});

test('handleGatewayCommand cleans up downloaded archives when agent install fails', async () => {
  setupHome();

  const cleanupMock = vi.fn();
  resolveInstallArchiveSourceMock.mockResolvedValue({
    archivePath: '/tmp/missing.claw',
    cleanup: cleanupMock,
  });
  unpackAgentMock.mockRejectedValueOnce(new Error('archive failed validation'));

  const { initDatabase } = await import('../src/memory/db.ts');
  const { handleGatewayCommand } = await import(
    '../src/gateway/gateway-service.ts'
  );

  initDatabase({ quiet: true });

  const result = await handleGatewayCommand({
    sessionId: 'session-agent-install-failed',
    guildId: null,
    channelId: 'web',
    args: ['agent', 'install', 'official:missing'],
  });

  expect(cleanupMock).toHaveBeenCalled();
  expect(result.kind).toBe('error');
  if (result.kind !== 'error') {
    throw new Error(`Unexpected result kind: ${result.kind}`);
  }
  expect(result.title).toBe('Agent Install Failed');
  expect(result.text).toBe('archive failed validation');
});
