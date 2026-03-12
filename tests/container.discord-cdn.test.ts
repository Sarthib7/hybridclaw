import { expect, test } from 'vitest';

import { isSafeDiscordCdnUrl } from '../container/src/discord-cdn.ts';

test('allows known Discord CDN HTTPS URLs', () => {
  expect(
    isSafeDiscordCdnUrl('https://cdn.discordapp.com/attachments/1/2/file.png'),
  ).toBe(true);
  expect(
    isSafeDiscordCdnUrl(
      'https://images-ext-1.discordapp.net/external/example.png',
    ),
  ).toBe(true);
});

test('blocks non-Discord or non-HTTPS URLs', () => {
  expect(
    isSafeDiscordCdnUrl('http://cdn.discordapp.com/attachments/1/2/file.png'),
  ).toBe(false);
  expect(isSafeDiscordCdnUrl('https://example.com/file.png')).toBe(false);
  expect(isSafeDiscordCdnUrl('not-a-url')).toBe(false);
});
