import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { stringify as stringifyYaml } from 'yaml';

function trimTextValue(value) {
  return String(value || '')
    .replace(/\r/g, '')
    .trim();
}

function sanitizeSessionId(sessionId) {
  const raw = String(sessionId || '').trim();
  const normalized = raw
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (normalized) return normalized;
  const suffix = createHash('sha256').update(raw).digest('hex').slice(0, 12);
  return `session-${suffix}`;
}

function formatMessageSection(message, index) {
  const role = trimTextValue(message.role) || 'unknown';
  const createdAt = trimTextValue(message.created_at) || 'unknown-time';
  const username = trimTextValue(message.username);
  const heading = username
    ? `## ${index + 1}. ${role} (${username}) · ${createdAt}`
    : `## ${index + 1}. ${role} · ${createdAt}`;
  const content = trimTextValue(message.content) || '_Empty message_';
  return [heading, '', content].join('\n');
}

export function buildSessionExportMarkdown(params) {
  const exportedAt = new Date().toISOString();
  const frontmatterData = {
    sessionId: String(params.sessionId || ''),
    userId: String(params.userId || ''),
    agentId: String(params.agentId || ''),
    exportedAt,
    messageCount: params.messages.length,
  };
  const frontmatter = [
    '---',
    stringifyYaml(frontmatterData).trimEnd(),
    '---',
  ].join('\n');

  const summary = [
    `# HybridClaw Session ${params.sessionId}`,
    '',
    `- User: ${params.userId}`,
    `- Agent: ${params.agentId}`,
    `- Exported at: ${exportedAt}`,
    `- Message count: ${params.messages.length}`,
    '',
    '## Transcript',
    '',
  ].join('\n');

  const transcript = params.messages
    .map((message, index) => formatMessageSection(message, index))
    .join('\n\n');

  return `${frontmatter}\n\n${summary}${transcript}\n`;
}

export async function writeSessionExport(params) {
  await fs.mkdir(params.exportDir, { recursive: true });
  const filePath = path.join(
    params.exportDir,
    `${sanitizeSessionId(params.sessionId)}.md`,
  );
  const markdown = buildSessionExportMarkdown(params);
  await fs.writeFile(filePath, markdown, 'utf-8');
  return filePath;
}
