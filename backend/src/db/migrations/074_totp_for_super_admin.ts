import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (t) => {
    t.text('totp_secret').nullable();
    t.boolean('totp_enabled').notNullable().defaultTo(false);
    t.timestamp('totp_enabled_at').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('totp_secret');
    t.dropColumn('totp_enabled');
    t.dropColumn('totp_enabled_at');
  });
}
