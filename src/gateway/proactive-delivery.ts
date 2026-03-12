import type { QueuedProactiveMessage } from '../memory/db.js';

const DISCORD_CHANNEL_ID_RE = /^\d{16,22}$/;
const LOCAL_PROACTIVE_PULL_CHANNEL_IDS = new Set(['tui']);

export function isDiscordChannelId(channelId: string): boolean {
  return DISCORD_CHANNEL_ID_RE.test(channelId);
}

export function hasQueuedProactiveDeliveryPath(
  item: Pick<QueuedProactiveMessage, 'channel_id'>,
): boolean {
  const channelId = item.channel_id.trim();
  if (!channelId) return false;
  if (isDiscordChannelId(channelId)) return true;
  return LOCAL_PROACTIVE_PULL_CHANNEL_IDS.has(channelId);
}

export function resolveHeartbeatDeliveryChannelId(params: {
  explicitChannelId: string;
  lastUsedDiscordChannelId: string | null;
}): string | null {
  const explicitChannelId = params.explicitChannelId.trim();
  if (explicitChannelId) return explicitChannelId;
  return params.lastUsedDiscordChannelId;
}

export function shouldDropQueuedProactiveMessage(
  item: Pick<QueuedProactiveMessage, 'channel_id' | 'source'>,
): boolean {
  if (!hasQueuedProactiveDeliveryPath(item)) return true;
  return item.source === 'heartbeat' && item.channel_id === 'heartbeat';
}
