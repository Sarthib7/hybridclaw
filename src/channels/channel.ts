export type ChannelKind =
  | 'api'
  | 'cli'
  | 'discord'
  | 'email'
  | 'heartbeat'
  | 'msteams'
  | 'scheduler'
  | 'tui'
  | 'unknown'
  | 'web'
  | 'whatsapp';

export interface ChannelCapabilities {
  typing: boolean;
  reactions: boolean;
  threads: boolean;
  embeds: boolean;
  attachments: boolean;
  messageEditing: boolean;
  maxMessageLength: number;
}

export interface ChannelInfo {
  kind: ChannelKind;
  id: string;
  capabilities: ChannelCapabilities;
}

const DISABLED_CAPABILITIES: ChannelCapabilities = Object.freeze({
  typing: false,
  reactions: false,
  threads: false,
  embeds: false,
  attachments: false,
  messageEditing: false,
  maxMessageLength: 0,
});

export const DISCORD_CAPABILITIES: ChannelCapabilities = Object.freeze({
  typing: true,
  reactions: true,
  threads: true,
  embeds: true,
  attachments: true,
  messageEditing: true,
  maxMessageLength: 2_000,
});

export const TUI_CAPABILITIES: ChannelCapabilities = Object.freeze({
  ...DISABLED_CAPABILITIES,
});

export const WHATSAPP_CAPABILITIES: ChannelCapabilities = Object.freeze({
  typing: true,
  reactions: true,
  threads: false,
  embeds: false,
  attachments: true,
  messageEditing: false,
  maxMessageLength: 65_536,
});

export const EMAIL_CAPABILITIES: ChannelCapabilities = Object.freeze({
  ...DISABLED_CAPABILITIES,
  attachments: true,
});

export const MSTEAMS_CAPABILITIES: ChannelCapabilities = Object.freeze({
  typing: true,
  reactions: true,
  threads: true,
  embeds: true,
  attachments: true,
  messageEditing: true,
  maxMessageLength: 28_000,
});

export const SYSTEM_CAPABILITIES: ChannelCapabilities = Object.freeze({
  ...DISABLED_CAPABILITIES,
});
