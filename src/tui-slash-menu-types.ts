export interface TuiSlashMenuPalette {
  reset: string;
  separator: string;
  marker: string;
  markerSelected: string;
  command: string;
  commandSelected: string;
  description: string;
  descriptionSelected: string;
}

export interface TuiSlashMenuEntry {
  id: string;
  label: string;
  insertText: string;
  description: string;
  searchTerms: string[];
  depth: number;
  sortIndex: number;
}
