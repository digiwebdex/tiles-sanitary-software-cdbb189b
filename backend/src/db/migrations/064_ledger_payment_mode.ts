import type { Knex } from 'knex';

/**
 * P5-06 — persist payment_mode on cash/bank ledger for bKash, Nagad, SSLCommerz traceability.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE public.cash_ledger
      ADD COLUMN IF NOT EXISTS payment_mode varchar(30) NULL;
  `);
  await knex.raw(`
    ALTER TABLE public.bank_ledger
      ADD COLUMN IF NOT EXISTS payment_mode varchar(30) NULL;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TABLE public.bank_ledger DROP COLUMN IF EXISTS payment_mode;`);
  await knex.raw(`ALTER TABLE public.cash_ledger DROP COLUMN IF EXISTS payment_mode;`);
}
