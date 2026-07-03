/**
 * One-time sync: portal_users from Supabase PostgREST → VPS PostgreSQL.
 *
 * Usage:
 *   cd /var/www/tilessaas/backend
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
 *   npx tsx src/scripts/syncPortalUsersFromSupabase.ts
 *
 * Options:
 *   --dry-run   Print rows that would be upserted without writing
 *   --dealer-id <uuid>  Limit to one dealer
 */
import { db } from '../db/connection';

interface SupabasePortalUser {
  id: string;
  dealer_id: string;
  customer_id: string;
  auth_user_id: string | null;
  email: string;
  name: string;
  phone: string | null;
  portal_role: string;
  status: string;
  invited_at: string;
  activated_at: string | null;
  last_login_at: string | null;
  invited_by: string | null;
  created_at: string;
  updated_at: string;
}

async function fetchSupabasePortalUsers(dealerId?: string): Promise<SupabasePortalUser[]> {
  const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }

  const params = new URLSearchParams({
    select: '*',
    order: 'created_at.asc',
  });
  if (dealerId) params.set('dealer_id', `eq.${dealerId}`);

  const url = `${base}/rest/v1/portal_users?${params}`;
  const res = await fetch(url, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase fetch failed (${res.status}): ${text}`);
  }
  return (await res.json()) as SupabasePortalUser[];
}

async function upsertPortalUser(row: SupabasePortalUser, dryRun: boolean) {
  const payload = {
    id: row.id,
    dealer_id: row.dealer_id,
    customer_id: row.customer_id,
    auth_user_id: row.auth_user_id,
    email: row.email.toLowerCase().trim(),
    name: row.name,
    phone: row.phone,
    portal_role: row.portal_role,
    status: row.status,
    invited_at: row.invited_at,
    activated_at: row.activated_at,
    last_login_at: row.last_login_at,
    invited_by: row.invited_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };

  if (dryRun) {
    console.log('[dry-run] would upsert', payload.email, payload.id);
    return 'dry';
  }

  const existing = await db('portal_users').where({ id: row.id }).first('id');
  if (existing) {
    await db('portal_users').where({ id: row.id }).update({
      ...payload,
      updated_at: db.fn.now(),
    });
    return 'updated';
  }

  await db('portal_users').insert(payload);
  return 'inserted';
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const dealerIdx = args.indexOf('--dealer-id');
  const dealerId = dealerIdx >= 0 ? args[dealerIdx + 1] : undefined;

  console.log(`Fetching portal_users from Supabase${dealerId ? ` (dealer ${dealerId})` : ''}...`);
  const rows = await fetchSupabasePortalUsers(dealerId);
  console.log(`Found ${rows.length} row(s).`);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    try {
      const dealer = await db('dealers').where({ id: row.dealer_id }).first('id');
      const customer = await db('customers')
        .where({ id: row.customer_id, dealer_id: row.dealer_id })
        .first('id');
      if (!dealer || !customer) {
        console.warn(`Skip ${row.email}: dealer/customer missing on VPS`);
        skipped++;
        continue;
      }

      if (row.auth_user_id) {
        const user = await db('users').where({ id: row.auth_user_id }).first('id');
        if (!user) {
          console.warn(`Skip ${row.email}: auth_user_id ${row.auth_user_id} not on VPS`);
          skipped++;
          continue;
        }
      }

      const result = await upsertPortalUser(row, dryRun);
      if (result === 'inserted') inserted++;
      else if (result === 'updated') updated++;
    } catch (err) {
      console.error(`Failed ${row.email}:`, (err as Error).message);
      skipped++;
    }
  }

  console.log(`Done. inserted=${inserted} updated=${updated} skipped=${skipped}${dryRun ? ' (dry-run)' : ''}`);
  await db.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
