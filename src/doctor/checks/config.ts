import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { listKnownToolNames } from '../../agent/tool-summary.js';
import {
  CONFIG_VERSION,
  ensureRuntimeConfigFile,
  getRuntimeConfig,
  getRuntimeDisabledToolNames,
  runtimeConfigPath,
  setRuntimeToolEnabled,
  updateRuntimeConfig,
} from '../../config/runtime-config.js';
import { getToolUsageSummary, type ToolUsageSummary } from '../../memory/db.js';
import type { DiagResult } from '../types.js';
import {
  buildChmodFix,
  formatMode,
  isGroupOrWorldWritable,
  makeResult,
  readUnixMode,
  shortenHomePath,
  toErrorMessage,
} from '../utils.js';

const UNUSED_WINDOW_DAYS = 30;

type UsageEntry = {
  name: string;
  lastUsedAt: string | null;
};

function buildUnusedWindowStart(days = UNUSED_WINDOW_DAYS): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function formatLastUsedAt(lastUsedAt: string | null): string {
  if (!lastUsedAt) return 'never';
  return lastUsedAt.slice(0, 10);
}

function formatUnusedEntries(entries: UsageEntry[]): string {
  return entries
    .map(
      (entry) =>
        `${entry.name} (last used ${formatLastUsedAt(entry.lastUsedAt)})`,
    )
    .join(', ');
}

function stableHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 8);
}

function sanitizeToolSegment(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return sanitized || 'tool';
}

function buildServerNamespaces(
  serverNames: Iterable<string>,
): Map<string, string> {
  const names = [...serverNames].sort((left, right) =>
    left.localeCompare(right),
  );
  const counts = new Map<string, number>();

  for (const name of names) {
    const sanitized = sanitizeToolSegment(name);
    counts.set(sanitized, (counts.get(sanitized) || 0) + 1);
  }

  const namespaces = new Map<string, string>();
  const used = new Set<string>();
  for (const name of names) {
    const sanitized = sanitizeToolSegment(name);
    const trimmed = name.trim();
    const needsHash = sanitized !== trimmed || (counts.get(sanitized) || 0) > 1;
    const base = needsHash ? `${sanitized}_${stableHash(name)}` : sanitized;

    let candidate = base;
    let suffix = 1;
    while (used.has(candidate)) {
      candidate = `${base}_${stableHash(`${name}:${suffix}`)}`;
      suffix += 1;
    }

    used.add(candidate);
    namespaces.set(name, candidate);
  }

  return namespaces;
}

function buildUnusedToolsResult(usage: ToolUsageSummary[]): DiagResult | null {
  if (usage.length === 0) return null;

  const config = getRuntimeConfig();
  const disabled = getRuntimeDisabledToolNames(config);
  const enabledTools = listKnownToolNames().filter(
    (name) => !disabled.has(name),
  );
  const usageByTool = new Map(usage.map((entry) => [entry.toolName, entry]));
  const unused = enabledTools
    .filter((name) => (usageByTool.get(name)?.callsSinceCutoff || 0) === 0)
    .map((name) => ({
      name,
      lastUsedAt: usageByTool.get(name)?.lastUsedAt || null,
    }));

  if (unused.length === 0) return null;

  const previousDisabled = new Set(config.tools.disabled);
  const toolNames = unused.map((entry) => entry.name);
  return makeResult(
    'config',
    'Unused tools',
    'warn',
    `${unused.length} enabled tool${unused.length === 1 ? '' : 's'} unused in the last ${UNUSED_WINDOW_DAYS} days: ${formatUnusedEntries(unused)}. Re-enable with \`hybridclaw tool enable <name>\`.`,
    {
      summary: `Disable unused tools: ${toolNames.join(', ')}`,
      apply: async () => {
        updateRuntimeConfig((draft) => {
          for (const toolName of toolNames) {
            setRuntimeToolEnabled(draft, toolName, false);
          }
        });
      },
      rollback: async () => {
        updateRuntimeConfig((draft) => {
          for (const toolName of toolNames) {
            setRuntimeToolEnabled(
              draft,
              toolName,
              !previousDisabled.has(toolName),
            );
          }
        });
      },
    },
  );
}

function findServerLastUsedAt(
  namespace: string,
  usage: ToolUsageSummary[],
): string | null {
  let lastUsedAt: string | null = null;
  for (const entry of usage) {
    if (!entry.toolName.startsWith(`${namespace}__`)) continue;
    if (!lastUsedAt || (entry.lastUsedAt && entry.lastUsedAt > lastUsedAt)) {
      lastUsedAt = entry.lastUsedAt;
    }
  }
  return lastUsedAt;
}

