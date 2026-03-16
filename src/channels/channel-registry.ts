import {
  type ChannelInfo,
  type ChannelKind,
  DISCORD_CAPABILITIES,
  EMAIL_CAPABILITIES,
  MSTEAMS_CAPABILITIES,
  SYSTEM_CAPABILITIES,
  TUI_CAPABILITIES,
  WHATSAPP_CAPABILITIES,
} from './channel.js';
import { isEmailAddress } from './email/allowlist.js';
import { isWhatsAppJid } from './whatsapp/phone.js';

const DISCORD_SNOWFLAKE_RE = /^\d{16,22}$/;

const channels = new Map<ChannelKind, ChannelInfo>();

function normalizeChannelKind(kind?: string | null): ChannelKind | undefined {
  const normalized = String(kind || '')
    .trim()
    .toLowerCase();
  if (!normalized) return undefined;
  if (normalized === 'teams') return 'msteams';
  if (
    normalized === 'api' ||
    normalized === 'cli' ||
    normalized === 'discord' ||
    normalized === 'email' ||
    normalized === 'heartbeat' ||
    normalized === 'msteams' ||
    normalized === 'scheduler' ||
    normalized === 'tui' ||
    normalized === 'unknown' ||
    normalized === 'web' ||
    normalized === 'whatsapp'
  ) {
    return normalized;
  }
  return undefined;
}

function buildDefaultChannelInfo(kind: ChannelKind): ChannelInfo {
  const capabilities =
    kind === 'discord'
      ? DISCORD_CAPABILITIES
      : kind === 'email'
        ? EMAIL_CAPABILITIES
        : kind === 'msteams'
          ? MSTEAMS_CAPABILITIES
          : kind === 'tui'
            ? TUI_CAPABILITIES
            : kind === 'whatsapp'
              ? WHATSAPP_CAPABILITIES
              : SYSTEM_CAPABILITIES;
  return {
    kind,
    id: kind,
    capabilities,
  };
}

function inferChannelKind(channelId?: string | null): ChannelKind | undefined {
  const normalized = String(channelId || '').trim();
  if (!normalized) return undefined;
  const explicitKind = normalizeChannelKind(normalized);
  if (explicitKind) return explicitKind;
  if (
    normalized.startsWith('19:') ||
    normalized.startsWith('teams:') ||
    normalized.includes('@thread.')
  ) {
    return 'msteams';
  }
  if (isWhatsAppJid(normalized)) return 'whatsapp';
  if (isEmailAddress(normalized)) return 'email';
  if (DISCORD_SNOWFLAKE_RE.test(normalized)) return 'discord';
  return undefined;
}

export function registerChannel(info: ChannelInfo): void {
  const kind = normalizeChannelKind(info.kind);
  if (!kind) {
    throw new Error(`Unsupported channel kind: ${info.kind}`);
  }
  channels.set(kind, {
    ...info,
    kind,
    id: String(info.id || kind).trim() || kind,
  });
}

export function getChannel(
  kind: ChannelKind | string,
): ChannelInfo | undefined {
  const normalized = normalizeChannelKind(kind);
  if (!normalized) return undefined;
  return channels.get(normalized) || buildDefaultChannelInfo(normalized);
}

export function getChannelByContextId(
  channelId: string | null | undefined,
): ChannelInfo | undefined {
  const inferredKind = inferChannelKind(channelId);
  if (!inferredKind) return undefined;
  const registered = channels.get(inferredKind);
  if (registered) return registered;
  const fallback = buildDefaultChannelInfo(inferredKind);
  return {
    ...fallback,
    id: String(channelId || '').trim() || fallback.id,
  };
}

export function listChannels(): ChannelInfo[] {
  return Array.from(channels.values()).sort((a, b) =>
    a.kind.localeCompare(b.kind),
  );
}
