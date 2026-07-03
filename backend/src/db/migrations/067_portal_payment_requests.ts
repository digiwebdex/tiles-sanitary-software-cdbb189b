import type { Knex } from 'knex';

/**
 * P6-04 — Portal payment requests (customer notifies dealer of MFS/bank payment).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    DO $$ BEGIN
      CREATE TYPE portal_payment_request_status AS ENUM (
        'pending', 'reviewed', 'approved', 'rejected', 'applied'
      );
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);

  const exists = await knex.schema.hasTable('portal_payment_requests');
  if (exists) return;

  await knex.schema.createTable('portal_payment_requests', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('dealer_id').notNullable().references('id').inTable('dealers').onDelete('CASCADE');
    t.uuid('customer_id').notNullable().references('id').inTable('customers').onDelete('CASCADE');
    t.uuid('portal_user_id').nullable().references('id').inTable('portal_users').onDelete('SET NULL');
    t.decimal('amount', 14, 2).notNullable();
    t.string('payment_mode', 30).notNullable();
    t.string('reference_no', 120).nullable();
    t.uuid('sale_id').nullable().references('id').inTable('sales').onDelete('SET NULL');
    t.text('message').nullable();
    t.specificType('status', 'portal_payment_request_status').notNullable().defaultTo('pending');
    t.text('review_note').nullable();
    t.uuid('reviewed_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('reviewed_at', { useTz: true }).nullable();
    t.uuid('applied_ledger_id').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['dealer_id', 'status', 'created_at']);
    t.index(['customer_id', 'created_at']);
    t.index(['portal_user_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('portal_payment_requests');
  await knex.raw('DROP TYPE IF EXISTS portal_payment_request_status');
}
