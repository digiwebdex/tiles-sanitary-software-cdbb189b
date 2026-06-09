import { createHash } from 'crypto';

/** Mirrors frontend `approvalService.sortAndClean` for hash parity. */
function sortAndClean(obj: unknown): unknown {
  if (obj === null || obj === undefined) return undefined;
  if (typeof obj === 'number') return obj;
  if (typeof obj === 'string') return obj;
  if (typeof obj === 'boolean') return obj;

  if (Array.isArray(obj)) {
    const cleaned = obj.map(sortAndClean).filter((v) => v !== undefined);
    if (
      cleaned.length > 0 &&
      typeof cleaned[0] === 'object' &&
      cleaned[0] !== null &&
      'product_id' in (cleaned[0] as object)
    ) {
      cleaned.sort((a, b) =>
        String((a as { product_id?: string }).product_id ?? '').localeCompare(
          String((b as { product_id?: string }).product_id ?? ''),
        ),
      );
    }
    return cleaned;
  }

  if (typeof obj === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj as object).sort()) {
      const val = sortAndClean((obj as Record<string, unknown>)[key]);
      if (val !== undefined) {
        sorted[key] = val;
      }
    }
    return sorted;
  }

  return obj;
}

/** SHA-256 hex digest — must match browser `generateActionHash`. */
export function generateActionHash(
  approvalType: string,
  context: Record<string, unknown>,
): string {
  const canonical = sortAndClean({ approval_type: approvalType, ...context });
  const json = JSON.stringify(canonical);
  return createHash('sha256').update(json).digest('hex');
}
