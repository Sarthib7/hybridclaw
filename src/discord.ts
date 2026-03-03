import {
  ActivityType,
  AttachmentBuilder,
  Client,
  GatewayIntentBits,
  type Message as DiscordMessage,
  Partials,
} from 'discord.js';

import { DISCORD_PREFIX, DISCORD_TOKEN } from './config.js';
import { chunkMessage } from './chunk.js';
import { DiscordStreamManager } from './discord-stream.js';
import { logger } from './logger.js';

export type ReplyFn = (content: string, files?: AttachmentBuilder[]) => Promise<void>;

export interface MessageRunContext {
  sourceMessage: DiscordMessage;
  batchedMessages: DiscordMessage[];
  abortSignal: AbortSignal;
  stream: DiscordStreamManager;
}

export type MessageHandler = (
  sessionId: string,
  guildId: string | null,
  channelId: string,
  userId: string,
  username: string,
  content: string,
  reply: ReplyFn,
  context: MessageRunContext,
) => Promise<void>;

export type CommandHandler = (
  sessionId: string,
  guildId: string | null,
  channelId: string,
  args: string[],
  reply: ReplyFn,
) => Promise<void>;

let client: Client;
let messageHandler: MessageHandler;
let commandHandler: CommandHandler;
let activeConversationRuns = 0;
const MESSAGE_DEBOUNCE_MS = 2_500;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENT_CONTEXT_CHARS = 16_000;
const MAX_SINGLE_ATTACHMENT_CHARS = 8_000;
const DISCORD_RETRY_MAX_ATTEMPTS = 3;
const DISCORD_RETRY_BASE_DELAY_MS = 500;

interface DiscordErrorLike {
  status?: number;
  httpStatus?: number;
  retryAfter?: number;
  data?: {
    retry_after?: number;
  };
}

/**
 * Format an agent response as plain text.
 * Appends a subtle tools line if any tools were used.
 */
export function buildResponseText(text: string, toolsUsed?: string[]): string {
  let body = text;
  if (toolsUsed && toolsUsed.length > 0) {
    const toolsLine = `\n*Tools: ${toolsUsed.join(', ')}*`;
    body = `${text}${toolsLine}`;
  }
  return body;
}

export function formatInfo(title: string, body: string): string {
  return `**${title}**\n${body}`;
}

export function formatError(title: string, detail: string): string {
  return `**${title}:** ${detail}`;
}

function getSessionId(msg: DiscordMessage): string {
  return msg.guild ? `${msg.guild.id}:${msg.channelId}` : `dm:${msg.author.id}`;
}

function isTrigger(msg: DiscordMessage): boolean {
  if (client.user && msg.mentions.has(client.user)) return true;
  if (msg.content.startsWith(DISCORD_PREFIX)) return true;
  if (!msg.guild) return true;
  return false;
}

function parseCommand(content: string): { isCommand: boolean; command: string; args: string[] } {
  let text = content;

  if (client.user) {
    text = text.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();
  }

  if (text.startsWith(DISCORD_PREFIX)) {
    text = text.slice(DISCORD_PREFIX.length).trim();
  }

  const parts = text.split(/\s+/);
  const subcommands = ['bot', 'rag', 'model', 'status', 'sessions', 'audit', 'schedule', 'clear', 'help'];

  if (parts.length > 0 && subcommands.includes(parts[0].toLowerCase())) {
    return { isCommand: true, command: parts[0].toLowerCase(), args: parts.slice(1) };
  }

  return { isCommand: false, command: '', args: [] };
}

function isRetryableDiscordError(error: unknown): boolean {
  const maybe = error as DiscordErrorLike;
  const status = maybe.status ?? maybe.httpStatus;
  return status === 429 || (typeof status === 'number' && status >= 500 && status <= 599);
}

function retryDelayMs(error: unknown, fallbackMs: number): number {
  const maybe = error as DiscordErrorLike;
  const retryAfterSeconds = maybe.retryAfter ?? maybe.data?.retry_after;
  if (typeof retryAfterSeconds === 'number' && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.max(50, Math.ceil(retryAfterSeconds * 1_000));
  }
  return fallbackMs + Math.floor(Math.random() * 250);
}

