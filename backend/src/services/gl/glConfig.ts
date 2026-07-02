import { env } from '../../config/env';

/** True when USE_GL_SPINE=true|1 — mirrors posting_batches into gl_journal_entries. */
export function isGlSpineEnabled(): boolean {
  const v = (env.USE_GL_SPINE ?? '').toLowerCase();
  return v === 'true' || v === '1';
}
