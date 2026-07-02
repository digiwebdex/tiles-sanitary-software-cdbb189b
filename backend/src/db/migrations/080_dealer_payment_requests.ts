import type { Knex } from 'knex';

/**
 * Dealer → Super Admin subscription payment requests.
 *
 * When a dealer pays their subscription fee (bKash/Nagad/bank/cash), they
 * submit a payment request here with their transaction ID and amount.
 * The Super Admin reviews it, marks it approved or rejected, and
 * optionally links it to an existing subscription payment record.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dealer_payment_request_status') THEN
        CREATE TYPE dealer_payment_request_status AS ENUM ('pending', 'approved', 'rejected');
      END IF;
    END $$;
  `);

  const exists = await knex.schema.hasTable('dealer_payment_requests');
  if (!exists) {
    await knex.schema.createTable('dealer_payment_requests', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('dealer_id').notNullable().references('id').inTable('dealers').onDelete('CASCADE');

      // Payment details (filled by dealer)
      t.decimal('amount', 12, 2).notNullable();
      t.string('payment_method', 50).notNullable()  // bkash | nagad | bank | cash | ssl
        .comment('bkash | nagad | bank | cash | ssl');
      t.string('transaction_id', 200).nullable()
        .comment('bKash/Nagad txn ID or bank ref');
      t.string('screenshot_url', 500).nullable()
        .comment('Optional URL to payment screenshot');
      t.text('note').nullable()
        .comment('Dealer note e.g. "paid for renewal June 2026"');

      // SA review (filled by SA)
      t.specificType('status', 'dealer_payment_request_status')
        .notNullable().defaultTo('pending');
      t.uuid('reviewed_by').nullable()
        .references('id').inTable('users').onDelete('SET NULL');
      t.text('review_note').nullable();
      t.timestamp('reviewed_at').nullable();

      t.timestamps(true, true);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('dealer_payment_requests');
  await knex.raw(`DROP TYPE IF EXISTS dealer_payment_request_status;`);
}