async function withDiscordRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let attempt = 0;
  let delayMs = DISCORD_RETRY_BASE_DELAY_MS;
  while (true) {
    attempt += 1;
    try {
      return await fn();
    } catch (error) {
      if (attempt >= DISCORD_RETRY_MAX_ATTEMPTS || !isRetryableDiscordError(error)) {
        throw error;
      }
      const waitMs = retryDelayMs(error, delayMs);
      logger.warn({ label, attempt, waitMs, error }, 'Discord API call failed; retrying');
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      delayMs = Math.min(delayMs * 2, 4_000);
    }
  }
}

function cleanIncomingContent(content: string): string {
  let text = content;
  if (client.user) {
    text = text.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();
  }
  if (text.startsWith(DISCORD_PREFIX)) {
    text = text.slice(DISCORD_PREFIX.length).trim();
  }
  return text;
}

function summarizeContextMessage(msg: DiscordMessage): string {
  const author = msg.author?.username || 'user';
  const content = (msg.content || '').trim();
  const snippet = content.length > 500 ? `${content.slice(0, 497)}...` : content;
  return `${author}: ${snippet || '(no text)'}`;
}

function looksLikeTextAttachment(name: string, contentType: string): boolean {
  if (contentType.startsWith('text/')) return true;
  if (contentType.includes('json') || contentType.includes('xml') || contentType.includes('yaml')) return true;
  return /\.(txt|md|markdown|json|ya?ml|js|jsx|ts|tsx|py|rb|go|rs|java|c|cpp|h|hpp|cs|php|html?|css|scss|sql|log|csv)$/i.test(name);
}

async function fetchAttachmentText(url: string, maxChars: number): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const text = await response.text();
    if (!text) return null;
    if (text.length <= maxChars) return text;
    return `${text.slice(0, Math.max(1_000, maxChars - 32))}\n...[truncated]`;
  } catch {
    return null;
  }
}

async function buildReplyContext(msg: DiscordMessage): Promise<string> {
  const blocks: string[] = [];

  if ('isThread' in msg.channel && typeof msg.channel.isThread === 'function' && msg.channel.isThread()) {
    try {
      const starter = await msg.channel.fetchStarterMessage();
      if (starter) {
        blocks.push(`[Thread starter]\n${summarizeContextMessage(starter)}`);
      }
    } catch (error) {
      logger.debug({ error, channelId: msg.channelId }, 'Failed to fetch thread starter message');
    }
  }

  const replyLines: string[] = [];
  let replyId = msg.reference?.messageId || null;
  let depth = 0;
  while (replyId && depth < 5) {
    try {
      const referenced = await msg.channel.messages.fetch(replyId);
      replyLines.push(summarizeContextMessage(referenced));
      replyId = referenced.reference?.messageId || null;
      depth += 1;
    } catch {
      break;
    }
  }
  if (replyLines.length > 0) {
    blocks.push(`[Reply context]\n${replyLines.reverse().join('\n')}`);
  }

  if (blocks.length === 0) return '';
  return `${blocks.join('\n\n')}\n\n`;
}

async function buildAttachmentContext(messages: DiscordMessage[]): Promise<string> {
  const lines: string[] = [];
  let remainingChars = MAX_ATTACHMENT_CONTEXT_CHARS;

  for (const msg of messages) {
    if (!msg.attachments || msg.attachments.size === 0) continue;
    for (const attachment of msg.attachments.values()) {
      const name = attachment.name || 'unnamed';
      const size = attachment.size || 0;
      const contentType = (attachment.contentType || '').toLowerCase();
      if (size > MAX_ATTACHMENT_BYTES) {
        lines.push(`- ${name}: skipped (size ${size} bytes exceeds 10MB limit)`);
        continue;
      }

      if (contentType.startsWith('image/')) {
        lines.push(`- ${name}: image attachment (${size} bytes, ${contentType || 'unknown type'})`);
        continue;
      }

      if (looksLikeTextAttachment(name, contentType)) {
        const maxChars = Math.min(MAX_SINGLE_ATTACHMENT_CHARS, Math.max(500, remainingChars));
        const text = await fetchAttachmentText(attachment.url, maxChars);
        if (!text) {
          lines.push(`- ${name}: text attachment (failed to read content)`);
          continue;
        }

        const block = `- ${name} (text attachment):\n\`\`\`\n${text}\n\`\`\``;
        remainingChars -= block.length;
        lines.push(block);
        if (remainingChars <= 0) {
          lines.push('- Additional attachment content omitted (context budget reached).');
          return `[Attachments]\n${lines.join('\n')}\n\n`;
        }
        continue;
      }

      lines.push(`- ${name}: attachment (${size} bytes, ${contentType || 'unknown type'})`);
    }
  }

  if (lines.length === 0) return '';
  return `[Attachments]\n${lines.join('\n')}\n\n`;
}

