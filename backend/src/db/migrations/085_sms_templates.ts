import type { Knex } from 'knex';

/**
 * Per-dealer SMS template overrides. The template catalog (keys, labels,
 * default Bengali bodies) lives in the frontend; a row here overrides the
 * body / label / enabled flag for one template of one dealer.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('sms_templates', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('dealer_id').notNullable().references('id').inTable('dealers').onDelete('CASCADE');
    t.string('template_key', 60).notNullable();
    t.string('label', 120);
    t.text('body').notNullable();
    t.boolean('is_enabled').notNullable().defaultTo(true);
    t.timestamps(true, true);
    t.unique(['dealer_id', 'template_key']);
    t.index(['dealer_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('sms_templates');
}
