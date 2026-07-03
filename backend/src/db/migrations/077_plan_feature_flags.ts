import type { Knex } from 'knex';

/**
 * Adds granular feature flags for modules that are disabled by default on all
 * dealer accounts. Super Admin can enable them per plan as needed.
 *
 * backorders_enabled  : Pro+ (tiles shops need it for stock shortage handling)
 * All others          : false on every plan by default (SA activates per plan)
 */
export async function up(knex: Knex): Promise<void> {
  const has = (col: string) => knex.schema.hasColumn('plans', col);

  const newCols: Array<{ name: string; add: (t: Knex.AlterTableBuilder) => void }> = [
    { name: 'pos_enabled',        add: (t) => t.boolean('pos_enabled').notNullable().defaultTo(false) },
    { name: 'barcode_enabled',    add: (t) => t.boolean('barcode_enabled').notNullable().defaultTo(false) },
    { name: 'leads_enabled',      add: (t) => t.boolean('leads_enabled').notNullable().defaultTo(false) },
    { name: 'projects_enabled',   add: (t) => t.boolean('projects_enabled').notNullable().defaultTo(false) },
    { name: 'quotations_enabled', add: (t) => t.boolean('quotations_enabled').notNullable().defaultTo(false) },
    { name: 'backorders_enabled', add: (t) => t.boolean('backorders_enabled').notNullable().defaultTo(false) },
  ];

  for (const col of newCols) {
    if (!(await has(col.name))) {
      await knex.schema.alterTable('plans', col.add);
    }
  }

  // Backorders: enabled for Pro and Business
  await knex('plans')
    .whereRaw("lower(name) in ('pro', 'business')")
    .update({ backorders_enabled: true, updated_at: knex.fn.now() });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('plans', (t) => {
    t.dropColumn('pos_enabled');
    t.dropColumn('barcode_enabled');
    t.dropColumn('leads_enabled');
    t.dropColumn('projects_enabled');
    t.dropColumn('quotations_enabled');
    t.dropColumn('backorders_enabled');
  });
}
