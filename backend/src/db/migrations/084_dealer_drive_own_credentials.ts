import type { Knex } from 'knex';

/**
 * "Bring your own Google credentials" — each dealer supplies their OWN Google
 * OAuth app (Client ID + Secret) that they created in their own Google Cloud
 * project, rather than using a single platform-wide key. Stored per dealer so
 * the connect / token-refresh flow uses that dealer's own app.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('dealer_drive_tokens', (t) => {
    t.text('client_id');
    t.text('client_secret');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('dealer_drive_tokens', (t) => {
    t.dropColumn('client_id');
    t.dropColumn('client_secret');
  });
}
