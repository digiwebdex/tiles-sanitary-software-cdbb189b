#!/usr/bin/env tsx
/**
 * VPS database connectivity diagnostic.
 * Run: cd backend && npx tsx src/scripts/dbDoctor.ts
 */
import { loadBackendEnv } from '../config/loadEnv';
import {
  DEFAULT_DB_HOST,
  DEFAULT_DB_PORT,
  DEFAULT_DB_NAME,
  DEFAULT_DB_USER,
  maskDatabaseUrl,
  parseDatabaseUrl,
} from '../config/databaseUrl';
import { checkDbConnection } from '../db/connection';

loadBackendEnv();

async function main() {
  const url = process.env.DATABASE_URL;
  console.log('=== SaniTiles DB Doctor ===\n');

  if (!url) {
    console.error('❌ DATABASE_URL is not set.');
    console.log('\nFix: create /var/www/tilessaas/.env with:');
    console.log('  DB_PASSWORD=your_strong_password');
    console.log('  DB_HOST=127.0.0.1');
    console.log('  DB_PORT=5440');
    console.log('  DB_USER=tileserp');
    console.log('  DB_NAME=tileserp');
    process.exit(1);
  }

  const parsed = parseDatabaseUrl(url);
  console.log('Connection target:');
  console.log(`  URL (masked): ${maskDatabaseUrl(url)}`);
  if (parsed) {
    console.log(`  Host: ${parsed.host}`);
    console.log(`  Port: ${parsed.port}`);
    console.log(`  User: ${parsed.user}`);
    console.log(`  Database: ${parsed.database}`);
  }

  if (parsed?.user === 'postgres') {
    console.warn('\n⚠️  WARNING: Using PostgreSQL superuser "postgres".');
    console.warn('   SaniTiles expects user "tileserp" on port 5440.');
    console.warn('   See docs/VPS_FRESH_DEPLOY.md to fix.\n');
  }

  console.log('\nTesting connection...');
  const ok = await checkDbConnection();

  if (ok) {
    console.log('✅ Database connection OK');
    process.exit(0);
  }

  console.error('❌ Database connection FAILED');
  console.log('\nCommon fixes:');
  console.log('1. Check Postgres is running:');
  console.log(`   ss -tlnp | grep ${parsed?.port ?? DEFAULT_DB_PORT}`);
  console.log('2. Use tileserp user (not postgres) in /var/www/tilessaas/.env:');
  console.log(`   DB_USER=${DEFAULT_DB_USER}`);
  console.log(`   DB_PORT=${DEFAULT_DB_PORT}`);
  console.log('   DB_PASSWORD=<same password used when creating DB>');
  console.log('3. Test manually:');
  console.log(
    `   PGPASSWORD='...' psql -h ${parsed?.host ?? DEFAULT_DB_HOST} -p ${parsed?.port ?? DEFAULT_DB_PORT} -U ${parsed?.user ?? DEFAULT_DB_USER} -d ${parsed?.database ?? DEFAULT_DB_NAME} -c 'SELECT 1'`,
  );
  console.log('4. Run full setup: bash scripts/vps-fresh-setup.sh');
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
