function tokenizeCommandLabel(commandLabel: string): string[] {
  return commandLabel.trim().split(/\s+/).filter(Boolean);
}

export function resolveTuiCommandLabel(commandLabel: string): string {
  const [command] = tokenizeCommandLabel(commandLabel);
  if (command === undefined) {
    throw new Error(
      'resolveTuiCommandLabel requires a non-empty command label.',
    );
  }
  return `${command} tui`;
}

export function shouldPrintTuiStartHint(commandLabel: string): boolean {
  const tokens = tokenizeCommandLabel(commandLabel).map((token) =>
    token.toLowerCase(),
  );
  if (tokens.length < 2) return false;
  // This hint is reserved for the explicit onboarding command, not later auth flows.
  return tokens[1] === 'onboarding';
}
