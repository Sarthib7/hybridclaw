import { describe, expect, test } from 'vitest';

import {
  hasQueuedProactiveDeliveryPath,
  isDiscordChannelId,
  resolveHeartbeatDeliveryChannelId,
  shouldDropQueuedProactiveMessage,
} from '../src/gateway/proactive-delivery.js';

describe('proactive delivery helpers', () => {
  test('recognizes Discord snowflake channel ids', () => {
    expect(isDiscordChannelId('123456789012345678')).toBe(true);
    expect(isDiscordChannelId('tui')).toBe(false);
    expect(isDiscordChannelId('heartbeat')).toBe(false);
  });

  test('heartbeat prefers explicit channel and otherwise uses last Discord channel', () => {
    expect(
      resolveHeartbeatDeliveryChannelId({
        explicitChannelId: '123456789012345678',
        lastUsedDiscordChannelId: '987654321098765432',
      }),
    ).toBe('123456789012345678');

    expect(
      resolveHeartbeatDeliveryChannelId({
        explicitChannelId: '   ',
        lastUsedDiscordChannelId: '987654321098765432',
      }),
    ).toBe('987654321098765432');

    expect(
      resolveHeartbeatDeliveryChannelId({
        explicitChannelId: '',
        lastUsedDiscordChannelId: null,
      }),
    ).toBeNull();
  });

  test('recognizes supported queued proactive delivery paths', () => {
    expect(
      hasQueuedProactiveDeliveryPath({
        channel_id: '123456789012345678',
      }),
    ).toBe(true);

    expect(
      hasQueuedProactiveDeliveryPath({
        channel_id: 'tui',
      }),
    ).toBe(true);

    expect(
      hasQueuedProactiveDeliveryPath({
        channel_id: 'smoke',
      }),
    ).toBe(false);
  });

  test('drops undeliverable queue rows but keeps valid local queue entries', () => {
    expect(
      shouldDropQueuedProactiveMessage({
        channel_id: 'heartbeat',
        source: 'heartbeat',
      }),
    ).toBe(true);

    expect(
      shouldDropQueuedProactiveMessage({
        channel_id: 'tui',
        source: 'heartbeat',
      }),
    ).toBe(false);

    expect(
      shouldDropQueuedProactiveMessage({
        channel_id: 'heartbeat',
        source: 'delegate',
      }),
    ).toBe(true);

    expect(
      shouldDropQueuedProactiveMessage({
        channel_id: 'smoke',
        source: 'fullauto',
      }),
    ).toBe(true);
  });
});
