import { expect, test } from 'vitest';

import {
  DISCORD_CAPABILITIES,
  EMAIL_CAPABILITIES,
  WHATSAPP_CAPABILITIES,
} from '../src/channels/channel.js';
import {
  getChannel,
  getChannelByContextId,
  listChannels,
  registerChannel,
} from '../src/channels/channel-registry.js';

test('registerChannel and getChannel return registered channel info', () => {
  registerChannel({
    kind: 'discord',
    id: 'discord-bot',
    capabilities: DISCORD_CAPABILITIES,
  });

  expect(getChannel('discord')).toMatchObject({
    kind: 'discord',
    id: 'discord-bot',
  });
});

test('getChannelByContextId resolves Discord, WhatsApp, email, and Teams ids', () => {
  expect(getChannelByContextId('1475079601968648386')?.kind).toBe('discord');
  expect(getChannelByContextId('491234567890@s.whatsapp.net')?.kind).toBe(
    'whatsapp',
  );
  expect(getChannelByContextId('peer@example.com')?.kind).toBe('email');
  expect(getChannelByContextId('19:channel@thread.tacv2')?.kind).toBe(
    'msteams',
  );
});

test('listChannels returns registered channels', () => {
  registerChannel({
    kind: 'email',
    id: 'ops@example.com',
    capabilities: EMAIL_CAPABILITIES,
  });
  registerChannel({
    kind: 'whatsapp',
    id: 'whatsapp',
    capabilities: WHATSAPP_CAPABILITIES,
  });

  const registeredKinds = listChannels().map((channel) => channel.kind);
  expect(registeredKinds).toEqual(
    expect.arrayContaining(['discord', 'email', 'whatsapp']),
  );
});

test('capability presets match expected defaults', () => {
  expect(DISCORD_CAPABILITIES.maxMessageLength).toBe(2_000);
  expect(DISCORD_CAPABILITIES.typing).toBe(true);
  expect(WHATSAPP_CAPABILITIES.attachments).toBe(true);
  expect(WHATSAPP_CAPABILITIES.threads).toBe(false);
  expect(EMAIL_CAPABILITIES.attachments).toBe(true);
  expect(EMAIL_CAPABILITIES.reactions).toBe(false);
});
