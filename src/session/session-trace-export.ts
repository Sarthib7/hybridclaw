import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseJsonObject, truncateAuditText } from '../audit/audit-trail.js';
import { APP_VERSION } from '../config/config.js';
import { agentWorkspaceDir, ensureAgentDirs } from '../infra/ipc.js';
import { logger } from '../logger.js';
import { formatModelForDisplay } from '../providers/model-names.js';
import { redactSecrets } from '../security/redact.js';
import type { StructuredAuditEntry } from '../types/audit.js';
import type { Session, StoredMessage } from '../types/session.js';
import type { UsageTotals } from '../types/usage.js';

const TRACE_EXPORTS_DIR_NAME = '.trace-exports';
const OPENTRACES_SCHEMA_VERSION = '0.1.0';
const ATIF_COMPAT_VERSION = '1.6';
const TRACE_USERNAME_HASH_LENGTH = 8;

const TRACE_EXPORT_EXTRA_REDACTION_PATTERNS: ReadonlyArray<{
  match: RegExp;
  replace: string;
}> = Object.freeze([
  {
    match: /\b(gh[ousr]_[A-Za-z0-9_]{20,})\b/g,
    replace: '***GITHUB_TOKEN_REDACTED***',
  },
  {
    match: /\b(pypi-[A-Za-z0-9_-]{20,})\b/g,
    replace: '***PYPI_TOKEN_REDACTED***',
  },
  {
    match: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9._-]{8,}\.[A-Za-z0-9._-]{8,}\b/g,
    replace: '***JWT_REDACTED***',
  },
  {
    match: /\bhttps:\/\/discord(?:app)?\.com\/api\/webhooks\/[^\s"'`]+/gi,
    replace: '***DISCORD_WEBHOOK_REDACTED***',
  },
]);

interface TurnGroup {
  runId: string;
  rows: StructuredAuditEntry[];
  turnStart: StructuredAuditEntry;
}

function safeFilePart(raw: string): string {
  const normalized = raw.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  return normalized || 'session';
}

function exportBaseDir(agentId: string, sessionId: string): string {
  ensureAgentDirs(agentId);
  return path.join(
    agentWorkspaceDir(agentId),
    TRACE_EXPORTS_DIR_NAME,
    safeFilePart(sessionId),
  );
}

function exportFilePath(baseDir: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(baseDir, `${stamp}-atif-v1_6.jsonl`);
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'null';
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'bigint') return JSON.stringify(String(value));
  if (
    typeof value === 'undefined' ||
    typeof value === 'function' ||
    typeof value === 'symbol'
  ) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }

  const objectValue = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(objectValue).sort((left, right) =>
    left.localeCompare(right),
  )) {
    const nextValue = objectValue[key];
    if (
      typeof nextValue === 'undefined' ||
      typeof nextValue === 'function' ||
      typeof nextValue === 'symbol'
    ) {
      continue;
    }
    parts.push(`${JSON.stringify(key)}:${stableStringify(nextValue)}`);
  }
  return `{${parts.join(',')}}`;
}

function deterministicUuid(seed: string): string {
  const hex = sha256Hex(seed).slice(0, 32);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

function anonymizedPathUsername(username: string): string {
  return `user_${sha256Hex(username.trim().toLowerCase()).slice(0, TRACE_USERNAME_HASH_LENGTH)}`;
}

function anonymizeTracePaths(text: string): string {
  return text
    .replace(
      /(\/Users\/)([^/\s]+)/g,
      (_match, prefix: string, username: string) =>
        `${prefix}${anonymizedPathUsername(username)}`,
    )
    .replace(
      /(\/home\/)([^/\s]+)/g,
      (_match, prefix: string, username: string) =>
        `${prefix}${anonymizedPathUsername(username)}`,
    )
    .replace(
      /(\/mnt\/[A-Za-z]\/Users\/)([^/\s]+)/g,
      (_match, prefix: string, username: string) =>
        `${prefix}${anonymizedPathUsername(username)}`,
    )
    .replace(
      /(\\Users\\)([^\\\s]+)/g,
      (_match, prefix: string, username: string) =>
        `${prefix}${anonymizedPathUsername(username)}`,
    )
    .replace(
      /(\/Users\/)([^/\s]+)(?=\\)/g,
      (_match, prefix: string, username: string) =>
        `${prefix}${anonymizedPathUsername(username)}`,
    );
}

function redactTraceText(text: string): string {
  let next = anonymizeTracePaths(text);
  next = redactSecrets(next);
  for (const pattern of TRACE_EXPORT_EXTRA_REDACTION_PATTERNS) {
    next = next.replace(pattern.match, pattern.replace);
  }
  return next;
}

function sanitizeTraceExportValue(value: unknown): unknown {
  if (typeof value === 'string') return redactTraceText(value);
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeTraceExportValue(entry));
  }
  if (!value || typeof value !== 'object') return value;

  const sanitized: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    sanitized[key] = sanitizeTraceExportValue(raw);
  }
  return sanitized;
}

