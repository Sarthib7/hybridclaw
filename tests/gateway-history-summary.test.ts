import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, test, vi } from 'vitest';

const ORIGINAL_HOME = process.env.HOME;
const tempDirs: string[] = [];

function makeTempHome(): string {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'hybridclaw-gateway-history-'),
  );
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  if (ORIGINAL_HOME === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = ORIGINAL_HOME;
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('getGatewayHistorySummary reports persisted message and tool counts', async () => {
  process.env.HOME = makeTempHome();
  vi.resetModules();

  const { initDatabase, recordUsageEvent } = await import(
    '../src/memory/db.ts'
  );
  const { memoryService } = await import('../src/memory/memory-service.ts');
  const { getGatewayHistorySummary } = await import(
    '../src/gateway/gateway-service.ts'
  );

  initDatabase({ quiet: true });

  const session = memoryService.getOrCreateSession(
    'cli-session-1',
    null,
    'tui',
  );
  memoryService.storeTurn({
    sessionId: session.id,
    user: {
      userId: 'user-1',
      username: 'user',
      content: 'hello',
    },
    assistant: {
      content: 'world',
    },
  });
  recordUsageEvent({
    sessionId: session.id,
    agentId: session.agent_id,
    model: 'gpt-5',
    inputTokens: 1,
    outputTokens: 1,
    toolCalls: 2,
  });

  expect(getGatewayHistorySummary(session.id)).toEqual({
    messageCount: 2,
    userMessageCount: 1,
    toolCallCount: 2,
  });
});

test('getGatewayHistorySummary returns zero counts for unknown sessions', async () => {
  process.env.HOME = makeTempHome();
  vi.resetModules();

  const { initDatabase } = await import('../src/memory/db.ts');
  const { getGatewayHistorySummary } = await import(
    '../src/gateway/gateway-service.ts'
  );

  initDatabase({ quiet: true });

  expect(getGatewayHistorySummary('missing-session')).toEqual({
    messageCount: 0,
    userMessageCount: 0,
    toolCallCount: 0,
  });
});
