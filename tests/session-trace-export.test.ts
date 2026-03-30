import fs from 'node:fs';

import { expect, test } from 'vitest';

import { setupGatewayTest } from './helpers/gateway-test-setup.js';

const { setupHome } = setupGatewayTest({
  tempHomePrefix: 'hybridclaw-session-trace-export-',
});

test('exports an opentraces/ATIF-compatible JSONL trace from stored session data', async () => {
  setupHome();

  const {
    getSessionById,
    getOrCreateSession,
    getSessionUsageTotals,
    initDatabase,
    recordUsageEvent,
    storeMessage,
    updateSessionModel,
  } = await import('../src/memory/db.ts');
  const { emitToolExecutionAuditEvents, recordAuditEvent } = await import(
    '../src/audit/audit-events.ts'
  );
  const { exportSessionTraceAtifJsonl } = await import(
    '../src/session/session-trace-export.ts'
  );

  initDatabase({ quiet: true });
  const session = getOrCreateSession(
    'session-trace-export',
    null,
    'channel-trace-export',
  );
  updateSessionModel(session.id, 'gpt-5-nano');
  storeMessage(session.id, 'user-1', 'alice', 'user', 'Fix the parser test');
  storeMessage(
    session.id,
    'assistant',
    null,
    'assistant',
    'I updated the parser test and verified the failure path.',
  );

  const runId = 'turn_trace_export_1';
  recordAuditEvent({
    sessionId: session.id,
    runId,
    event: {
      type: 'turn.start',
      turnIndex: 1,
      userInput: 'Fix the parser test',
      username: 'alice',
      source: 'gateway.chat',
    },
  });
  recordAuditEvent({
    sessionId: session.id,
    runId,
    event: {
      type: 'agent.start',
      provider: 'hybridai',
      model: 'gpt-5-nano',
      promptMessages: 3,
      scheduledTaskCount: 0,
    },
  });
  emitToolExecutionAuditEvents({
    sessionId: session.id,
    runId,
    toolExecutions: [
      {
        name: 'bash',
        arguments: '{"command":"npm run test:unit -- parser"}',
        result: 'PASS parser.test.ts',
        durationMs: 3400,
        isError: false,
      },
    ],
  });
  recordAuditEvent({
    sessionId: session.id,
    runId,
    event: {
      type: 'model.usage',
      provider: 'hybridai',
      model: 'gpt-5-nano',
      promptTokens: 120,
      completionTokens: 45,
      totalTokens: 165,
      cacheReadTokens: 60,
      cacheWriteTokens: 15,
    },
  });
  recordAuditEvent({
    sessionId: session.id,
    runId,
    event: {
      type: 'turn.end',
      turnIndex: 1,
      finishReason: 'completed',
    },
  });
  recordAuditEvent({
    sessionId: session.id,
    runId,
    event: {
      type: 'session.end',
      reason: 'normal',
      stats: {
        userMessages: 1,
        assistantMessages: 1,
        toolCalls: 1,
        durationMs: 3800,
      },
    },
  });
  recordUsageEvent({
    sessionId: session.id,
    agentId: session.agent_id,
    model: 'gpt-5-nano',
    inputTokens: 120,
    outputTokens: 45,
    totalTokens: 165,
    toolCalls: 1,
    costUsd: 0.12,
  });
  const refreshedSession = getSessionById(session.id);
  if (!refreshedSession) {
    throw new Error('Expected refreshed session to exist');
  }

  const exported = exportSessionTraceAtifJsonl({
    agentId: refreshedSession.agent_id,
    session: refreshedSession,
    messages: [
      {
        id: 1,
        session_id: session.id,
        user_id: 'user-1',
        username: 'alice',
        role: 'user',
        content: 'Fix the parser test',
        created_at: new Date().toISOString(),
      },
      {
        id: 2,
        session_id: session.id,
        user_id: 'assistant',
        username: null,
        role: 'assistant',
        content: 'I updated the parser test and verified the failure path.',
        created_at: new Date().toISOString(),
      },
    ],
    auditEntries: (
      await import('../src/memory/db.ts')
    ).getStructuredAuditForSession(session.id),
    usageTotals: getSessionUsageTotals(session.id),
  });

  expect(exported).not.toBeNull();
  expect(exported?.lineCount).toBe(1);
  expect(exported?.stepCount).toBe(2);
  expect(exported?.path).toContain('.trace-exports');
  expect(exported && fs.existsSync(exported.path)).toBe(true);

  const raw = fs.readFileSync(exported?.path || '', 'utf-8').trim();
  const record = JSON.parse(raw) as Record<string, any>;
  expect(record.schema_version).toBe('0.1.0');
  expect(record.session_id).toBe(session.id);
  expect(record.agent).toMatchObject({
    name: 'hybridclaw',
    model: 'hybridai/gpt-5-nano',
  });
  expect(record.metadata.compatibility).toMatchObject({
    atif_version: '1.6',
  });
  expect(record.metrics).toMatchObject({
    total_steps: 2,
    total_input_tokens: 120,
    total_output_tokens: 45,
  });
  expect(record.outcome).toMatchObject({
    success: true,
    signal_source: 'deterministic',
  });
  expect(record.content_hash).toMatch(/^[a-f0-9]{64}$/);
  expect(record.steps).toHaveLength(2);
  expect(record.steps[0]).toMatchObject({
    step_index: 0,
    role: 'user',
    content: 'Fix the parser test',
  });
  expect(record.steps[1]).toMatchObject({
    step_index: 1,
    role: 'agent',
    content: 'I updated the parser test and verified the failure path.',
    model: 'hybridai/gpt-5-nano',
    call_type: 'main',
    agent_role: 'main',
    token_usage: {
      input_tokens: 120,
      output_tokens: 45,
      cache_read_tokens: 60,
      cache_write_tokens: 15,
    },
  });
  expect(record.steps[1].tool_calls).toEqual([
    {
      tool_call_id: `${runId}:tool:1`,
      tool_name: 'bash',
      input: { command: 'npm run test:unit -- parser' },
      duration_ms: 3400,
    },
  ]);
  expect(record.steps[1].observations).toEqual([
    {
      source_call_id: `${runId}:tool:1`,
      content: 'PASS parser.test.ts',
      output_summary: 'PASS parser.test.ts',
      error: null,
    },
  ]);
});

