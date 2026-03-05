export type SandboxModeOverride = 'container' | 'host';

export interface ParsedGatewayFlags {
  foreground: boolean;
  help: boolean;
  sandboxMode: SandboxModeOverride | null;
}

function normalizeSandboxMode(value: string): SandboxModeOverride | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'container') return 'container';
  if (normalized === 'host') return 'host';
  return null;
}

export function hasSandboxFlag(argv: string[]): boolean {
  return argv.some((arg) => {
    const normalized = String(arg || '').trim();
    return normalized === '--sandbox' || normalized.startsWith('--sandbox=');
  });
}

export function parseGatewayFlags(argv: string[]): ParsedGatewayFlags {
  let foreground = false;
  let help = false;
  let sandboxMode: SandboxModeOverride | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] || '').trim();
    if (!arg) continue;

    if (arg === '--foreground' || arg === '-f') {
      foreground = true;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }

    if (arg === '--sandbox') {
      const next = String(argv[i + 1] || '').trim();
      const parsed = normalizeSandboxMode(next);
      if (!parsed) {
        throw new Error(
          `Invalid value for --sandbox: ${next || '<missing>'}. Use --sandbox=container or --sandbox=host.`,
        );
      }
      sandboxMode = parsed;
      i += 1;
      continue;
    }

    if (arg.startsWith('--sandbox=')) {
      const parsed = normalizeSandboxMode(arg.slice('--sandbox='.length));
      if (!parsed) {
        throw new Error(
          `Invalid value for --sandbox: ${arg.slice('--sandbox='.length) || '<missing>'}. Use --sandbox=container or --sandbox=host.`,
        );
      }
      sandboxMode = parsed;
      continue;
    }

    throw new Error(`Unexpected gateway lifecycle option: ${arg}`);
  }

  return { foreground, help, sandboxMode };
}
