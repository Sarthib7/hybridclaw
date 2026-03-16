import { randomBytes } from 'node:crypto';

export interface TuiRunOptions {
  sessionId: string;
  startedAtMs: number;
  resumeCommand: string;
}

export interface TuiExitSummary {
  sessionId: string;
  durationMs: number;
  messageCount: number;
  userMessageCount: number;
  toolCallCount: number;
  resumeCommand: string;
}

function padTimestampPart(value: number): string {
  return String(Math.max(0, Math.trunc(value))).padStart(2, '0');
}

export function generateTuiSessionId(
  now: Date = new Date(),
  suffix: string = randomBytes(3).toString('hex'),
): string {
  const year = String(now.getFullYear()).padStart(4, '0');
  const month = padTimestampPart(now.getMonth() + 1);
  const day = padTimestampPart(now.getDate());
  const hours = padTimestampPart(now.getHours());
  const minutes = padTimestampPart(now.getMinutes());
  const seconds = padTimestampPart(now.getSeconds());
  const normalizedSuffix =
    String(suffix || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-f0-9]/g, '')
      .slice(0, 6) || randomBytes(3).toString('hex');
  return `${year}${month}${day}_${hours}${minutes}${seconds}_${normalizedSuffix}`;
}

export function resolveTuiRunOptions(params?: {
  resumeSessionId?: string | null;
  now?: Date;
  resumeCommand?: string | null;
}): TuiRunOptions {
  const now = params?.now instanceof Date ? params.now : new Date();
  const resumeSessionId = String(params?.resumeSessionId || '').trim();
  const resumeCommand = String(
    params?.resumeCommand || 'hybridclaw --resume',
  ).trim();

  return {
    sessionId: resumeSessionId || generateTuiSessionId(now),
    startedAtMs: now.getTime(),
    resumeCommand: resumeCommand || 'hybridclaw --resume',
  };
}

export function formatTuiSessionDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function buildTuiExitSummaryLines(summary: TuiExitSummary): string[] {
  return [
    'Resume this session with:',
    `  ${summary.resumeCommand} ${summary.sessionId}`,
    '',
    `Session:        ${summary.sessionId}`,
    `Duration:       ${formatTuiSessionDuration(summary.durationMs)}`,
    `Messages:       ${summary.messageCount} (${summary.userMessageCount} user, ${summary.toolCallCount} tool calls)`,
  ];
}