test('gateway export trace command writes the ATIF-compatible trace file', async () => {
  setupHome();

  const {
    getOrCreateSession,
    getSessionUsageTotals,
    getStructuredAuditForSession,
    initDatabase,
    recordUsageEvent,
    storeMessage,
  } = await import('../src/memory/db.ts');
  const { recordAuditEvent } = await import('../src/audit/audit-events.ts');

  initDatabase({ quiet: true });
  const session = getOrCreateSession(
    'session-trace-command',
    null,
    'channel-trace-command',
  );
  storeMessage(session.id, 'user-1', 'alice', 'user', 'Show a trace export');
  storeMessage(
    session.id,
    'assistant',
    null,
    'assistant',
    'Here is the exported trace.',
  );
  recordAuditEvent({
    sessionId: session.id,
    runId: 'turn_trace_command_1',
    event: {
      type: 'turn.start',
      turnIndex: 1,
      userInput: 'Show a trace export',
      source: 'gateway.chat',
    },
  });
  recordAuditEvent({
    sessionId: session.id,
    runId: 'turn_trace_command_1',
    event: {
      type: 'turn.end',
      turnIndex: 1,
      finishReason: 'completed',
    },
  });
  recordUsageEvent({
    sessionId: session.id,
    agentId: session.agent_id,
    model: 'gpt-5-nano',
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
    toolCalls: 0,
  });

  const { handleGatewayCommand } = await import(
    '../src/gateway/gateway-service.ts'
  );
  const result = await handleGatewayCommand({
    sessionId: session.id,
    guildId: null,
    channelId: session.channel_id,
    args: ['export', 'trace'],
  });

  expect(result.kind).toBe('info');
  if (result.kind !== 'info') {
    throw new Error(`Unexpected result kind: ${result.kind}`);
  }
  expect(result.title).toBe('Trace Exported');
  expect(result.text).toContain('Steps: 2');
  const fileLine = result.text
    .split('\n')
    .find((line) => line.startsWith('File: '));
  expect(fileLine).toBeTruthy();
  const exportPath = fileLine?.slice('File: '.length) || '';
  expect(fs.existsSync(exportPath)).toBe(true);
  const raw = fs.readFileSync(exportPath, 'utf-8').trim();
  const record = JSON.parse(raw) as Record<string, unknown>;
  expect(record).toMatchObject({
    schema_version: '0.1.0',
    session_id: session.id,
  });

  expect(getStructuredAuditForSession(session.id)).toHaveLength(2);
  expect(getSessionUsageTotals(session.id).total_tokens).toBe(15);
});

