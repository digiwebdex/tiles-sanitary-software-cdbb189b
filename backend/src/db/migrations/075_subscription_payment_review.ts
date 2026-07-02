import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('subscription_payments', (t) => {
    t.text('review_note').nullable();
    t.uuid('reviewed_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('reviewed_at').nullable();
    // 'more_info' extends the existing status enum
  });

  // Extend the payment_status_type enum to include more_info
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_enum WHERE enumlabel = 'more_info'
          AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'payment_status_type')
      ) THEN
        ALTER TYPE payment_status_type ADD VALUE 'more_info';
      END IF;
    END$$;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('subscription_payments', (t) => {
    t.dropColumn('review_note');
    t.dropColumn('reviewed_by');
    t.dropColumn('reviewed_at');
  });
}
