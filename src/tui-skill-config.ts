import readline from 'node:readline';
import type { SkillConfigChannelKind } from './channels/channel.js';
import type {
  GatewayAdminSkill,
  GatewayAdminSkillsResponse,
} from './gateway/gateway-types.js';

export const TUI_SKILL_CONFIG_SCOPES = [
  'global',
  'discord',
  'msteams',
  'whatsapp',
  'email',
] as const;

export type TuiSkillConfigScope = (typeof TUI_SKILL_CONFIG_SCOPES)[number];

export interface TuiSkillConfigPalette {
  reset: string;
  bold: string;
  muted: string;
  teal: string;
  gold: string;
  green: string;
  red: string;
}

export interface TuiSkillConfigDraft {
  disabled: Set<string>;
  channelDisabled: Partial<Record<SkillConfigChannelKind, Set<string>>>;
}

export interface TuiSkillConfigMutation {
  name: string;
  enabled: boolean;
  channel?: SkillConfigChannelKind;
}

export interface TuiSkillConfigResult {
  cancelled: boolean;
  savedCount: number;
  changedScopeCount: number;
}

interface InternalReadline extends readline.Interface {
  line: string;
  cursor: number;
  _ttyWrite?: (chunk: string, key: readline.Key) => void;
}

function normalizeNameSet(values: string[] | undefined): Set<string> {
  return new Set(
    (values ?? []).map((value) => String(value || '').trim()).filter(Boolean),
  );
}

export function getTuiSkillConfigChannel(
  scope: TuiSkillConfigScope,
): SkillConfigChannelKind | undefined {
  return scope === 'global' ? undefined : scope;
}

export function createTuiSkillConfigDraft(
  response: GatewayAdminSkillsResponse,
): TuiSkillConfigDraft {
  return {
    disabled: normalizeNameSet(response.disabled),
    channelDisabled: {
      discord: normalizeNameSet(response.channelDisabled.discord),
      msteams: normalizeNameSet(response.channelDisabled.msteams),
      whatsapp: normalizeNameSet(response.channelDisabled.whatsapp),
      email: normalizeNameSet(response.channelDisabled.email),
    },
  };
}

export function getTuiSkillScopeDisabledNames(
  draft: TuiSkillConfigDraft,
  scope: TuiSkillConfigScope,
): Set<string> {
  const channel = getTuiSkillConfigChannel(scope);
  return channel
    ? (draft.channelDisabled[channel] ?? new Set())
    : draft.disabled;
}

export function isTuiSkillEnabledInScope(
  draft: TuiSkillConfigDraft,
  skillName: string,
  scope: TuiSkillConfigScope,
): boolean {
  return !getTuiSkillScopeDisabledNames(draft, scope).has(skillName);
}

export function setTuiSkillEnabledInScope(
  draft: TuiSkillConfigDraft,
  skillName: string,
  enabled: boolean,
  scope: TuiSkillConfigScope,
): void {
  const channel = getTuiSkillConfigChannel(scope);
  let disabled = draft.disabled;
  if (channel) {
    if (!draft.channelDisabled[channel]) {
      draft.channelDisabled[channel] = new Set();
    }
    disabled = draft.channelDisabled[channel];
  }
  if (enabled) {
    disabled.delete(skillName);
  } else {
    disabled.add(skillName);
  }
}

export function collectTuiSkillConfigMutations(
  response: GatewayAdminSkillsResponse,
  draft: TuiSkillConfigDraft,
): TuiSkillConfigMutation[] {
  const skills = response.skills.map((skill) => skill.name);
  const mutations: TuiSkillConfigMutation[] = [];

  for (const scope of TUI_SKILL_CONFIG_SCOPES) {
    const channel = getTuiSkillConfigChannel(scope);
    const initialDisabled = channel
      ? normalizeNameSet(response.channelDisabled[channel])
      : normalizeNameSet(response.disabled);
    const nextDisabled = getTuiSkillScopeDisabledNames(draft, scope);

    for (const skillName of skills) {
      const initiallyEnabled = !initialDisabled.has(skillName);
      const nextEnabled = !nextDisabled.has(skillName);
      if (initiallyEnabled === nextEnabled) continue;
      mutations.push({
        name: skillName,
        enabled: nextEnabled,
        channel,
      });
    }
  }

  return mutations;
}

function countChangedScopes(mutations: TuiSkillConfigMutation[]): number {
  return new Set(mutations.map((mutation) => mutation.channel ?? 'global'))
    .size;
}

function truncateLine(value: string, width: number): string {
  if (width <= 0) return '';
  if (value.length <= width) return value;
  if (width === 1) return value.slice(0, 1);
  return `${value.slice(0, width - 1)}…`;
}

