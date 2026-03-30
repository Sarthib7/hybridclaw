import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseJsonObject, truncateAuditText } from '../audit/audit-trail.js';
import { APP_VERSION } from '../config/config.js';
import { agentWorkspaceDir, ensureAgentDirs } from '../infra/ipc.js';
import { logger } from '../logger.js';
import { formatModelForDisplay } from '../providers/model-names.js';
import { redactHighEntropyStrings, redactSecrets } from '../security/redact.js';
import type { StructuredAuditEntry } from '../types/audit.js';
import type { Session, StoredMessage } from '../types/session.js';
import type { UsageTotals } from '../types/usage.js';

const TRACE_EXPORTS_DIR_NAME = '.trace-exports';
const OPENTRACES_SCHEMA_VERSION = '0.1.0';
const ATIF_COMPAT_VERSION = '1.6';
const TRACE_USERNAME_HASH_LENGTH = 8;
const TRACE_PRESERVED_IDENTIFIER_KEYS = new Set([
  'session_id',
  'trace_id',
  'tool_call_id',
  'source_call_id',
]);
const TRACE_SYSTEM_USERNAMES = new Set([
  'Shared',
  'runner',
  'lib',
  'admin',
  'root',
  'default',
  'Public',
  'Guest',
]);
const TRACE_SLASH_USERNAME_PATH_RE =
  /(?:\/Users\/|\/home\/|[A-Za-z]:\/Users\/|\/mnt\/[A-Za-z]\/Users\/|\/\/wsl\.localhost\/[^/]+\/home\/)([A-Za-z0-9][A-Za-z0-9_-]{2,})\//g;
const TRACE_BACKSLASH_USERNAME_PATH_RE =
  /(?:[A-Za-z]:\\Users\\|\\\\wsl\.localhost\\[^\\]+\\home\\)([A-Za-z0-9][A-Za-z0-9_-]{2,})\\/g;
const TRACE_SLASH_USERNAME_PATH_PREFIX_RE =
  /((?:\/Users\/|\/home\/|[A-Za-z]:\/Users\/|\/mnt\/[A-Za-z]\/Users\/|\/\/wsl\.localhost\/[^/]+\/home\/))([^/\s]+)(\/)/g;
const TRACE_BACKSLASH_USERNAME_PATH_PREFIX_RE =
  /((?:[A-Za-z]:\\Users\\|\\\\wsl\.localhost\\[^\\]+\\home\\))([^\\\s]+)(\\)/g;

