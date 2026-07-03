import type { Knex } from 'knex';

/**
 * Platform-wide subscription-expiry reminder configuration (single row).
 *
 * Controls the auto reminder that fires N days before a dealer's
 * subscription end_date across SMS / Email / WhatsApp. Owned by Super Admin.
 * WhatsApp/SMTP credentials themselves live in env (secrets) — this table
 * only stores the on/off toggles and timing.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('reminder_settings', (t) => {
    // Single-row table: id is always true.
    t.boolean('id').primary().defaultTo(true);
    t.boolean('enabled').notNullable().defaultTo(true);
    t.integer('days_before').notNullable().defaultTo(2);
    t.boolean('sms_enabled').notNullable().defaultTo(true);
    t.boolean('whatsapp_enabled').notNullable().defaultTo(true);
    t.boolean('email_enabled').notNullable().defaultTo(false);
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.check('id = true');
  });

  await knex('reminder_settings').insert({ id: true });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('reminder_settings');
}
