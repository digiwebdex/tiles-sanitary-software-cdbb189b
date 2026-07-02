import type { Knex } from 'knex';

/**
 * Adds per-plan tier limits and feature flags.
 *
 * Basic/Starter : 1 warehouse, 1 branch, 3 staff, email only
 * Pro           : 2 warehouse, 2 branch, 8 staff, email+SMS, portal, adv.reports
 * Business      : 5 warehouse, 5 branch, unlimited staff, +WhatsApp, HRM, campaigns, adv.finance
 */
export async function up(knex: Knex): Promise<void> {
  const has = (col: string) => knex.schema.hasColumn('plans', col);

  const newCols: Array<{ name: string; add: (t: Knex.AlterTableBuilder) => void }> = [
    { name: 'max_warehouses',           add: (t) => t.integer('max_warehouses').notNullable().defaultTo(1) },
    { name: 'max_branches',             add: (t) => t.integer('max_branches').notNullable().defaultTo(1) },
    { name: 'max_staff_users',          add: (t) => t.integer('max_staff_users').notNullable().defaultTo(3) },
    { name: 'whatsapp_enabled',         add: (t) => t.boolean('whatsapp_enabled').notNullable().defaultTo(false) },
    { name: 'hrm_enabled',              add: (t) => t.boolean('hrm_enabled').notNullable().defaultTo(false) },
    { name: 'campaigns_enabled',        add: (t) => t.boolean('campaigns_enabled').notNullable().defaultTo(false) },
    { name: 'portal_enabled',           add: (t) => t.boolean('portal_enabled').notNullable().defaultTo(false) },
    { name: 'advanced_finance_enabled', add: (t) => t.boolean('advanced_finance_enabled').notNullable().defaultTo(false) },
    { name: 'advanced_reports_enabled', add: (t) => t.boolean('advanced_reports_enabled').notNullable().defaultTo(false) },
  ];

  for (const col of newCols) {
    if (!(await has(col.name))) {
      await knex.schema.alterTable('plans', col.add);
    }
  }

  // Seed correct limits for each canonical plan
  const planLimits: Record<string, object> = {
    'free trial': {
      max_warehouses: 1, max_branches: 1, max_staff_users: 1,
      whatsapp_enabled: false, hrm_enabled: false, campaigns_enabled: false,
      portal_enabled: false, advanced_finance_enabled: false, advanced_reports_enabled: false,
    },
    'starter': {
      max_warehouses: 1, max_branches: 1, max_staff_users: 3,
      whatsapp_enabled: false, hrm_enabled: false, campaigns_enabled: false,
      portal_enabled: false, advanced_finance_enabled: false, advanced_reports_enabled: false,
    },
    'pro': {
      max_warehouses: 2, max_branches: 2, max_staff_users: 8,
      whatsapp_enabled: false, hrm_enabled: false, campaigns_enabled: false,
      portal_enabled: true, advanced_finance_enabled: false, advanced_reports_enabled: true,
    },
    'business': {
      max_warehouses: 5, max_branches: 5, max_staff_users: 9999,
      whatsapp_enabled: true, hrm_enabled: true, campaigns_enabled: true,
      portal_enabled: true, advanced_finance_enabled: true, advanced_reports_enabled: true,
    },
  };

  for (const [nameLower, limits] of Object.entries(planLimits)) {
    await knex('plans')
      .whereRaw('lower(name) = ?', [nameLower])
      .update({ ...limits, updated_at: knex.fn.now() });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('plans', (t) => {
    t.dropColumn('max_warehouses');
    t.dropColumn('max_branches');
    t.dropColumn('max_staff_users');
    t.dropColumn('whatsapp_enabled');
    t.dropColumn('hrm_enabled');
    t.dropColumn('campaigns_enabled');
    t.dropColumn('portal_enabled');
    t.dropColumn('advanced_finance_enabled');
    t.dropColumn('advanced_reports_enabled');
  });
}
