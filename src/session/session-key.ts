import { DEFAULT_AGENT_ID } from '../agents/agent-types.js';

export interface ParsedSessionKey {
  agentId: string;
  channelKind: string;
  chatType: string;
  peerId: string;
}

interface SessionKeyMigrationContext {
  agent_id?: string | null;
  guild_id?: string | null;
  channel_id?: string | null;
}

const DISCORD_SESSION_KEY_RE = /^\d{16,22}:\d{16,22}$/;

function normalizeSessionKeySegment(value: string, label: string): string {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (!normalized) {
    throw new Error(`Session key ${label} cannot be empty`);
  }
  return normalized;
}

export function buildSessionKey(
  agentId: string,
  channelKind: string,
  chatType: string,
  peerId: string,
): string {
  return [
    'agent',
    normalizeSessionKeySegment(agentId, 'agentId'),
    normalizeSessionKeySegment(channelKind, 'channelKind'),
    normalizeSessionKeySegment(chatType, 'chatType'),
    normalizeSessionKeySegment(peerId, 'peerId'),
  ].join(':');
}

export function parseSessionKey(key: string): ParsedSessionKey | null {
  const parts = String(key || '')
    .trim()
    .split(':');
  if (parts.length < 5) return null;
  if (parts[0] !== 'agent') return null;
  const [_, agentId, channelKind, chatType, ...peerParts] = parts;
  const peerId = peerParts.join(':').trim();
  if (!agentId || !channelKind || !chatType || !peerId) return null;
  return {
    agentId,
    channelKind,
    chatType,
    peerId,
  };
}

export function isLegacySessionKey(key: string): boolean {
  const normalized = String(key || '').trim();
  if (!normalized) return false;
  if (parseSessionKey(normalized)) return false;
  return (
    DISCORD_SESSION_KEY_RE.test(normalized) ||
    normalized.startsWith('cron:') ||
    normalized.startsWith('dm:') ||
    normalized.startsWith('heartbeat:') ||
    normalized.startsWith('scheduler:') ||
    normalized.startsWith('tui:')
  );
}

export function migrateLegacySessionKey(
  key: string,
  session: SessionKeyMigrationContext,
): string {
  const normalized = String(key || '').trim();
  if (!normalized) return normalized;
  if (parseSessionKey(normalized)) return normalized;

  const normalizedAgentId =
    String(session.agent_id || '').trim() || DEFAULT_AGENT_ID;
  const discordMatch = normalized.match(/^(\d{16,22}):(\d{16,22})$/);
  if (discordMatch) {
    const channelId = String(session.channel_id || discordMatch[2]).trim();
    return buildSessionKey(normalizedAgentId, 'discord', 'channel', channelId);
  }

  if (normalized.startsWith('dm:')) {
    return buildSessionKey(
      normalizedAgentId,
      'discord',
      'dm',
      normalized.slice('dm:'.length),
    );
  }

  if (normalized.startsWith('heartbeat:')) {
    const agentIdFromKey =
      normalized.slice('heartbeat:'.length).trim() || normalizedAgentId;
    return buildSessionKey(agentIdFromKey, 'heartbeat', 'system', 'default');
  }

  if (normalized.startsWith('scheduler:')) {
    return buildSessionKey(
      normalizedAgentId,
      'scheduler',
      'system',
      normalized.slice('scheduler:'.length),
    );
  }

  if (normalized.startsWith('cron:')) {
    return buildSessionKey(
      normalizedAgentId,
      'scheduler',
      'cron',
      normalized.slice('cron:'.length),
    );
  }

  if (normalized.startsWith('tui:')) {
    return buildSessionKey(
      normalizedAgentId,
      'tui',
      'dm',
      normalized.slice('tui:'.length),
    );
  }

  return normalized;
}