test('gateway export trace all writes per-session ATIF-compatible trace files', async () => {
  setupHome();

  const { getOrCreateSession, initDatabase, recordUsageEvent, storeMessage } =
    await import('../src/memory/db.ts');
  const { recordAuditEvent } = await import('../src/audit/audit-events.ts');

  initDatabase({ quiet: true });

  const sessions = [
    getOrCreateSession('session-trace-all-1', null, 'channel-trace-all-1'),
    getOrCreateSession('session-trace-all-2', null, 'channel-trace-all-2'),
  ];

  for (const [index, session] of sessions.entries()) {
    storeMessage(
      session.id,
      'user-1',
      'alice',
      'user',
      `Export trace ${index + 1}`,
    );
    storeMessage(
      session.id,
      'assistant',
      null,
      'assistant',
      `Trace ${index + 1} exported`,
    );
    recordAuditEvent({
      sessionId: session.id,
      runId: `turn_trace_all_${index + 1}`,
      event: {
        type: 'turn.start',
        turnIndex: 1,
        userInput: `Export trace ${index + 1}`,
        source: 'gateway.chat',
      },
    });
    recordAuditEvent({
      sessionId: session.id,
      runId: `turn_trace_all_${index + 1}`,
      event: {
        type: 'turn.end',
        turnIndex: 1,
        finishReason: 'completed',
      },
    });
    recordUsageEvent({
      sessionId: session.id,
      agentId: session.agent_id,
      model: 'gpt-5-nano',
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      toolCalls: 0,
    });
  }

  const { handleGatewayCommand } = await import(
    '../src/gateway/gateway-service.ts'
  );
  const result = await handleGatewayCommand({
    sessionId: sessions[0].id,
    guildId: null,
    channelId: sessions[0].channel_id,
    args: ['export', 'trace', 'all'],
  });

  expect(result.kind).toBe('info');
  if (result.kind !== 'info') {
    throw new Error(`Unexpected result kind: ${result.kind}`);
  }
  expect(result.title).toBe('Trace Exports Created');
  expect(result.text).toContain('Sessions exported: 2/2');
  expect(result.text).toContain('Total steps: 4');
  const fileLines = result.text
    .split('\n')
    .filter((line) => line.startsWith('- '));
  expect(fileLines).toHaveLength(2);
  for (const line of fileLines) {
    const filePath = line.slice(2);
    expect(fs.existsSync(filePath)).toBe(true);
    const raw = fs.readFileSync(filePath, 'utf-8').trim();
    const record = JSON.parse(raw) as Record<string, unknown>;
    expect(record.schema_version).toBe('0.1.0');
  }
});

