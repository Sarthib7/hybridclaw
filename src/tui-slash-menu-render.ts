import type {
  TuiSlashMenuEntry,
  TuiSlashMenuPalette,
} from './tui-slash-menu-types.js';

const MAX_VISIBLE_ITEMS = 7;
const MAX_DESCRIPTION_LINES = 3;

function truncateToWidth(text: string, width: number): string {
  if (width <= 0) return '';
  if (text.length <= width) return text.padEnd(width, ' ');
  if (width <= 3) return '.'.repeat(width);
  return `${text.slice(0, width - 3)}...`;
}

function wrapToWidth(
  text: string,
  width: number,
  maxLines = MAX_DESCRIPTION_LINES,
): string[] {
  if (width <= 0) return [];
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];

  const lines: string[] = [];
  let current = words[0] || '';

  for (let i = 1; i < words.length; i += 1) {
    const word = words[i] || '';
    if (`${current} ${word}`.length <= width) {
      current = `${current} ${word}`;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length === maxLines - 1) break;
  }

  if (lines.length < maxLines && current) {
    lines.push(current);
  }

  if (lines.length === maxLines) {
    const consumedWords = lines.join(' ').split(/\s+/).filter(Boolean).length;
    if (consumedWords < words.length) {
      lines[maxLines - 1] = truncateToWidth(
        `${lines[maxLines - 1] || ''} ...`.trim(),
        width,
      );
    }
  }

  return lines.slice(0, maxLines).map((line) => truncateToWidth(line, width));
}

function visibleWindowBounds(params: {
  itemCount: number;
  selectedIndex: number;
  availableRows: number;
  selectedItemHeight: number;
}): [number, number] {
  const selectedItemHeight = Math.min(
    params.selectedItemHeight,
    params.availableRows,
  );
  let remainingRows = Math.max(0, params.availableRows - selectedItemHeight);

  let before = Math.min(1, params.selectedIndex, remainingRows);
  remainingRows -= before;
  let after = Math.min(
    params.itemCount - params.selectedIndex - 1,
    remainingRows,
  );
  remainingRows -= after;

  const extraBefore = Math.min(params.selectedIndex - before, remainingRows);
  before += extraBefore;
  remainingRows -= extraBefore;

  const extraAfter = Math.min(
    params.itemCount - params.selectedIndex - 1 - after,
    remainingRows,
  );
  after += extraAfter;

  return [params.selectedIndex - before, params.selectedIndex + after];
}

export function renderTuiSlashMenuLines(params: {
  query: string;
  entries: TuiSlashMenuEntry[];
  selectedIndex: number;
  width: number;
  palette: TuiSlashMenuPalette;
}): string[] {
  const width = Math.max(40, params.width || 80);
  const separator = `${params.palette.separator}${'─'.repeat(width)}${params.palette.reset}`;

  if (params.entries.length === 0) {
    const queryText = params.query ? `/${params.query}` : '/';
    const message = truncateToWidth(
      `No slash commands match "${queryText}".`,
      width,
    );
    return [
      separator,
      `${params.palette.description}${message}${params.palette.reset}`,
    ];
  }

  const longestCommand = Math.max(
    ...params.entries.map((entry) => entry.label.length),
    12,
  );
  const markerWidth = 2;
  const commandWidth = Math.min(
    Math.max(longestCommand + 2, 18),
    Math.max(18, Math.floor(width / 2)),
  );
  const gapWidth = width > commandWidth + 12 ? 3 : 1;
  const descriptionWidth = Math.max(
    8,
    width - markerWidth - commandWidth - gapWidth,
  );

  const selectedEntry =
    params.entries[params.selectedIndex] || params.entries[0] || null;
  const selectedDescriptionLines = wrapToWidth(
    selectedEntry?.description || '',
    descriptionWidth,
  );

  const [start, end] = visibleWindowBounds({
    itemCount: params.entries.length,
    selectedIndex: params.selectedIndex,
    availableRows: MAX_VISIBLE_ITEMS,
    selectedItemHeight: Math.max(1, selectedDescriptionLines.length),
  });

  const lines = [separator];
  for (let index = start; index <= end; index += 1) {
    const entry = params.entries[index];
    if (!entry) continue;
    const isSelected = index === params.selectedIndex;
    const descriptionLines = isSelected
      ? selectedDescriptionLines
      : [
          truncateToWidth(
            entry.description,
            descriptionWidth,
          ).padEnd(descriptionWidth, ' '),
        ];
    const marker = isSelected ? '› ' : '  ';
    const commandText = truncateToWidth(entry.label, commandWidth);
    const descriptionText = descriptionLines[0] || ''.padEnd(descriptionWidth);
    lines.push(
      `${isSelected ? params.palette.markerSelected : params.palette.marker}${marker}${params.palette.reset}${isSelected ? params.palette.commandSelected : params.palette.command}${commandText}${params.palette.reset}${' '.repeat(gapWidth)}${isSelected ? params.palette.descriptionSelected : params.palette.description}${descriptionText}${params.palette.reset}`,
    );

    if (!isSelected || descriptionLines.length <= 1) continue;

    const continuationPrefix =
      ' '.repeat(markerWidth) +
      ' '.repeat(commandWidth) +
      ' '.repeat(gapWidth);
    for (const descriptionLine of descriptionLines.slice(1)) {
      lines.push(
        `${continuationPrefix}${params.palette.descriptionSelected}${descriptionLine}${params.palette.reset}`,
      );
    }
  }

  return lines;
}
