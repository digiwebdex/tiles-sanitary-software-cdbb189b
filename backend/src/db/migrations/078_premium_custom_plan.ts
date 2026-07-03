import type { Knex } from 'knex';

/**
 * Adds the "Premium Custom" plan (৳5,000/month, all features enabled) and
 * a `custom_features` JSONB column on `subscriptions` so Super Admin can
 * override any feature flag per dealer on this plan.
 */
export async function up(knex: Knex): Promise<void> {
  // 1) Add custom_features override column to subscriptions
  const hasCF = await knex.schema.hasColumn('subscriptions', 'custom_features');
  if (!hasCF) {
    await knex.schema.alterTable('subscriptions', (t) => {
      t.jsonb('custom_features').nullable().comment(
        'Per-dealer feature flag overrides (Premium Custom plan). ' +
        'Keys mirror PlanFeatures in authService. Merged on top of plan defaults at JWT build time.',
      );
    });
  }

  // 2) Upsert the Premium Custom plan
  const premiumCustom = {
    name: 'Premium Custom',
    price_monthly: 5000,
    price_yearly: 50000,
    max_users: 9999,
    features: JSON.stringify([
      'All Business features',
      'Unlimited warehouses & branches',
      'Unlimited staff users',
      'WhatsApp, SMS & Email notifications',
      'HRM module',
      'Campaigns & marketing tools',
      'Customer portal',
      'Advanced finance (Directors/Shareholders)',
      'Advanced reports',
      'Backorders management',
      'Dedicated account manager',
      'Custom feature configuration per dealer',
    ]),
    is_active: true,
    sms_enabled: true,
    email_enabled: true,
    // tier limits
    max_warehouses: 9999,
    max_branches: 9999,
    max_staff_users: 9999,
    // feature flags – all on
    whatsapp_enabled: true,
    hrm_enabled: true,
    campaigns_enabled: true,
    portal_enabled: true,
    advanced_finance_enabled: true,
    advanced_reports_enabled: true,
    pos_enabled: true,
    barcode_enabled: true,
    leads_enabled: true,
    projects_enabled: true,
    quotations_enabled: true,
    backorders_enabled: true,
  };

  const existing = await knex('plans')
    .whereRaw("lower(name) = 'premium custom'")
    .first();

  if (existing) {
    await knex('plans')
      .where({ id: existing.id })
      .update({ ...premiumCustom, updated_at: knex.fn.now() });
  } else {
    await knex('plans').insert({
      ...premiumCustom,
      created_at: knex.fn.now(),
      updated_at: knex.fn.now(),
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex('plans').whereRaw("lower(name) = 'premium custom'").delete();

  const hasCF = await knex.schema.hasColumn('subscriptions', 'custom_features');
  if (hasCF) {
    await knex.schema.alterTable('subscriptions', (t) => {
      t.dropColumn('custom_features');
    });
  }
}