async function addProcessingReaction(msg: DiscordMessage): Promise<() => Promise<void>> {
  if (!client.user) return async () => {};
  const botUserId = client.user.id;
  try {
    await withDiscordRetry('react', () => msg.react('👀'));
  } catch (error) {
    logger.debug({ error, channelId: msg.channelId, messageId: msg.id }, 'Failed to add processing reaction');
    return async () => {};
  }

  return async () => {
    try {
      const reaction = msg.reactions.resolve('👀');
      if (!reaction) return;
      await withDiscordRetry('reaction-remove', () => reaction.users.remove(botUserId));
    } catch (error) {
      logger.debug({ error, channelId: msg.channelId, messageId: msg.id }, 'Failed to remove processing reaction');
    }
  };
}

function startTypingLoop(msg: DiscordMessage): { stop: () => void } {
  let stopped = false;
  const sendTyping = async (): Promise<void> => {
    if (stopped) return;
    if (!('sendTyping' in msg.channel)) return;
    try {
      await msg.channel.sendTyping();
    } catch (error) {
      logger.debug({ error, channelId: msg.channelId }, 'Failed to send typing indicator');
    }
  };

  void sendTyping();
  const timer = setInterval(() => {
    void sendTyping();
  }, 8_000);

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
    },
  };
}

async function sendChunkedReply(
  msg: DiscordMessage,
  text: string,
  files?: AttachmentBuilder[],
): Promise<void> {
  const chunks = chunkMessage(text, { maxChars: 1_900, maxLines: 20 });
  const safeChunks = chunks.length > 0 ? chunks : ['(no content)'];

  for (let i = 0; i < safeChunks.length; i += 1) {
    const payload: { content: string; files?: AttachmentBuilder[] } = {
      content: safeChunks[i],
      ...(i === safeChunks.length - 1 && files && files.length > 0 ? { files } : {}),
    };
    if (i === 0) {
      await withDiscordRetry('reply', () => msg.reply(payload));
    } else {
      await withDiscordRetry('send', () => (msg.channel as unknown as {
        send: (next: { content: string; files?: AttachmentBuilder[] }) => Promise<void>;
      }).send(payload));
    }
  }
}

function updatePresence(): void {
  if (!client.user) return;
  if (activeConversationRuns > 0) {
    client.user.setPresence({
      activities: [{ name: 'Thinking...', type: ActivityType.Playing }],
      status: 'online',
    });
    return;
  }
  client.user.setPresence({
    activities: [{ name: `in ${client.guilds.cache.size} servers`, type: ActivityType.Listening }],
    status: 'online',
  });
}

