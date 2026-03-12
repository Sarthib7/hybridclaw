import { URL } from 'node:url';

export const DISCORD_CDN_HOST_PATTERNS: RegExp[] = [
  /^cdn\.discordapp\.com$/i,
  /^media\.discordapp\.net$/i,
  /^cdn\.discordapp\.net$/i,
  /^images-ext-\d+\.discordapp\.net$/i,
];

export function isSafeDiscordCdnUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  return DISCORD_CDN_HOST_PATTERNS.some((pattern) =>
    pattern.test(parsed.hostname),
  );
}
