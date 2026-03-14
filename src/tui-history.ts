import type { GatewayHistoryMessage } from './gateway/gateway-types.js';

const ANSI_ESCAPE_PATTERN =
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;
const TUI_HISTORY_FETCH_MULTIPLIER = 2;

function normalizeTuiHistoryEntry(content: string): string | null {
  const normalized = String(content || '')
    .replace(ANSI_ESCAPE_PATTERN, '')
    .replace(/\r\n?/g, '\n')
    .trim();
  if (!normalized) return null;
  if (normalized.includes('\n')) return null;
  return normalized;
}

export function resolveTuiHistoryFetchLimit(limit: number): number {
  const requestedEntries = Math.max(1, Math.floor(limit) || 1);
  // The gateway history API returns both user and assistant turns, while the
  // readline preload keeps only recent single-line user inputs.
  return requestedEntries * TUI_HISTORY_FETCH_MULTIPLIER;
}

export function buildTuiReadlineHistory(
  messages: GatewayHistoryMessage[],
  maxEntries: number,
): string[] {
  const limit = Math.max(1, Math.floor(maxEntries) || 1);
  const history: string[] = [];

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'user') continue;

    const entry = normalizeTuiHistoryEntry(message.content);
    if (!entry) continue;

    history.push(entry);
    if (history.length >= limit) break;
  }

  return history;
}