const TRACE_EXPORT_EXTRA_REDACTION_PATTERNS: ReadonlyArray<{
  match: RegExp;
  replace: string;
}> = Object.freeze([
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
const TRACE_EXPORT_BASE_LIMITATIONS = Object.freeze([
  'Tool observations use structured audit summaries because full tool stdout/stderr is not retained in the audit trail.',
  'Environment metadata fields such as os and shell are exported as runtime host information and are not anonymized.',
]);
const TRACE_EXPORT_FALLBACK_LIMITATION =
  'Structured turn audit was unavailable, so steps were reconstructed directly from stored session messages.';

interface TurnGroup {
  runId: string;
  rows: StructuredAuditEntry[];
  turnStart: StructuredAuditEntry;
}

interface ToolResultSummary {
  durationMs: number | null;
  content: string | null;
  isError: boolean | null;
}

interface TurnRowSummary {
  agentStart: StructuredAuditEntry | null;
  usageRow: StructuredAuditEntry | null;
  turnEnd: StructuredAuditEntry | null;
  errorRow: StructuredAuditEntry | null;
  toolCallRows: StructuredAuditEntry[];
  toolResultRows: StructuredAuditEntry[];
}

enum TraceRedactionFieldType {
  General = 'general',
  ToolInput = 'tool_input',
  ToolResult = 'tool_result',
  Identifier = 'identifier',
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
  return JSON.stringify(value, (_key, entry) =>
    entry && typeof entry === 'object' && !Array.isArray(entry)
      ? Object.fromEntries(
          Object.keys(entry as Record<string, unknown>)
            .sort((left, right) => left.localeCompare(right))
            .map((key) => [key, (entry as Record<string, unknown>)[key]]),
        )
      : entry,
  );
}

function deterministicUuid(seed: string): string {
  const hex = sha256Hex(seed).slice(0, 32);
  const versionedTimeHigh = `4${hex.slice(13, 16)}`;
  const variantNibble = ((Number.parseInt(hex[16] || '0', 16) & 0x3) | 0x8)
    .toString(16)
    .toLowerCase();
  const variantClockSeq = `${variantNibble}${hex.slice(17, 20)}`;
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    versionedTimeHigh,
    variantClockSeq,
    hex.slice(20, 32),
  ].join('-');
}

function anonymizedPathUsername(username: string): string {
  return `user_${sha256Hex(username.trim().toLowerCase()).slice(0, TRACE_USERNAME_HASH_LENGTH)}`;
}

function getExplicitTraceUsernames(): string[] {
  const candidates = new Set<string>();
  for (const raw of [process.env.USER, process.env.USERNAME]) {
    const value = raw?.trim();
    if (value) candidates.add(value);
  }
  try {
    const username = os.userInfo().username.trim();
    if (username) candidates.add(username);
  } catch {}

  return [...candidates].filter(
    (username) => !TRACE_SYSTEM_USERNAMES.has(username),
  );
}

function extractTracePathUsernames(text: string): Set<string> {
  const matches = new Set<string>();
  for (const pattern of [
    TRACE_SLASH_USERNAME_PATH_RE,
    TRACE_BACKSLASH_USERNAME_PATH_RE,
  ]) {
    for (const match of text.matchAll(pattern)) {
      const username = match[1];
      if (username && !TRACE_SYSTEM_USERNAMES.has(username)) {
        matches.add(username);
      }
    }
  }
  return matches;
}

function anonymizeExplicitUsernameReferences(
  text: string,
  usernames: Iterable<string>,
): string {
  let next = text;
  for (const username of usernames) {
    const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const replacement = anonymizedPathUsername(username);
    next = next
      .replace(new RegExp(`-Users-${escaped}-`, 'g'), `-Users-${replacement}-`)
      .replace(new RegExp(`~${escaped}(?=/|$)`, 'g'), `~${replacement}`)
      .replace(new RegExp(`\\b${escaped}\\b`, 'g'), replacement);
  }
  return next;
}

function anonymizeTracePaths(text: string): string {
  let next = text
    .replace(
      TRACE_SLASH_USERNAME_PATH_PREFIX_RE,
      (_match, prefix: string, username: string, suffix: string) =>
        `${prefix}${anonymizedPathUsername(username)}${suffix}`,
    )
    .replace(
      TRACE_BACKSLASH_USERNAME_PATH_PREFIX_RE,
      (_match, prefix: string, username: string, suffix: string) =>
        `${prefix}${anonymizedPathUsername(username)}${suffix}`,
    );

  next = anonymizeExplicitUsernameReferences(next, getExplicitTraceUsernames());
  next = anonymizeExplicitUsernameReferences(
    next,
    extractTracePathUsernames(text),
  );
  return next;
}

function redactTraceText(
  text: string,
  fieldType: TraceRedactionFieldType,
): string {
  if (fieldType === TraceRedactionFieldType.Identifier) return text;
  let next = anonymizeTracePaths(text);
  next = redactSecrets(next);
  for (const pattern of TRACE_EXPORT_EXTRA_REDACTION_PATTERNS) {
    next = next.replace(pattern.match, pattern.replace);
  }
  if (
    fieldType === TraceRedactionFieldType.General ||
    fieldType === TraceRedactionFieldType.ToolInput
  ) {
    next = redactHighEntropyStrings(next);
  }
  return next;
}

function fieldTypeForChildKey(
  key: string,
  parentType: TraceRedactionFieldType,
): TraceRedactionFieldType {
  if (TRACE_PRESERVED_IDENTIFIER_KEYS.has(key)) {
    return TraceRedactionFieldType.Identifier;
  }
  if (key === 'input') return TraceRedactionFieldType.ToolInput;
  if (
    key === 'observations' ||
    key === 'output_summary' ||
    key === 'error' ||
    key === 'reasoning_content'
  ) {
    return TraceRedactionFieldType.ToolResult;
  }
  return parentType;
}

function sanitizeTraceExportValue(
  value: unknown,
  fieldType: TraceRedactionFieldType = TraceRedactionFieldType.General,
): unknown {
  if (typeof value === 'string') return redactTraceText(value, fieldType);
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeTraceExportValue(entry, fieldType));
  }
  if (!value || typeof value !== 'object') return value;

  const sanitized: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    sanitized[key] = sanitizeTraceExportValue(
      raw,
      fieldTypeForChildKey(key, fieldType),
    );
  }
  return sanitized;
}

