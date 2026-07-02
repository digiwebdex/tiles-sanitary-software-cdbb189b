import type { Knex } from 'knex';

/**
 * Dealer "menu mode" — controls how much of the (large) module set is shown.
 *   - 'simple'   → only core daily-operations modules (Phases 1–3)
 *   - 'advanced' → everything (Phases 4–5: growth, HRM, journal, etc.)
 *
 * Default is 'advanced' so EXISTING dealers see no change. New signups are
 * set to 'simple' in authService.register so they start uncluttered.
 */
export async function up(knex: Knex): Promise<void> {
  const has = await knex.schema.hasColumn('dealers', 'menu_mode');
  if (!has) {
    await knex.schema.alterTable('dealers', (t) => {
      t.string('menu_mode').notNullable().defaultTo('advanced');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const has = await knex.schema.hasColumn('dealers', 'menu_mode');
  if (has) {
    await knex.schema.alterTable('dealers', (t) => {
      t.dropColumn('menu_mode');
    });
  }
}