function finalizeTraceRecord(
  record: Record<string, unknown>,
): Record<string, unknown> {
  const sanitizedRecord = sanitizeTraceExportValue(record) as Record<
    string,
    unknown
  >;
  const serializedRecord = JSON.stringify(sanitizedRecord);
  const finalSerializedRecord = redactTraceText(serializedRecord);
  const parsedRecord = JSON.parse(finalSerializedRecord);
  return parsedRecord as Record<string, unknown>;
}

function readString(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  const value = payload[key];
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function readNumber(
  payload: Record<string, unknown>,
  key: string,
): number | null {
  const value = payload[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return null;
}

function readBoolean(
  payload: Record<string, unknown>,
  key: string,
): boolean | null {
  const value = payload[key];
  return typeof value === 'boolean' ? value : null;
}

function compactText(text: string, maxChars = 12_000): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars)}...`;
}

function groupTurnRows(rows: StructuredAuditEntry[]): TurnGroup[] {
  const grouped = new Map<string, StructuredAuditEntry[]>();
  for (const row of rows) {
    const bucket = grouped.get(row.run_id);
    if (bucket) {
      bucket.push(row);
      continue;
    }
    grouped.set(row.run_id, [row]);
  }

  const turns: TurnGroup[] = [];
  for (const [runId, runRows] of grouped) {
    const turnStart = runRows.find((row) => row.event_type === 'turn.start');
    if (!turnStart) continue;
    turns.push({ runId, rows: runRows, turnStart });
  }

  return turns.sort((left, right) => left.turnStart.seq - right.turnStart.seq);
}

function buildFallbackSteps(
  messages: StoredMessage[],
): Array<Record<string, unknown>> {
  return messages.map((message, index) => ({
    step_index: index,
    role: message.role === 'assistant' ? 'agent' : message.role,
    content: message.content,
    timestamp: message.created_at,
  }));
}

function buildStepTokenUsage(
  payload: Record<string, unknown> | null,
): Record<string, number> | undefined {
  if (!payload) return undefined;
  const tokenUsage: Record<string, number> = {};
  const mappings: Array<[string, string]> = [
    ['promptTokens', 'input_tokens'],
    ['completionTokens', 'output_tokens'],
    ['cacheReadTokens', 'cache_read_tokens'],
    ['cacheWriteTokens', 'cache_write_tokens'],
  ];
  for (const [sourceKey, targetKey] of mappings) {
    const value = readNumber(payload, sourceKey);
    if (value != null) tokenUsage[targetKey] = value;
  }
  return Object.keys(tokenUsage).length > 0 ? tokenUsage : undefined;
}

function buildTraceSteps(params: {
  turns: TurnGroup[];
  messages: StoredMessage[];
  fallbackModel: string;
}): {
  steps: Array<Record<string, unknown>>;
  completedTurns: number;
  errorTurns: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
} {
  const assistantMessages = params.messages.filter(
    (message) => message.role === 'assistant',
  );
  const steps: Array<Record<string, unknown>> = [];
  let assistantIndex = 0;
  let stepIndex = 0;
  let completedTurns = 0;
  let errorTurns = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;

  for (const turn of params.turns) {
    const turnStartPayload = parseJsonObject(turn.turnStart.payload);
    const userInput =
      readString(turnStartPayload, 'userInput') ||
      readString(turnStartPayload, 'rawUserInput');
    if (userInput) {
      steps.push({
        step_index: stepIndex,
        role: 'user',
        content: userInput,
        timestamp: turn.turnStart.timestamp,
      });
      stepIndex += 1;
    }

    const toolCallRows = turn.rows.filter(
      (row) => row.event_type === 'tool.call',
    );
    const toolResultRows = turn.rows.filter(
      (row) => row.event_type === 'tool.result',
    );
    const resultByToolCallId = new Map<
      string,
      {
        durationMs: number | null;
        content: string | null;
        isError: boolean | null;
      }
    >();
    for (const row of toolResultRows) {
      const payload = parseJsonObject(row.payload);
      const toolCallId = readString(payload, 'toolCallId');
      if (!toolCallId) continue;
      resultByToolCallId.set(toolCallId, {
        durationMs: readNumber(payload, 'durationMs'),
        content: readString(payload, 'resultSummary'),
        isError: readBoolean(payload, 'isError'),
      });
    }

    const toolCalls = toolCallRows.map((row) => {
      const payload = parseJsonObject(row.payload);
      const toolCallId =
        readString(payload, 'toolCallId') || `${turn.runId}:tool`;
      const result = resultByToolCallId.get(toolCallId);
      return {
        tool_call_id: toolCallId,
        tool_name: readString(payload, 'toolName') || 'unknown',
        input: payload.arguments ?? {},
        ...(result?.durationMs != null
          ? { duration_ms: result.durationMs }
          : {}),
      };
    });

    const observations = toolResultRows.map((row) => {
      const payload = parseJsonObject(row.payload);
      const resultSummary =
        readString(payload, 'resultSummary') ||
        truncateAuditText(JSON.stringify(payload), 280);
      return {
        source_call_id:
          readString(payload, 'toolCallId') || `${turn.runId}:tool`,
        content: resultSummary,
        output_summary: resultSummary,
        error: readBoolean(payload, 'isError') === true ? resultSummary : null,
      };
    });

    const agentStart = turn.rows.find(
      (row) => row.event_type === 'agent.start',
    );
    const agentStartPayload = agentStart
      ? parseJsonObject(agentStart.payload)
      : null;
    const usageRow = turn.rows.find((row) => row.event_type === 'model.usage');
    const usagePayload = usageRow ? parseJsonObject(usageRow.payload) : null;
    const turnEnd = turn.rows.find((row) => row.event_type === 'turn.end');
    const turnEndPayload = turnEnd ? parseJsonObject(turnEnd.payload) : null;
    const errorRow = turn.rows.find((row) => row.event_type === 'error');
    const errorPayload = errorRow ? parseJsonObject(errorRow.payload) : null;
    const finishReason = turnEndPayload
      ? readString(turnEndPayload, 'finishReason')
      : null;
    const modelId =
      formatModelForDisplay(
        readString(agentStartPayload || {}, 'model') || params.fallbackModel,
      ) || formatModelForDisplay(params.fallbackModel);

    const stepTokenUsage = buildStepTokenUsage(usagePayload);
    if (stepTokenUsage?.cache_read_tokens) {
      cacheReadTokens += stepTokenUsage.cache_read_tokens;
    }
    if (stepTokenUsage?.cache_write_tokens) {
      cacheWriteTokens += stepTokenUsage.cache_write_tokens;
    }

    let content = '';
    if (finishReason === 'completed') {
      content = assistantMessages[assistantIndex]?.content || '';
      assistantIndex += 1;
      completedTurns += 1;
    } else {
      errorTurns += 1;
      content = readString(errorPayload || {}, 'message') || '';
    }

    steps.push({
      step_index: stepIndex,
      role: 'agent',
      ...(content ? { content } : {}),
      model: modelId,
      agent_role: 'main',
      call_type: 'main',
      tool_calls: toolCalls,
      observations,
      snippets: [],
      ...(stepTokenUsage ? { token_usage: stepTokenUsage } : {}),
      timestamp:
        agentStart?.timestamp ||
        usageRow?.timestamp ||
        turnEnd?.timestamp ||
        turn.turnStart.timestamp,
    });
    stepIndex += 1;
  }

  return {
    steps,
    completedTurns,
    errorTurns,
    cacheReadTokens,
    cacheWriteTokens,
  };
}

function writeJsonlFile(filePath: string, rows: unknown[]): boolean {
  try {
    const lines = rows.map((row) => JSON.stringify(row)).join('\n');
    fs.writeFileSync(filePath, `${lines}\n`, 'utf8');
    return true;
  } catch (err) {
    logger.warn(
      { filePath, err },
      'Failed to write session trace export JSONL',
    );
    return false;
  }
}

export function exportSessionTraceAtifJsonl(params: {
  agentId: string;
  session: Session;
  messages: StoredMessage[];
  auditEntries: StructuredAuditEntry[];
  usageTotals: UsageTotals;
}): {
  path: string;
  lineCount: number;
  traceId: string;
  stepCount: number;
} | null {
  const agentId = params.agentId.trim();
  const sessionId = params.session.id.trim();
  if (!agentId || !sessionId) return null;

  try {
    const baseDir = exportBaseDir(agentId, sessionId);
    fs.mkdirSync(baseDir, { recursive: true });
    const filePath = exportFilePath(baseDir);

    const turns = groupTurnRows(params.auditEntries);
    const fallbackModel = params.session.model || '';
    const traceData =
      turns.length > 0
        ? buildTraceSteps({
            turns,
            messages: params.messages,
            fallbackModel,
          })
        : {
            steps: buildFallbackSteps(params.messages),
            completedTurns: 0,
            errorTurns: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
          };
    const steps = traceData.steps;

    const firstTimestampValue = steps[0]?.timestamp;
    const firstTimestamp =
      typeof firstTimestampValue === 'string'
        ? firstTimestampValue
        : params.session.created_at || new Date().toISOString();
    const lastTimestampValue = steps[steps.length - 1]?.timestamp;
    const lastTimestamp =
      typeof lastTimestampValue === 'string'
        ? lastTimestampValue
        : params.session.last_active || firstTimestamp;
    const normalizedModel =
      formatModelForDisplay(params.session.model || fallbackModel) || '';
    const firstUserStep = steps.find((step) => step.role === 'user');
    const firstUserContent =
      typeof firstUserStep?.content === 'string' ? firstUserStep.content : null;
    const totalDurationSeconds = Math.max(
      0,
      Math.round(
        (new Date(lastTimestamp).getTime() -
          new Date(firstTimestamp).getTime()) /
          1000,
      ),
    );
    const traceId = deterministicUuid(
      `${sessionId}:${params.session.created_at}:${agentId}`,
    );

    const limitations = [
      'System prompts are not persisted in HybridClaw session state, so system_prompts is empty.',
      'Tool observations use structured audit summaries because full tool stdout/stderr is not retained in the audit trail.',
    ];
    if (turns.length > 0) {
      limitations.push(
        'Each gateway turn is exported as one synthetic user step followed by one agent step. This is an inference from the stored turn model.',
      );
    }

    const recordWithoutHash: Record<string, unknown> = {
      schema_version: OPENTRACES_SCHEMA_VERSION,
      trace_id: traceId,
      session_id: sessionId,
      timestamp_start: firstTimestamp,
      timestamp_end: lastTimestamp,
      task: {
        description: compactText(
          firstUserContent ||
            params.session.session_summary ||
            `Session ${sessionId}`,
        ),
        source: 'user_prompt',
      },
      agent: {
        name: 'hybridclaw',
        version: APP_VERSION,
        ...(normalizedModel ? { model: normalizedModel } : {}),
      },
      environment: {
        os: os.platform(),
        shell: path.basename(process.env.SHELL || '') || null,
      },
      system_prompts: {},
      tool_definitions: [],
      steps,
      outcome: {
        success:
          steps.length > 0
            ? traceData.errorTurns === 0 ||
              (traceData.completedTurns > 0 &&
                traceData.completedTurns >= traceData.errorTurns)
            : false,
        signal_source: 'deterministic',
        signal_confidence: 'derived',
        description:
          traceData.errorTurns > 0
            ? `Exported ${traceData.completedTurns} completed turns and ${traceData.errorTurns} failed turn(s).`
            : `Exported ${traceData.completedTurns || Math.max(0, Math.floor(steps.length / 2))} completed turn(s).`,
      },
      dependencies: [],
      metrics: {
        total_steps: steps.length,
        total_input_tokens: params.usageTotals.total_input_tokens,
        total_output_tokens: params.usageTotals.total_output_tokens,
        total_duration_s: totalDurationSeconds,
        ...(traceData.cacheReadTokens + traceData.cacheWriteTokens > 0
          ? {
              cache_hit_rate:
                traceData.cacheReadTokens /
                (traceData.cacheReadTokens + traceData.cacheWriteTokens),
            }
          : {}),
        ...(params.usageTotals.total_cost_usd > 0
          ? { estimated_cost_usd: params.usageTotals.total_cost_usd }
          : {}),
      },
      security: {},
      attribution: null,
      metadata: {
        exported_at: new Date().toISOString(),
        compatibility: {
          opentraces_schema_version: OPENTRACES_SCHEMA_VERSION,
          atif_version: ATIF_COMPAT_VERSION,
          mode: 'ATIF v1.6 compatible core with opentraces top-level envelope',
        },
        hybridclaw: {
          agent_id: agentId,
          channel_id: params.session.channel_id,
          show_mode: params.session.show_mode,
          audit_event_count: params.auditEntries.length,
          stored_message_count: params.messages.length,
          usage_call_count: params.usageTotals.call_count,
          tool_call_count: params.usageTotals.total_tool_calls,
        },
        ...(params.session.session_summary
          ? {
              session_summary: compactText(params.session.session_summary),
            }
          : {}),
        limitations,
      },
    };

    const sanitizedRecord = finalizeTraceRecord(recordWithoutHash);
    const contentHash = sha256Hex(stableStringify(sanitizedRecord));
    const record = {
      ...sanitizedRecord,
      content_hash: contentHash,
    };

    if (!writeJsonlFile(filePath, [record])) return null;
    return {
      path: filePath,
      lineCount: 1,
      traceId,
      stepCount: steps.length,
    };
  } catch (err) {
    logger.warn({ agentId, sessionId, err }, 'Failed to export session trace');
    return null;
  }
}
