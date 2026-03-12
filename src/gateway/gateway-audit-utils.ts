import type { StructuredAuditEntry } from '../types.js';

export function parseAuditPayload(
  entry: StructuredAuditEntry,
): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(entry.payload) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}
