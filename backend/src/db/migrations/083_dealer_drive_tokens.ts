import type { Knex } from 'knex';

/**
 * Per-dealer Google Drive backup connection.
 *
 * Each dealer_admin can connect THEIR OWN Google account (via the platform's
 * single OAuth app). We store their tokens here, plus the id of the
 * "SaniTiles Backups" folder created in their Drive and the status of the last
 * backup. A nightly job uploads each connected dealer's Excel backup to their
 * own Drive.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('dealer_drive_tokens', (t) => {
    t.uuid('dealer_id').primary();
    t.string('google_email');
    t.text('access_token');
    t.text('refresh_token');
    t.string('token_type').defaultTo('Bearer');
    t.text('scope');
    t.timestamp('expires_at');
    t.string('folder_id'); // Drive folder the app created for this dealer
    t.boolean('auto_backup_enabled').notNullable().defaultTo(true);
    t.timestamp('last_backup_at');
    t.string('last_backup_status'); // 'success' | 'failed'
    t.text('last_backup_error');
    t.string('last_backup_file');
    t.timestamp('connected_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('dealer_drive_tokens');
}