export function initDiscord(onMessage: MessageHandler, onCommand: CommandHandler): Client {
  messageHandler = onMessage;
  commandHandler = onCommand;

  interface QueuedConversationMessage {
    msg: DiscordMessage;
    content: string;
    clearReaction: () => Promise<void>;
  }
  interface PendingConversationBatch {
    items: QueuedConversationMessage[];
    timer: ReturnType<typeof setTimeout>;
  }
  interface InFlightConversation {
    abortController: AbortController;
    stream: DiscordStreamManager;
    messageIds: Set<string>;
    aborted: boolean;
  }
  const pendingBatches = new Map<string, PendingConversationBatch>();
  const inFlightByMessageId = new Map<string, InFlightConversation>();
  const negativeFeedbackByChannel = new Map<string, string>();

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.User],
  });

  client.on('clientReady', () => {
    logger.info({ user: client.user?.tag }, 'Discord bot connected');
    updatePresence();
  });

  const dispatchConversationBatch = async (batchKey: string): Promise<void> => {
    const pending = pendingBatches.get(batchKey);
    if (!pending) return;
    pendingBatches.delete(batchKey);
    const items = pending.items;
    if (items.length === 0) return;

    const sourceItem = items[items.length - 1];
    const msg = sourceItem.msg;
    const sessionId = getSessionId(msg);
    const guildId = msg.guild?.id || null;
    const channelId = msg.channelId;
    const userId = msg.author.id;
    const username = msg.author.username;

    const batchedContent = items.length > 1
      ? items.map((item, index) => `Message ${index + 1}:\n${item.content}`).join('\n\n')
      : sourceItem.content;
    const replyContext = await buildReplyContext(msg);
    const feedbackNote = negativeFeedbackByChannel.get(channelId) || '';
    if (feedbackNote) {
      negativeFeedbackByChannel.delete(channelId);
    }
    const attachmentContext = await buildAttachmentContext(items.map((item) => item.msg));
    const combinedContent = `${feedbackNote ? `[Reaction feedback]\n${feedbackNote}\n\n` : ''}${replyContext}${attachmentContext}${batchedContent}`;

    const abortController = new AbortController();
    const typingLoop = startTypingLoop(msg);
    const stream = new DiscordStreamManager(msg, {
      onFirstMessage: () => typingLoop.stop(),
    });
    const inFlight: InFlightConversation = {
      abortController,
      stream,
      messageIds: new Set(items.map((item) => item.msg.id)),
      aborted: false,
    };
    for (const messageId of inFlight.messageIds) {
      inFlightByMessageId.set(messageId, inFlight);
    }

    try {
      activeConversationRuns += 1;
      updatePresence();
      await messageHandler(
        sessionId,
        guildId,
        channelId,
        userId,
        username,
        combinedContent,
        async (text, files) => {
          typingLoop.stop();
          await sendChunkedReply(msg, text, files);
        },
        {
          sourceMessage: msg,
          batchedMessages: items.map((item) => item.msg),
          abortSignal: abortController.signal,
          stream,
        },
      );
    } catch (error) {
      logger.error({ error, channelId, sessionId }, 'Conversation batch handling failed');
      const detail = error instanceof Error ? error.message : String(error);
      if (stream.hasSentMessages()) {
        await stream.fail(formatError('Gateway Error', detail));
      } else {
        await sendChunkedReply(msg, formatError('Gateway Error', detail));
      }
    } finally {
      activeConversationRuns = Math.max(0, activeConversationRuns - 1);
      updatePresence();
      for (const messageId of inFlight.messageIds) {
        if (inFlightByMessageId.get(messageId) === inFlight) {
          inFlightByMessageId.delete(messageId);
        }
      }
      typingLoop.stop();
      await Promise.all(items.map(async (item) => {
        await item.clearReaction();
      }));
    }
  };

  const queueConversationMessage = async (msg: DiscordMessage, content: string): Promise<void> => {
    const key = `${msg.channelId}:${msg.author.id}`;
    const clearReaction = await addProcessingReaction(msg);
    const queued: QueuedConversationMessage = { msg, content, clearReaction };
    const existing = pendingBatches.get(key);

    if (!existing) {
      const timer = setTimeout(() => {
        void dispatchConversationBatch(key);
      }, MESSAGE_DEBOUNCE_MS);
      pendingBatches.set(key, {
        items: [queued],
        timer,
      });
      return;
    }

    clearTimeout(existing.timer);
    existing.items.push(queued);
    existing.timer = setTimeout(() => {
      void dispatchConversationBatch(key);
    }, MESSAGE_DEBOUNCE_MS);
  };

  const dropPendingMessage = async (messageId: string): Promise<void> => {
    for (const [key, pending] of pendingBatches) {
      const index = pending.items.findIndex((item) => item.msg.id === messageId);
      if (index === -1) continue;
      const [removed] = pending.items.splice(index, 1);
      await removed.clearReaction();
      if (pending.items.length === 0) {
        clearTimeout(pending.timer);
        pendingBatches.delete(key);
      }
      return;
    }
  };

  const updatePendingMessage = async (
    messageId: string,
    nextMsg: DiscordMessage,
    nextContent: string,
  ): Promise<boolean> => {
    for (const [key, pending] of pendingBatches) {
      const index = pending.items.findIndex((item) => item.msg.id === messageId);
      if (index === -1) continue;

      if (!nextContent) {
        const [removed] = pending.items.splice(index, 1);
        await removed.clearReaction();
      } else {
        pending.items[index].msg = nextMsg;
        pending.items[index].content = nextContent;
      }

      if (pending.items.length === 0) {
        clearTimeout(pending.timer);
        pendingBatches.delete(key);
      }
      return true;
    }
    return false;
  };

  client.on('messageCreate', async (msg: DiscordMessage) => {
    if (msg.author.bot) return;
    if (!isTrigger(msg)) return;

    const sessionId = getSessionId(msg);
    const guildId = msg.guild?.id || null;
    const channelId = msg.channelId;

    const reply: ReplyFn = async (text, files) => {
      await sendChunkedReply(msg, text, files);
    };

    const content = cleanIncomingContent(msg.content);
    const parsed = parseCommand(msg.content);

    if (parsed.isCommand) {
      await commandHandler(sessionId, guildId, channelId, [parsed.command, ...parsed.args], reply);
      return;
    }

    if (!content) {
      await reply('How can I help? Send me a message or try `!claw help`.');
      return;
    }

    await queueConversationMessage(msg, content);
  });

  client.on('messageUpdate', async (_oldMsg, nextMsg) => {
    const fetched = nextMsg.partial
      ? await nextMsg.fetch().catch(() => null)
      : nextMsg;
    if (!fetched) return;
    if (fetched.author?.bot) return;

    const updatedContent = cleanIncomingContent(fetched.content || '');
    await updatePendingMessage(fetched.id, fetched, updatedContent);

    const inFlight = inFlightByMessageId.get(fetched.id);
    if (!inFlight || inFlight.aborted) return;
    inFlight.aborted = true;
    inFlight.abortController.abort();
    for (const messageId of inFlight.messageIds) {
      if (inFlightByMessageId.get(messageId) === inFlight) {
        inFlightByMessageId.delete(messageId);
      }
    }
    await inFlight.stream.discard();
    if (updatedContent) {
      await queueConversationMessage(fetched, updatedContent);
    }
  });

  client.on('messageDelete', async (msg) => {
    await dropPendingMessage(msg.id);
    const inFlight = inFlightByMessageId.get(msg.id);
    if (!inFlight || inFlight.aborted) return;
    inFlight.aborted = true;
    inFlight.abortController.abort();
    for (const messageId of inFlight.messageIds) {
      if (inFlightByMessageId.get(messageId) === inFlight) {
        inFlightByMessageId.delete(messageId);
      }
    }
    await inFlight.stream.discard();
  });

  client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    const fullReaction = reaction.partial
      ? await reaction.fetch().catch(() => null)
      : reaction;
    if (!fullReaction) return;
    if (fullReaction.emoji.name !== '👎') return;

    const message = fullReaction.message.partial
      ? await fullReaction.message.fetch().catch(() => null)
      : fullReaction.message;
    if (!message) return;
    if (!client.user || message.author?.id !== client.user.id) return;

    negativeFeedbackByChannel.set(
      message.channelId,
      `${user.username} reacted with 👎 to assistant message ${message.id}.`,
    );
  });

  if (!DISCORD_TOKEN) {
    throw new Error('DISCORD_TOKEN is required to start the Discord bot');
  }
  client.login(DISCORD_TOKEN);
  return client;
}

/**
 * Send a message to a channel by ID (used by scheduler).
 */
export async function sendToChannel(channelId: string, text: string, files?: AttachmentBuilder[]): Promise<void> {
  const channel = await client.channels.fetch(channelId);
  if (channel && 'send' in channel) {
    const chunks = chunkMessage(text, { maxChars: 1_900, maxLines: 20 });
    const safeChunks = chunks.length > 0 ? chunks : ['(no content)'];
    const send = (channel as unknown as {
      send: (payload: { content: string; files?: AttachmentBuilder[] }) => Promise<void>;
    }).send;
    for (let i = 0; i < safeChunks.length; i += 1) {
      await withDiscordRetry('send-channel', () => send({
        content: safeChunks[i],
        ...(i === safeChunks.length - 1 && files && files.length > 0 ? { files } : {}),
      }));
    }
  }
}
