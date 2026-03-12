import type { GatewayCommandResult } from './gateway/gateway-types.js';

export interface TuiFullAutoState {
  enabled: boolean;
  runtimeState: string | null;
}

export const DEFAULT_TUI_FULLAUTO_STATE: TuiFullAutoState = {
  enabled: false,
  runtimeState: null,
};

export function parseFullAutoStatusText(
  text: string | null | undefined,
): TuiFullAutoState | null {
  const normalized = String(text || '');
  const enabledMatch = normalized.match(/(?:^|\n)Enabled:\s*(yes|no)\b/i);
  if (!enabledMatch) return null;

  const stateMatch = normalized.match(/(?:^|\n)State:\s*([^\n\r]+)/i);
  return {
    enabled: enabledMatch[1]?.trim().toLowerCase() === 'yes',
    runtimeState: stateMatch?.[1]?.trim().toLowerCase() || null,
  };
}

export function deriveTuiFullAutoState(params: {
  current: TuiFullAutoState;
  args: string[];
  result: GatewayCommandResult;
}): TuiFullAutoState {
  const { current, args, result } = params;
  if (result.kind === 'error') return current;

  const command = (args[0] || '').trim().toLowerCase();
  if (command === 'stop' || command === 'abort') {
    return DEFAULT_TUI_FULLAUTO_STATE;
  }
  if (command !== 'fullauto') return current;

  const parsedStatus = parseFullAutoStatusText(result.text);
  if (parsedStatus) return parsedStatus;

  const sub = (args[1] || '').trim().toLowerCase();
  if (sub === 'off' || sub === 'disable' || sub === 'stop') {
    return DEFAULT_TUI_FULLAUTO_STATE;
  }

  if (
    result.title === 'Full-Auto Enabled' ||
    /full-auto mode enabled/i.test(result.text)
  ) {
    return {
      enabled: true,
      runtimeState: 'armed',
    };
  }

  if (/full-auto mode disabled/i.test(result.text)) {
    return DEFAULT_TUI_FULLAUTO_STATE;
  }

  return current;
}

export function formatTuiFullAutoPromptLabel(
  state: TuiFullAutoState,
): string | null {
  if (!state.enabled) return null;
  const runtimeState = state.runtimeState?.trim().toLowerCase() || '';
  if (!runtimeState || runtimeState === 'running') return 'fullauto';
  return `fullauto:${runtimeState}`;
}

export function shouldRouteTuiInputToFullAuto(
  state: TuiFullAutoState,
): boolean {
  return state.enabled;
}
