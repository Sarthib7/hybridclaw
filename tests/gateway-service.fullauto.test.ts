import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, test, vi } from 'vitest';

const { runAgentMock } = vi.hoisted(() => ({
  runAgentMock: vi.fn(),
}));

vi.mock('../src/agent/agent.js', () => ({
  runAgent: runAgentMock,
}));

const ORIGINAL_HOME = process.env.HOME;
const tempDirs: string[] = [];

function makeTempHome(): string {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'hybridclaw-gateway-fullauto-'),
  );
  tempDirs.push(dir);
  return dir;
}

function restoreEnvVar(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

afterEach(() => {
  runAgentMock.mockReset();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetModules();
  restoreEnvVar('HOME', ORIGINAL_HOME);
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('fullauto command enables auto-turns, queues follow-up results, and can be disabled', async () => {
  vi.useFakeTimers();
  const homeDir = makeTempHome();
  process.env.HOME = homeDir;
  vi.resetModules();

  runAgentMock
    .mockResolvedValueOnce({
      status: 'success',
      result: 'first background result',
      toolsUsed: [],
      toolExecutions: [],
    })
    .mockResolvedValueOnce({
      status: 'success',
      result: 'second background result',
      toolsUsed: [],
      toolExecutions: [],
    });

  const { initDatabase, listQueuedProactiveMessages, updateSessionChatbot } =
    await import('../src/memory/db.ts');
  const { memoryService } = await import('../src/memory/memory-service.ts');
  const { handleGatewayCommand } = await import(
    '../src/gateway/gateway-service.ts'
  );

  initDatabase({ quiet: true });

  const sessionId = 'session-fullauto';
  memoryService.getOrCreateSession(sessionId, null, 'tui');
  updateSessionChatbot(sessionId, 'bot-1');

  const enabled = await handleGatewayCommand({
    sessionId,
    guildId: null,
    channelId: 'tui',
    userId: 'tui-user',
    username: 'user',
    args: ['fullauto', 'Write', 'tests', 'for', 'untested', 'functions'],
  });

  expect(enabled.kind).toBe('info');
  if (enabled.kind !== 'info') {
    throw new Error(`Unexpected result kind: ${enabled.kind}`);
  }
  expect(enabled.title).toBe('Full-Auto Enabled');
  expect(enabled.text).toContain('run indefinitely');

  await vi.advanceTimersByTimeAsync(3_000);
  expect(runAgentMock).toHaveBeenCalledTimes(1);
  const firstMessages = runAgentMock.mock.calls[0]?.[1] as
    | Array<{ role: string; content: string }>
    | undefined;
  expect(firstMessages?.at(-1)?.content).toBe(
    'Write tests for untested functions',
  );

  await vi.advanceTimersByTimeAsync(3_000);
  expect(runAgentMock).toHaveBeenCalledTimes(2);

  const status = await handleGatewayCommand({
    sessionId,
    guildId: null,
    channelId: 'tui',
    userId: 'tui-user',
    username: 'user',
    args: ['fullauto', 'status'],
  });

  expect(status.kind).toBe('info');
  if (status.kind !== 'info') {
    throw new Error(`Unexpected result kind: ${status.kind}`);
  }
  expect(status.text).toContain('Enabled: yes');
  expect(status.text).toContain('Turns: 2/1000');

  const queued = listQueuedProactiveMessages(10);
  expect(queued.map((entry) => entry.text)).toEqual([
    'first background result',
    'second background result',
  ]);

  const disabled = await handleGatewayCommand({
    sessionId,
    guildId: null,
    channelId: 'tui',
    userId: 'tui-user',
    username: 'user',
    args: ['fullauto', 'off'],
  });

  expect(disabled.kind).toBe('plain');
  expect(disabled.text).toContain('Full-auto mode disabled');

  const session = memoryService.getSessionById(sessionId);
  expect(session?.full_auto_enabled).toBe(0);
});