test('trace export redacts secrets and anonymizes absolute-path usernames', async () => {
  setupHome();

  const { getOrCreateSession, getSessionById, initDatabase, storeMessage } =
    await import('../src/memory/db.ts');
  const { emitToolExecutionAuditEvents, recordAuditEvent } = await import(
    '../src/audit/audit-events.ts'
  );
  const { exportSessionTraceAtifJsonl } = await import(
    '../src/session/session-trace-export.ts'
  );

  initDatabase({ quiet: true });
  const session = getOrCreateSession(
    'session-trace-redaction',
    null,
    'channel-trace-redaction',
  );
  storeMessage(
    session.id,
    'user-1',
    'alice',
    'user',
    'Inspect /Users/alice/work/project/.env and token ghs_abcdefghijklmnopqrstuvwxyz1234567890',
  );
  storeMessage(
    session.id,
    'assistant',
    null,
    'assistant',
    'I checked /home/alice/.config/app and found JWT eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYWRtaW4iLCJzY29wZSI6ImRldiJ9.signaturevalue123',
  );

  const runId = 'turn_trace_redaction_1';
  recordAuditEvent({
    sessionId: session.id,
    runId,
    event: {
      type: 'turn.start',
      turnIndex: 1,
      userInput:
        'Inspect /Users/alice/work/project/.env and token ghs_abcdefghijklmnopqrstuvwxyz1234567890',
      username: 'alice',
      source: 'gateway.chat',
    },
  });
  recordAuditEvent({
    sessionId: session.id,
    runId,
    event: {
      type: 'agent.start',
      provider: 'hybridai',
      model: 'gpt-5-nano',
      promptMessages: 3,
      scheduledTaskCount: 0,
    },
  });
  emitToolExecutionAuditEvents({
    sessionId: session.id,
    runId,
    toolExecutions: [
      {
        name: 'bash',
        arguments:
          '{"command":"cat /Users/alice/work/project/.env && echo gho_abcdefghijklmnopqrstuvwxyz1234567890"}',
        result:
          'Webhook https://discord.com/api/webhooks/123456/abcdefghijklmnopqrstuvwxyz and token pypi-abcdefghijklmnopqrstuvwxyz123456',
        durationMs: 250,
        isError: false,
      },
    ],
  });
  recordAuditEvent({
    sessionId: session.id,
    runId,
    event: {
      type: 'turn.end',
      turnIndex: 1,
      finishReason: 'completed',
    },
  });

  const refreshedSession = getSessionById(session.id);
  if (!refreshedSession) {
    throw new Error('Expected refreshed session to exist');
  }

  const exported = exportSessionTraceAtifJsonl({
    agentId: refreshedSession.agent_id,
    session: refreshedSession,
    messages: [
      {
        id: 1,
        session_id: session.id,
        user_id: 'user-1',
        username: 'alice',
        role: 'user',
        content:
          'Inspect /Users/alice/work/project/.env and token ghs_abcdefghijklmnopqrstuvwxyz1234567890',
        created_at: new Date().toISOString(),
      },
      {
        id: 2,
        session_id: session.id,
        user_id: 'assistant',
        username: null,
        role: 'assistant',
        content:
          'I checked /home/alice/.config/app and found JWT eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYWRtaW4iLCJzY29wZSI6ImRldiJ9.signaturevalue123',
        created_at: new Date().toISOString(),
      },
    ],
    auditEntries: (
      await import('../src/memory/db.ts')
    ).getStructuredAuditForSession(session.id),
    usageTotals: {
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_tokens: 0,
      total_tool_calls: 1,
      total_cost_usd: 0,
      call_count: 0,
    },
  });

  expect(exported).not.toBeNull();
  const raw = fs.readFileSync(exported?.path || '', 'utf-8').trim();
  const record = JSON.parse(raw) as Record<string, any>;

  expect(raw).not.toContain('/Users/alice/');
  expect(raw).not.toContain('/home/alice/');
  expect(raw).toContain('/Users/user_');
  expect(raw).toContain('/home/user_');
  expect(raw).not.toContain('ghs_abcdefghijklmnopqrstuvwxyz1234567890');
  expect(raw).not.toContain('gho_abcdefghijklmnopqrstuvwxyz1234567890');
  expect(raw).not.toContain(
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYWRtaW4iLCJzY29wZSI6ImRldiJ9.signaturevalue123',
  );
  expect(raw).not.toContain(
    'https://discord.com/api/webhooks/123456/abcdefghijklmnopqrstuvwxyz',
  );
  expect(raw).not.toContain('pypi-abcdefghijklmnopqrstuvwxyz123456');

  expect(record.steps[0].content).toContain('/Users/user_');
  expect(record.steps[0].content).toContain('***GITHUB_TOKEN_REDACTED***');
  expect(record.steps[1].content).toContain('/home/user_');
  expect(record.steps[1].content).toContain('***JWT_REDACTED***');
  expect(record.steps[1].tool_calls[0].input.command).toContain('/Users/user_');
  expect(record.steps[1].tool_calls[0].input.command).toContain(
    '***GITHUB_TOKEN_REDACTED***',
  );
  expect(record.steps[1].observations[0].content).toContain(
    '***DISCORD_WEBHOOK_REDACTED***',
  );
  expect(record.steps[1].observations[0].content).toContain(
    '***PYPI_TOKEN_REDACTED***',
  );
});
