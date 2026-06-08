/** Canonical VPS PostgreSQL connection settings (see RESOURCE_LOCK.md). */
export const DEFAULT_DB_HOST = '127.0.0.1';
export const DEFAULT_DB_PORT = '5440';
export const DEFAULT_DB_USER = 'tileserp';
export const DEFAULT_DB_NAME = 'tileserp';

const PLACEHOLDER_PATTERNS = [
  'GENERATE_',
  'CHANGE_ME',
  'changeme_strong_password',
  'your-password',
  'password_here',
];

export function isUsableSecret(value?: string): boolean {
  if (!value?.trim()) return false;
  const v = value.trim();
  if (v.length < 4) return false;
  return !PLACEHOLDER_PATTERNS.some((p) => v.includes(p));
}

export function buildDatabaseUrl(opts: {
  password: string;
  host?: string;
  port?: string;
  user?: string;
  database?: string;
}): string {
  const host = opts.host || DEFAULT_DB_HOST;
  const port = opts.port || DEFAULT_DB_PORT;
  const user = opts.user || DEFAULT_DB_USER;
  const database = opts.database || DEFAULT_DB_NAME;
  return `postgres://${user}:${encodeURIComponent(opts.password)}@${host}:${port}/${database}`;
}

/** Mask password in a postgres URL for safe logging. */
export function maskDatabaseUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '****';
    return u.toString();
  } catch {
    return '(invalid DATABASE_URL)';
  }
}

export function parseDatabaseUrl(url: string): {
  host: string;
  port: string;
  user: string;
  database: string;
} | null {
  try {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: u.port || '5432',
      user: decodeURIComponent(u.username),
      database: u.pathname.replace(/^\//, ''),
    };
  } catch {
    return null;
  }
}
