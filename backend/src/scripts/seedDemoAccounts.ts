/**
 * Seed demo admin accounts for testing.
 *
 * Creates / repairs these accounts (idempotent):
 *   1. super_admin       — superadmin@tileserp.com   / Demo@12345
 *   2. dealer_admin (A)  — dealer@tileserp.com       / Demo@12345
 *   3. dealer_admin (B)  — dealer2@tileserp.com      / Demo@12345
 *   4. salesman (A)      — salesman@tileserp.com     / Demo@12345
 *
 * For each dealer_admin a dealer row is auto-created (if missing) with a
 * 365-day active subscription so the user can log in immediately.
 *
 * Run on the VPS:
 *   cd /var/www/tilessaas/backend
 *   npx ts-node src/scripts/seedDemoAccounts.ts
 *
 * Output: backend/demo-accounts.json  — full credentials + dealer_id + roles.
 *
 * SAFE: only touches the listed demo emails (no other users are modified).
 */
import { db } from '../db/connection';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';

type Role = 'super_admin' | 'dealer_admin' | 'salesman';

interface SeedSpec {
  email: string;
  name: string;
  role: Role;
  /** Which dealer bucket to attach to (A / B). super_admin = null. */
  dealerKey: 'A' | 'B' | null;
}

const DEFAULT_PASSWORD = 'Demo@12345';

const ACCOUNTS: SeedSpec[] = [
  { email: 'superadmin@tileserp.com', name: 'Demo Super Admin',  role: 'super_admin',  dealerKey: null },
  { email: 'dealer@tileserp.com',     name: 'Demo Dealer Admin', role: 'dealer_admin', dealerKey: 'A' },
  { email: 'dealer2@tileserp.com',    name: 'Demo Dealer Two',   role: 'dealer_admin', dealerKey: 'B' },
  { email: 'salesman@tileserp.com',   name: 'Demo Salesman',     role: 'salesman',     dealerKey: 'A' },
];

const DEALERS: Record<'A' | 'B', { name: string; phone: string; address: string }> = {
  A: { name: 'Demo Tiles & Sanitary',     phone: '01700000001', address: 'Dhaka, Bangladesh' },
  B: { name: 'Demo Decor Mart',           phone: '01700000002', address: 'Chattogram, Bangladesh' },
};

async function ensureDealer(key: 'A' | 'B'): Promise<string> {
  const spec = DEALERS[key];
  const existing = await db('dealers').where({ name: spec.name }).first();
  let dealerId: string;
  if (existing) {
    dealerId = existing.id;
    await db('dealers').where({ id: dealerId }).update({
      phone: spec.phone,
      address: spec.address,
      is_demo: true,
      status: 'active',
    });
  } else {
    const [row] = await db('dealers').insert({
      name: spec.name,
      phone: spec.phone,
      address: spec.address,
      is_demo: true,
      status: 'active',
    }).returning('id');
    dealerId = row.id;
  }

  // Ensure a 365-day active Pro subscription so login isn't blocked
  const proPlan = await db('plans').where({ name: 'Pro' }).first();
  const planId = proPlan?.id ?? null;
  const sub = await db('subscriptions').where({ dealer_id: dealerId }).orderBy('start_date', 'desc').first();
  const start = new Date();
  const end = new Date(); end.setDate(end.getDate() + 365);
  if (!sub) {
    await db('subscriptions').insert({
      dealer_id: dealerId,
      plan_id: planId,
      status: 'active',
      start_date: start.toISOString().slice(0, 10),
      end_date: end.toISOString().slice(0, 10),
    });
  } else {
    await db('subscriptions').where({ id: sub.id }).update({
      plan_id: planId,
      status: 'active',
      end_date: end.toISOString().slice(0, 10),
    });
  }

  // Ensure invoice sequence row
  await db('invoice_sequences')
    .insert({ dealer_id: dealerId, next_invoice_no: 1, next_challan_no: 1 })
    .onConflict('dealer_id').ignore();

  return dealerId;
}

async function upsertUser(spec: SeedSpec, dealerId: string | null) {
  const email = spec.email.toLowerCase().trim();
  const hash = await bcrypt.hash(DEFAULT_PASSWORD, 10);

  const existing = await db('users').where({ email }).first();
  let userId: string;

  if (existing) {
    userId = existing.id;
    await db('users').where({ id: userId }).update({
      password_hash: hash,
      name: spec.name,
      status: 'active',
    });
  } else {
    const [row] = await db('users').insert({
      email,
      password_hash: hash,
      name: spec.name,
      status: 'active',
    }).returning('id');
    userId = row.id;
  }

  // Profile (id = user.id)
  const profile = await db('profiles').where({ id: userId }).first();
  if (profile) {
    await db('profiles').where({ id: userId }).update({
      email,
      name: spec.name,
      dealer_id: dealerId,
    });
  } else {
    await db('profiles').insert({
      id: userId,
      email,
      name: spec.name,
      dealer_id: dealerId,
    });
  }

  // Role — keep only the requested role for this demo user
  await db('user_roles').where({ user_id: userId }).delete();
  await db('user_roles').insert({ user_id: userId, role: spec.role });

  return userId;
}

async function main() {
  console.log('▸ Seeding demo admin accounts...\n');

  const dealerIds: Partial<Record<'A' | 'B', string>> = {};
  dealerIds.A = await ensureDealer('A');
  dealerIds.B = await ensureDealer('B');
  console.log(`  ✓ Dealer A: ${dealerIds.A}`);
  console.log(`  ✓ Dealer B: ${dealerIds.B}\n`);

  const results: any[] = [];
  for (const spec of ACCOUNTS) {
    const dealerId = spec.dealerKey ? dealerIds[spec.dealerKey]! : null;
    const userId = await upsertUser(spec, dealerId);
    const dealerName = spec.dealerKey ? DEALERS[spec.dealerKey].name : null;
    console.log(
      `  ✓ ${spec.role.padEnd(13)} ${spec.email.padEnd(30)} → user_id=${userId}` +
      (dealerId ? `  dealer="${dealerName}"` : ''),
    );
    results.push({
      email: spec.email,
      password: DEFAULT_PASSWORD,
      name: spec.name,
      role: spec.role,
      user_id: userId,
      dealer_id: dealerId,
      dealer_name: dealerName,
    });
  }

  const outPath = path.join(__dirname, '..', '..', 'demo-accounts.json');
  fs.writeFileSync(outPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    default_password: DEFAULT_PASSWORD,
    accounts: results,
  }, null, 2));

  console.log(`\n✓ All demo accounts ready. Credentials saved to:\n  ${outPath}\n`);
  console.log('Login at: https://tiles-sanitary-software.lovable.app/auth/login');
  console.log(`Password for ALL accounts: ${DEFAULT_PASSWORD}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error('✗ Seed failed:', e); process.exit(1); });
