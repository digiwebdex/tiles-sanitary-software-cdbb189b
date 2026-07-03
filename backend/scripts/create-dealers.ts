import knex from 'knex';
import bcrypt from 'bcryptjs';
import config from '../src/db/knexfile';

const db = knex(config);

const dealers = [
  { email: 'mse57789@gmail.com', password: 'eNJy!Jthk86Xfd', name: 'MSE Dealer', dealerName: 'MSE', phone: '01700000001' },
  { email: 'dblbrahmanbaria@gmail.com', password: 'Amin@12345#', name: 'DBL Brahmanbaria', dealerName: 'DBL Brahmanbaria', phone: '01700000002' },
];

async function run() {
  let plan: any = await db('plans').first();
  if (!plan) {
    [plan] = await db('plans').insert({ name: 'Basic', price_monthly: 500, price_yearly: 5000, max_users: 3 }).returning('*');
  }

  for (const d of dealers) {
    const existing = await db('users').where({ email: d.email }).first();
    if (existing) { console.log('Skip - ' + d.email); continue; }

    const hash = await bcrypt.hash(d.password, 12);
    const [dealer] = await db('dealers').insert({ name: d.dealerName, phone: d.phone, address: 'Bangladesh' }).returning('*');
    const [user] = await db('users').insert({ email: d.email, password_hash: hash, name: d.name }).returning('*');
    await db('profiles').insert({ id: user.id, name: d.name, email: d.email, dealer_id: dealer.id });
    await db('user_roles').insert({ user_id: user.id, role: 'dealer_admin' });
    const end = new Date(); end.setFullYear(end.getFullYear() + 1);
    await db('subscriptions').insert({
      dealer_id: dealer.id, plan_id: plan.id, status: 'active', billing_cycle: 'yearly',
      start_date: new Date().toISOString().split('T')[0],
      end_date: end.toISOString().split('T')[0],
    });
    await db('invoice_sequences').insert({ dealer_id: dealer.id, next_invoice_no: 1, next_challan_no: 1 });
    console.log('Created ' + d.email);
  }
  await db.destroy();
}

run().catch(e => { console.error(e); process.exit(1); });
