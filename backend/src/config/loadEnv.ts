import fs from 'fs';
import path from 'path';
import { config as loadDotenv, parse as parseDotenv } from 'dotenv';
import {
  buildDatabaseUrl,
  DEFAULT_DB_HOST,
  DEFAULT_DB_PORT,
  DEFAULT_DB_NAME,
  DEFAULT_DB_USER,
  isUsableSecret,
} from './databaseUrl';

type ParsedEnv = Record<string, string>;

function readEnvFile(envPath: string): ParsedEnv | null {
  if (!fs.existsSync(envPath)) return null;
  return parseDotenv(fs.readFileSync(envPath));
}

export function loadBackendEnv() {
  const rootEnvPaths = Array.from(new Set([
    path.resolve(process.cwd(), '../.env'),
    path.resolve(__dirname, '../../../.env'),
  ]));
  const localEnvPaths = Array.from(new Set([
    path.resolve(process.cwd(), '.env'),
    path.resolve(__dirname, '../../.env'),
  ]));

  const rootEnv = rootEnvPaths.find((p) => fs.existsSync(p));
  const parsedRootEnv = rootEnv ? readEnvFile(rootEnv) ?? {} : {};
  const isProduction =
    process.env.NODE_ENV === 'production' || parsedRootEnv.NODE_ENV === 'production';

  const envPaths = isProduction ? rootEnvPaths : [...rootEnvPaths, ...localEnvPaths];
  const existingEnvs = envPaths
    .filter((p) => fs.existsSync(p))
    .map((p) => ({ path: p, parsed: readEnvFile(p) ?? {} }));

  for (const [index, envFile] of existingEnvs.entries()) {
    loadDotenv({ path: envFile.path, override: index === 0 });
  }

  // Merge all env sources — root .env wins in production.
  const merged: ParsedEnv = {};
  for (const { parsed } of [...existingEnvs].reverse()) {
    Object.assign(merged, parsed);
  }
  Object.assign(merged, parsedRootEnv);

  const dbPassword = merged.DB_PASSWORD?.trim();
  const dbHost = merged.DB_HOST?.trim() || DEFAULT_DB_HOST;
  const dbPort = merged.DB_PORT?.trim() || DEFAULT_DB_PORT;
  const dbUser = merged.DB_USER?.trim() || DEFAULT_DB_USER;
  const dbName = merged.DB_NAME?.trim() || DEFAULT_DB_NAME;
  const databaseUrl = merged.DATABASE_URL?.trim();

  // Production: prefer component vars (DB_PASSWORD) over a stale DATABASE_URL
  // that often points at postgres@5432 from copy-paste templates.
  if (isProduction && isUsableSecret(dbPassword)) {
    process.env.DATABASE_URL = buildDatabaseUrl({
      password: dbPassword,
      host: dbHost,
      port: dbPort,
      user: dbUser,
      database: dbName,
    });
    process.env.DB_HOST = dbHost;
    process.env.DB_PORT = dbPort;
    process.env.DB_USER = dbUser;
    process.env.DB_NAME = dbName;
    process.env.DB_PASSWORD = dbPassword;
    return;
  }

  if (isUsableSecret(databaseUrl)) {
    process.env.DATABASE_URL = databaseUrl;
    return;
  }

  if (isUsableSecret(dbPassword)) {
    process.env.DATABASE_URL = buildDatabaseUrl({
      password: dbPassword,
      host: dbHost,
      port: dbPort,
      user: dbUser,
      database: dbName,
    });
  }
}