function finalizeTraceRecord(
  record: Record<string, unknown>,
): Record<string, unknown> {
  return sanitizeTraceExportValue(record) as Record<string, unknown>;
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

function truncateText(text: string, maxChars = 12_000): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}...`;
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

function summarizeTurnRows(rows: StructuredAuditEntry[]): TurnRowSummary {
  const summary: TurnRowSummary = {
    agentStart: null,
    usageRow: null,
    turnEnd: null,
    errorRow: null,
    toolCallRows: [],
    toolResultRows: [],
  };
  for (const row of rows) {
    switch (row.event_type) {
      case 'agent.start':
        summary.agentStart ??= row;
        break;
      case 'model.usage':
        summary.usageRow ??= row;
        break;
      case 'turn.end':
        summary.turnEnd ??= row;
        break;
      case 'error':
        summary.errorRow ??= row;
        break;
      case 'tool.call':
        summary.toolCallRows.push(row);
        break;
      case 'tool.result':
        summary.toolResultRows.push(row);
        break;
      default:
        break;
    }
  }
  return summary;
}

function buildTraceSystemPrompts(turns: TurnGroup[]): Record<string, string> {
  const systemPrompts: Record<string, string> = {};
  for (const turn of turns) {
    const agentStart = summarizeTurnRows(turn.rows).agentStart;
    if (!agentStart) continue;
    const agentStartPayload = parseJsonObject(agentStart.payload);
    const systemPrompt = readString(agentStartPayload, 'systemPrompt');
    if (!systemPrompt) continue;
    systemPrompts[turn.runId] = systemPrompt;
  }
  return systemPrompts;
}

function buildUserTraceStep(
  turn: TurnGroup,
  stepIndex: number,
): Record<string, unknown> | null {
  const turnStartPayload = parseJsonObject(turn.turnStart.payload);
  const userInput =
    readString(turnStartPayload, 'userInput') ||
    readString(turnStartPayload, 'rawUserInput');
  if (!userInput) return null;
  return {
    step_index: stepIndex,
    role: 'user',
    content: userInput,
    timestamp: turn.turnStart.timestamp,
  };
}

function buildToolResultByCallId(
  toolResultRows: StructuredAuditEntry[],
): Map<string, ToolResultSummary> {
  const resultByToolCallId = new Map<string, ToolResultSummary>();
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
  return resultByToolCallId;
}

function buildToolCallTraceEntries(
  turn: TurnGroup,
  toolCallRows: StructuredAuditEntry[],
  resultByToolCallId: Map<string, ToolResultSummary>,
): Array<Record<string, unknown>> {
  return toolCallRows.map((row) => {
    const payload = parseJsonObject(row.payload);
    const toolCallId =
      readString(payload, 'toolCallId') || `${turn.runId}:tool`;
    const result = resultByToolCallId.get(toolCallId);
    return {
      tool_call_id: toolCallId,
      tool_name: readString(payload, 'toolName') || 'unknown',
      input: payload.arguments ?? {},
      ...(result?.durationMs != null ? { duration_ms: result.durationMs } : {}),
    };
  });
}

function buildObservationTraceEntries(
  turn: TurnGroup,
  toolResultRows: StructuredAuditEntry[],
): Array<Record<string, unknown>> {
  return toolResultRows.map((row) => {
    const payload = parseJsonObject(row.payload);
    const resultSummary =
      readString(payload, 'resultSummary') ||
      truncateAuditText(JSON.stringify(payload), 280);
    return {
      source_call_id: readString(payload, 'toolCallId') || `${turn.runId}:tool`,
      content: resultSummary,
      output_summary: resultSummary,
      error: readBoolean(payload, 'isError') === true ? resultSummary : null,
    };
  });
}

function readTurnModelId(
  summary: TurnRowSummary,
  fallbackModel: string,
): string {
  const agentStartPayload = summary.agentStart
    ? parseJsonObject(summary.agentStart.payload)
    : null;
  return (
    formatModelForDisplay(
      readString(agentStartPayload || {}, 'model') || fallbackModel,
    ) || formatModelForDisplay(fallbackModel)
  );
}

function readTurnTokenUsage(
  summary: TurnRowSummary,
): Record<string, number> | undefined {
  const usagePayload = summary.usageRow
    ? parseJsonObject(summary.usageRow.payload)
    : null;
  return buildStepTokenUsage(usagePayload);
}

function readTurnFinishReason(summary: TurnRowSummary): string | null {
  const turnEndPayload = summary.turnEnd
    ? parseJsonObject(summary.turnEnd.payload)
    : null;
  return turnEndPayload ? readString(turnEndPayload, 'finishReason') : null;
}

function resolveTurnAgentContent(
  summary: TurnRowSummary,
  finishReason: string | null,
  assistantMessages: StoredMessage[],
  assistantIndex: number,
): {
  content: string;
  nextAssistantIndex: number;
  completed: boolean;
  errored: boolean;
} {
  if (finishReason === 'completed') {
    return {
      content: assistantMessages[assistantIndex]?.content || '',
      nextAssistantIndex: assistantIndex + 1,
      completed: true,
      errored: false,
    };
  }

  const errorPayload = summary.errorRow
    ? parseJsonObject(summary.errorRow.payload)
    : null;
  return {
    content: readString(errorPayload || {}, 'message') || '',
    nextAssistantIndex: assistantIndex,
    completed: false,
    errored: true,
  };
}

function readTurnStepTimestamp(
  turn: TurnGroup,
  summary: TurnRowSummary,
): string {
  return (
    summary.agentStart?.timestamp ||
    summary.usageRow?.timestamp ||
    summary.turnEnd?.timestamp ||
    turn.turnStart.timestamp
  );
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
    const summary = summarizeTurnRows(turn.rows);
    const userStep = buildUserTraceStep(turn, stepIndex);
    if (userStep) {
      steps.push(userStep);
      stepIndex += 1;
    }

    const resultByToolCallId = buildToolResultByCallId(summary.toolResultRows);
    const toolCalls = buildToolCallTraceEntries(
      turn,
      summary.toolCallRows,
      resultByToolCallId,
    );
    const observations = buildObservationTraceEntries(
      turn,
      summary.toolResultRows,
    );
    const finishReason = readTurnFinishReason(summary);
    const modelId = readTurnModelId(summary, params.fallbackModel);
    const stepTokenUsage = readTurnTokenUsage(summary);
    if (stepTokenUsage?.cache_read_tokens) {
      cacheReadTokens += stepTokenUsage.cache_read_tokens;
    }
    if (stepTokenUsage?.cache_write_tokens) {
      cacheWriteTokens += stepTokenUsage.cache_write_tokens;
    }

    const resolvedContent = resolveTurnAgentContent(
      summary,
      finishReason,
      assistantMessages,
      assistantIndex,
    );
    assistantIndex = resolvedContent.nextAssistantIndex;
    if (resolvedContent.completed) completedTurns += 1;
    if (resolvedContent.errored) errorTurns += 1;

    steps.push({
      step_index: stepIndex,
      role: 'agent',
      ...(resolvedContent.content ? { content: resolvedContent.content } : {}),
      model: modelId,
      agent_role: 'main',
      call_type: 'main',
      tool_calls: toolCalls,
      observations,
      snippets: [],
      ...(stepTokenUsage ? { token_usage: stepTokenUsage } : {}),
      timestamp: readTurnStepTimestamp(turn, summary),
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

async function writeJsonlFile(
  filePath: string,
  rows: unknown[],
): Promise<boolean> {
  try {
    const lines = rows.map((row) => JSON.stringify(row)).join('\n');
    await fs.promises.writeFile(filePath, `${lines}\n`, 'utf8');
    return true;
  } catch (err) {
    logger.warn(
      { filePath, err },
      'Failed to write session trace export JSONL',
    );
    return false;
  }
}

export async function exportSessionTraceAtifJsonl(params: {
  agentId: string;
  session: Session;
  messages: StoredMessage[];
  auditEntries: StructuredAuditEntry[];
  usageTotals: UsageTotals;
}): Promise<{
  path: string;
  lineCount: number;
  traceId: string;
  stepCount: number;
} | null> {
  const agentId = params.agentId.trim();
  const sessionId = params.session.id.trim();
  if (!agentId || !sessionId) return null;

  try {
    const baseDir = exportBaseDir(agentId, sessionId);
    await fs.promises.mkdir(baseDir, { recursive: true });
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

    const systemPrompts = buildTraceSystemPrompts(turns);
    const limitations =
      turns.length === 0
        ? [...TRACE_EXPORT_BASE_LIMITATIONS, TRACE_EXPORT_FALLBACK_LIMITATION]
        : [...TRACE_EXPORT_BASE_LIMITATIONS];

    const recordWithoutHash: Record<string, unknown> = {
      schema_version: OPENTRACES_SCHEMA_VERSION,
      trace_id: traceId,
      session_id: sessionId,
      timestamp_start: firstTimestamp,
      timestamp_end: lastTimestamp,
      task: {
        description: truncateText(
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
      system_prompts: systemPrompts,
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
              session_summary: truncateText(params.session.session_summary),
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

    if (!(await writeJsonlFile(filePath, [record]))) return null;
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
