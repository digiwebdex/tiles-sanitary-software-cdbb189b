import type { Knex } from 'knex';

/**
 * Extends the `plans` table with feature flags so Super Admin can manage
 * the same 4 plans the marketing site advertises (Free Trial, Starter,
 * Pro, Business). Idempotent: safe to re-run.
 */
export async function up(knex: Knex): Promise<void> {
  // 1) Add feature columns to `plans`
  const has = async (col: string) => knex.schema.hasColumn('plans', col);

  await knex.schema.alterTable('plans', (t) => {
    // chained checks below decide which columns get created
    t.boolean('is_active').notNullable().defaultTo(true).alter?.bind(t);
  }).catch(() => undefined);

  if (!(await has('is_active'))) {
    await knex.schema.alterTable('plans', (t) => {
      t.boolean('is_active').notNullable().defaultTo(true);
    });
  }
  if (!(await has('sms_enabled'))) {
    await knex.schema.alterTable('plans', (t) => {
      t.boolean('sms_enabled').notNullable().defaultTo(false);
    });
  }
  if (!(await has('email_enabled'))) {
    await knex.schema.alterTable('plans', (t) => {
      t.boolean('email_enabled').notNullable().defaultTo(false);
    });
  }
  if (!(await has('daily_summary_enabled'))) {
    await knex.schema.alterTable('plans', (t) => {
      t.boolean('daily_summary_enabled').notNullable().defaultTo(false);
    });
  }
  if (!(await has('is_trial'))) {
    await knex.schema.alterTable('plans', (t) => {
      t.boolean('is_trial').notNullable().defaultTo(false);
    });
  }
  if (!(await has('trial_days'))) {
    await knex.schema.alterTable('plans', (t) => {
      t.integer('trial_days').notNullable().defaultTo(0);
    });
  }
  if (!(await has('sort_order'))) {
    await knex.schema.alterTable('plans', (t) => {
      t.integer('sort_order').notNullable().defaultTo(0);
    });
  }
  if (!(await has('features'))) {
    await knex.schema.alterTable('plans', (t) => {
      t.jsonb('features').notNullable().defaultTo(JSON.stringify([]));
    });
  }
  if (!(await has('updated_at'))) {
    await knex.schema.alterTable('plans', (t) => {
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
  }

  // 2) Unique name (case-insensitive) so seeds are idempotent
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS plans_name_lower_uidx ON plans (lower(name));`);

  // 3) Seed the 4 canonical plans (only insert if missing by name)
  const seeds = [
    {
      name: 'Free Trial',
      price_monthly: 0,
      price_yearly: 0,
      max_users: 1,
      sms_enabled: false,
      email_enabled: true,
      daily_summary_enabled: false,
      is_trial: true,
      trial_days: 7,
      sort_order: 1,
      features: JSON.stringify([
        '1 user only',
        'Basic inventory',
        'Sales & purchase entry',
        'Customer ledger',
        '7 days access',
      ]),
    },
    {
      name: 'Starter',
      price_monthly: 999,
      price_yearly: 10000,
      max_users: 1,
      sms_enabled: false,
      email_enabled: true,
      daily_summary_enabled: false,
      is_trial: false,
      trial_days: 0,
      sort_order: 2,
      features: JSON.stringify([
        '1 user',
        'Full inventory management',
        'Sales & purchase tracking',
        'Customer & supplier ledger',
        'Basic reports & P/L',
        'Barcode generation',
        'Email notifications',
        'Challan & invoice printing',
      ]),
    },
    {
      name: 'Pro',
      price_monthly: 2000,
      price_yearly: 20000,
      max_users: 2,
      sms_enabled: true,
      email_enabled: true,
      daily_summary_enabled: true,
      is_trial: false,
      trial_days: 0,
      sort_order: 3,
      features: JSON.stringify([
        'Up to 2 users',
        'All Starter features',
        'Advanced analytics & dashboards',
        'Credit limit management',
        'Sales return & purchase return',
        'Stock movement tracking',
        'Customer follow-up & collections',
        'SMS + Email notifications',
        'Priority support',
      ]),
    },
    {
      name: 'Business',
      price_monthly: 3000,
      price_yearly: 30000,
      max_users: 5,
      sms_enabled: true,
      email_enabled: true,
      daily_summary_enabled: true,
      is_trial: false,
      trial_days: 0,
      sort_order: 4,
      features: JSON.stringify([
        'Up to 5 users',
        'All Pro features',
        'Multi-branch ready',
        'Role-based access control',
        'Full audit logs',
        'Campaign & gift management',
        'Custom reports & exports',
        'Delivery management',
        'Dedicated account manager',
      ]),
    },
  ];

  for (const s of seeds) {
    const existing = await knex('plans').whereRaw('lower(name) = ?', [s.name.toLowerCase()]).first();
    if (existing) {
      await knex('plans').where({ id: existing.id }).update({
        price_monthly: s.price_monthly,
        price_yearly: s.price_yearly,
        max_users: s.max_users,
        sms_enabled: s.sms_enabled,
        email_enabled: s.email_enabled,
        daily_summary_enabled: s.daily_summary_enabled,
        is_trial: s.is_trial,
        trial_days: s.trial_days,
        sort_order: s.sort_order,
        features: s.features,
        is_active: true,
        updated_at: knex.fn.now(),
      });
    } else {
      await knex('plans').insert(s);
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP INDEX IF EXISTS plans_name_lower_uidx;`);
  await knex.schema.alterTable('plans', (t) => {
    t.dropColumn('is_active');
    t.dropColumn('sms_enabled');
    t.dropColumn('email_enabled');
    t.dropColumn('daily_summary_enabled');
    t.dropColumn('is_trial');
    t.dropColumn('trial_days');
    t.dropColumn('sort_order');
    t.dropColumn('features');
    t.dropColumn('updated_at');
  });
}