function scopeTab(
  scope: TuiSkillConfigScope,
  active: boolean,
  palette: TuiSkillConfigPalette,
): string {
  if (!active) return `${palette.muted}${scope}${palette.reset}`;
  return `${palette.bold}${palette.gold}[${scope}]${palette.reset}`;
}

function skillNotes(
  skill: GatewayAdminSkill,
  draft: TuiSkillConfigDraft,
  scope: TuiSkillConfigScope,
): string {
  const notes: string[] = [];
  if (scope !== 'global' && draft.disabled.has(skill.name)) {
    notes.push('global disable still applies');
  }
  if (!skill.available) {
    notes.push(
      `missing: ${skill.missing.length > 0 ? skill.missing.join(', ') : 'requirements'}`,
    );
  }
  if (skill.always) {
    notes.push('always');
  }
  return notes.join(' · ');
}

export function renderTuiSkillConfigLines(params: {
  response: GatewayAdminSkillsResponse;
  draft: TuiSkillConfigDraft;
  scope: TuiSkillConfigScope;
  cursor: number;
  scrollOffset: number;
  width: number;
  height: number;
  palette: TuiSkillConfigPalette;
  saving?: boolean;
}): { lines: string[]; scrollOffset: number } {
  const {
    response,
    draft,
    scope,
    cursor,
    width,
    height,
    palette,
    saving = false,
  } = params;
  const safeWidth = Math.max(20, width);
  const headerLines = 5;
  const footerLines = 2;
  const visibleRows = Math.max(1, height - headerLines - footerLines);
  let scrollOffset = Math.max(0, params.scrollOffset);

  if (cursor < scrollOffset) {
    scrollOffset = cursor;
  } else if (cursor >= scrollOffset + visibleRows) {
    scrollOffset = cursor - visibleRows + 1;
  }

  const skills = response.skills;
  const currentDisabled = getTuiSkillScopeDisabledNames(draft, scope);
  const mutations = collectTuiSkillConfigMutations(response, draft);
  const selectedSkill = skills[cursor];
  const lines = [
    truncateLine(
      `  ${palette.bold}${palette.gold}Skill Config${palette.reset}`,
      safeWidth,
    ),
    truncateLine(
      `  ${palette.muted}Scopes:${palette.reset} ${TUI_SKILL_CONFIG_SCOPES.map(
        (item) => scopeTab(item, item === scope, palette),
      ).join('  ')}`,
      safeWidth,
    ),
    truncateLine(
      `  ${palette.muted}${saving ? 'Saving changes...' : '↑↓ move  ←→ scope  SPACE toggle  ENTER save  ESC cancel'}${palette.reset}`,
      safeWidth,
    ),
    truncateLine(
      `  ${palette.muted}Checked = enabled in the selected scope. Global disables still apply inside channel scopes.${palette.reset}`,
      safeWidth,
    ),
    truncateLine(
      `  ${palette.teal}${scope}${palette.reset} scope: ${skills.length - currentDisabled.size} enabled, ${currentDisabled.size} disabled${mutations.length > 0 ? ` ${palette.muted}|${palette.reset} ${palette.gold}${mutations.length} unsaved${palette.reset}` : ''}`,
      safeWidth,
    ),
  ];

  for (const [visibleIndex, skill] of skills
    .slice(scrollOffset, scrollOffset + visibleRows)
    .entries()) {
    const index = scrollOffset + visibleIndex;
    const active = index === cursor;
    const enabled = isTuiSkillEnabledInScope(draft, skill.name, scope);
    const arrow = active
      ? `${palette.gold}→${palette.reset}`
      : `${palette.muted} ${palette.reset}`;
    const checkbox = enabled
      ? `${palette.green}[x]${palette.reset}`
      : `${palette.red}[ ]${palette.reset}`;
    const notes = skillNotes(skill, draft, scope);
    lines.push(
      truncateLine(
        ` ${arrow} ${checkbox} ${skill.name}${notes ? ` ${palette.muted}— ${notes}${palette.reset}` : ''}`,
        safeWidth,
      ),
    );
  }

  if (selectedSkill) {
    const footerNotes = [
      selectedSkill.description || 'No description.',
      selectedSkill.source ? `source: ${selectedSkill.source}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    lines.push(
      truncateLine(
        `  ${palette.bold}${selectedSkill.name}${palette.reset} ${palette.muted}— ${footerNotes}${palette.reset}`,
        safeWidth,
      ),
    );
  } else {
    lines.push(
      truncateLine(
        `  ${palette.muted}No skills found.${palette.reset}`,
        safeWidth,
      ),
    );
  }

  const rangeStart = skills.length === 0 ? 0 : scrollOffset + 1;
  const rangeEnd = Math.min(skills.length, scrollOffset + visibleRows);
  lines.push(
    truncateLine(
      `  ${palette.muted}Showing ${rangeStart}-${rangeEnd} of ${skills.length}${palette.reset}`,
      safeWidth,
    ),
  );

  return {
    lines,
    scrollOffset,
  };
}

export async function promptTuiSkillConfig(params: {
  rl: readline.Interface;
  response: GatewayAdminSkillsResponse;
  saveMutation: (mutation: TuiSkillConfigMutation) => Promise<unknown>;
  palette: TuiSkillConfigPalette;
  output?: NodeJS.WriteStream;
}): Promise<TuiSkillConfigResult> {
  const { rl, response, saveMutation, palette } = params;
  const output = params.output || process.stdout;
  const internal = rl as InternalReadline;
  const originalTtyWrite = internal._ttyWrite?.bind(internal);
  const draft = createTuiSkillConfigDraft(response);
  const skills = response.skills;

  if (!output.isTTY || !originalTtyWrite) {
    return {
      cancelled: false,
      savedCount: 0,
      changedScopeCount: 0,
    };
  }

  let renderedLineCount = 0;
  let cursor = 0;
  let scopeIndex = 0;
  let scrollOffset = 0;
  let saving = false;

  const clear = () => {
    if (renderedLineCount <= 0) return;
    readline.moveCursor(output, 0, -(renderedLineCount - 1));
    readline.cursorTo(output, 0);
    readline.clearScreenDown(output);
    renderedLineCount = 0;
  };

  const render = () => {
    clear();
    const rendered = renderTuiSkillConfigLines({
      response,
      draft,
      scope: TUI_SKILL_CONFIG_SCOPES[scopeIndex] ?? 'global',
      cursor,
      scrollOffset,
      width: output.columns || 80,
      height: output.rows || 24,
      palette,
      saving,
    });
    scrollOffset = rendered.scrollOffset;
    output.write('\x1b[?25l');
    output.write(rendered.lines.join('\n'));
    renderedLineCount = rendered.lines.length;
  };

  const restore = () => {
    clear();
    output.write('\x1b[?25h');
    internal._ttyWrite = originalTtyWrite;
    output.off('resize', render);
  };

  return new Promise<TuiSkillConfigResult>((resolve, reject) => {
    const finish = (result: TuiSkillConfigResult) => {
      restore();
      resolve(result);
    };

    const fail = (error: unknown) => {
      restore();
      reject(error);
    };

    internal._ttyWrite = (_chunk: string, key: readline.Key) => {
      if (saving) return;

      const scope = TUI_SKILL_CONFIG_SCOPES[scopeIndex] ?? 'global';

      if (key.ctrl === true && key.name === 'c') {
        finish({
          cancelled: true,
          savedCount: 0,
          changedScopeCount: 0,
        });
        return;
      }

      if (key.name === 'escape' || key.name === 'q') {
        finish({
          cancelled: true,
          savedCount: 0,
          changedScopeCount: 0,
        });
        return;
      }

      if (key.name === 'left' || key.name === 'h') {
        scopeIndex =
          (scopeIndex - 1 + TUI_SKILL_CONFIG_SCOPES.length) %
          TUI_SKILL_CONFIG_SCOPES.length;
        render();
        return;
      }

      if (key.name === 'right' || key.name === 'l') {
        scopeIndex = (scopeIndex + 1) % TUI_SKILL_CONFIG_SCOPES.length;
        render();
        return;
      }

      if (key.name === 'up' || key.name === 'k') {
        cursor = (cursor - 1 + skills.length) % Math.max(1, skills.length);
        render();
        return;
      }

      if (key.name === 'down' || key.name === 'j') {
        cursor = (cursor + 1) % Math.max(1, skills.length);
        render();
        return;
      }

      if (key.name === 'space') {
        const selected = skills[cursor];
        if (!selected) return;
        const enabled = isTuiSkillEnabledInScope(draft, selected.name, scope);
        setTuiSkillEnabledInScope(draft, selected.name, !enabled, scope);
        render();
        return;
      }

      if (key.name === 'return' || key.name === 'enter') {
        const mutations = collectTuiSkillConfigMutations(response, draft);
        if (mutations.length === 0) {
          finish({
            cancelled: false,
            savedCount: 0,
            changedScopeCount: 0,
          });
          return;
        }

        saving = true;
        render();
        void (async () => {
          try {
            for (const mutation of mutations) {
              await saveMutation(mutation);
            }
            finish({
              cancelled: false,
              savedCount: mutations.length,
              changedScopeCount: countChangedScopes(mutations),
            });
          } catch (error) {
            fail(error);
          }
        })();
      }
    };

    output.on('resize', render);
    render();
  });
}