function buildUnusedMcpServersResult(
  usage: ToolUsageSummary[],
): DiagResult | null {
  if (usage.length === 0) return null;

  const config = getRuntimeConfig();
  const enabledServers = Object.entries(config.mcpServers || {}).filter(
    ([, serverConfig]) => serverConfig.enabled !== false,
  );
  if (enabledServers.length === 0) return null;

  const namespaces = buildServerNamespaces(
    enabledServers.map(([name]) => name),
  );
  const unused = enabledServers
    .filter(([name]) => {
      const namespace = namespaces.get(name);
      if (!namespace) return false;
      return !usage.some(
        (entry) =>
          entry.toolName.startsWith(`${namespace}__`) &&
          entry.callsSinceCutoff > 0,
      );
    })
    .map(([name]) => ({
      name,
      lastUsedAt: findServerLastUsedAt(namespaces.get(name) || '', usage),
    }));

  if (unused.length === 0) return null;

  const previousEnabled = new Map(
    enabledServers.map(([name, serverConfig]) => [
      name,
      serverConfig.enabled !== false,
    ]),
  );
  const serverNames = unused.map((entry) => entry.name);
  return makeResult(
    'config',
    'Unused MCP servers',
    'warn',
    `${unused.length} enabled MCP server${unused.length === 1 ? '' : 's'} unused in the last ${UNUSED_WINDOW_DAYS} days: ${formatUnusedEntries(unused)}. Re-enable with \`hybridclaw gateway mcp toggle <name>\`.`,
    {
      summary: `Disable unused MCP servers: ${serverNames.join(', ')}`,
      apply: async () => {
        updateRuntimeConfig((draft) => {
          for (const serverName of serverNames) {
            const entry = draft.mcpServers[serverName];
            if (entry) entry.enabled = false;
          }
        });
      },
      rollback: async () => {
        updateRuntimeConfig((draft) => {
          for (const serverName of serverNames) {
            const entry = draft.mcpServers[serverName];
            if (!entry) continue;
            entry.enabled = previousEnabled.get(serverName) !== false;
          }
        });
      },
    },
  );
}

export async function checkConfig(): Promise<DiagResult[]> {
  const filePath = runtimeConfigPath();
  const displayPath = shortenHomePath(filePath);

  if (!fs.existsSync(filePath)) {
    return [
      makeResult('config', 'Config', 'error', `${displayPath} is missing`, {
        summary: `Create ${displayPath}`,
        apply: async () => {
          ensureRuntimeConfigFile();
        },
      }),
    ];
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
  } catch (error) {
    return [
      makeResult(
        'config',
        'Config',
        'error',
        `${displayPath} is not valid JSON (${toErrorMessage(error)})`,
      ),
    ];
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return [
      makeResult(
        'config',
        'Config',
        'error',
        `${displayPath} must contain a top-level object`,
      ),
    ];
  }

  const config = getRuntimeConfig();
  const mode = readUnixMode(filePath);
  const writableByOthers = isGroupOrWorldWritable(mode);
  const missingFields = [
    config.hybridai.defaultModel.trim() ? null : 'hybridai.defaultModel',
    config.ops.dbPath.trim() ? null : 'ops.dbPath',
    config.container.image.trim() ? null : 'container.image',
  ].filter(Boolean) as string[];

  if (missingFields.length > 0) {
    return [
      makeResult(
        'config',
        'Config',
        'error',
        `${displayPath} missing required field${missingFields.length === 1 ? '' : 's'}: ${missingFields.join(', ')}`,
      ),
    ];
  }

  const version =
    typeof (raw as { version?: unknown }).version === 'number'
      ? (raw as { version: number }).version
      : null;
  const severity = writableByOthers ? 'warn' : 'ok';
  const message =
    version === CONFIG_VERSION
      ? `${displayPath} valid (v${CONFIG_VERSION})${writableByOthers ? `, permissions ${formatMode(mode)}` : ''}`
      : `${displayPath} valid${version == null ? '' : ` (v${version})`}${writableByOthers ? `, permissions ${formatMode(mode)}` : ''}`;

  const results: DiagResult[] = [
    makeResult(
      'config',
      'Config',
      severity,
      message,
      writableByOthers
        ? buildChmodFix(filePath, 0o600, `Restrict ${displayPath} permissions`)
        : undefined,
    ),
  ];

  const usage = getToolUsageSummary({
    sinceTimestamp: buildUnusedWindowStart(),
  });
  const unusedTools = buildUnusedToolsResult(usage);
  if (unusedTools) results.push(unusedTools);
  const unusedMcpServers = buildUnusedMcpServersResult(usage);
  if (unusedMcpServers) results.push(unusedMcpServers);

  return results;
}
