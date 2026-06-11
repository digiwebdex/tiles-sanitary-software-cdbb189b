import type { Knex } from 'knex';

/**
 * Phase 5 — VAT / Mushak foundation (P5-01, P5-02, P5-03 table).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE public.customers
      ADD COLUMN IF NOT EXISTS tax_id varchar(50) NULL;
  `);

  await knex.raw(`
    ALTER TABLE public.dealers
      ADD COLUMN IF NOT EXISTS vat_enabled boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS default_vat_rate numeric(5,2) NOT NULL DEFAULT 15.00;
  `);

  await knex.raw(`
    ALTER TABLE public.sales
      ADD COLUMN IF NOT EXISTS taxable_amount numeric(14,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS vat_rate numeric(5,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS vat_amount numeric(14,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS sd_amount numeric(14,2) NOT NULL DEFAULT 0;
  `);

  await knex.raw(`
    ALTER TABLE public.purchases
      ADD COLUMN IF NOT EXISTS taxable_amount numeric(14,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS vat_rate numeric(5,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS vat_amount numeric(14,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS sd_amount numeric(14,2) NOT NULL DEFAULT 0;
  `);

  await knex.raw(`
    UPDATE public.sales
    SET taxable_amount = COALESCE(total_amount, 0)
    WHERE taxable_amount = 0 AND COALESCE(vat_amount, 0) = 0;
  `);

  await knex.raw(`
    UPDATE public.purchases p
    SET taxable_amount = GREATEST(0, COALESCE(p.total_amount, 0) - COALESCE(p.voucher_discount, 0))
    WHERE taxable_amount = 0 AND COALESCE(vat_amount, 0) = 0;
  `);

  const hasTaxLines = await knex.schema.hasTable('tax_posting_lines');
  if (!hasTaxLines) {
    await knex.schema.createTable('tax_posting_lines', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('dealer_id')
        .notNullable()
        .references('id')
        .inTable('dealers')
        .onDelete('CASCADE');
      t.uuid('posting_batch_id')
        .nullable()
        .references('id')
        .inTable('posting_batches')
        .onDelete('SET NULL');
      t.text('document_type').notNullable();
      t.uuid('document_id').notNullable();
      t.text('tax_type').notNullable().defaultTo('vat');
      t.decimal('taxable_amount', 14, 2).notNullable().defaultTo(0);
      t.decimal('tax_rate', 5, 2).notNullable().defaultTo(0);
      t.decimal('tax_amount', 14, 2).notNullable().defaultTo(0);
      t.decimal('sd_amount', 14, 2).notNullable().defaultTo(0);
      t.date('entry_date').notNullable();
      t.uuid('party_id').nullable();
      t.text('party_tax_id').nullable();
      t.text('mushak_form').nullable();
      t.jsonb('metadata').notNullable().defaultTo('{}');
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.index(['dealer_id', 'entry_date']);
      t.index(['dealer_id', 'document_type', 'document_id']);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('tax_posting_lines');
  await knex.raw(`
    ALTER TABLE public.purchases
      DROP COLUMN IF EXISTS sd_amount,
      DROP COLUMN IF EXISTS vat_amount,
      DROP COLUMN IF EXISTS vat_rate,
      DROP COLUMN IF EXISTS taxable_amount;
  `);
  await knex.raw(`
    ALTER TABLE public.sales
      DROP COLUMN IF EXISTS sd_amount,
      DROP COLUMN IF EXISTS vat_amount,
      DROP COLUMN IF EXISTS vat_rate,
      DROP COLUMN IF EXISTS taxable_amount;
  `);
  await knex.raw(`
    ALTER TABLE public.dealers
      DROP COLUMN IF EXISTS default_vat_rate,
      DROP COLUMN IF EXISTS vat_enabled;
  `);
  await knex.raw(`ALTER TABLE public.customers DROP COLUMN IF EXISTS tax_id;`);
}
