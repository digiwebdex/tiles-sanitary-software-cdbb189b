import type { Knex } from 'knex';

/**
 * V2 Sprint 4A — Customer & Quotation Foundation.
 *
 * Purely ADDITIVE. Extends the existing `customer_type` enum (created in
 * migration 001) with 4 new values so the existing single `customers.type`
 * column can represent Dealer/Contractor/Builder/Corporate Customer, without
 * introducing a parallel "category" concept or a new table. The 3 original
 * values ('retailer', 'customer', 'project') and every existing row's value
 * are completely unaffected — `ALTER TYPE ... ADD VALUE` only appends.
 *
 * `customer_group` is a separate, simpler concept (a dealer-defined free-text
 * label, e.g. "VIP", "Wholesale Batch A") — deliberately a plain nullable
 * column, not a new lookup table, matching this schema's existing pattern
 * for lightweight taxonomy (e.g. products.series/collection_name).
 *
 * `default_discount_type`/`default_discount_value` are a customer-level
 * DEFAULT/POLICY hint for quotations to pre-fill from — NOT an enforced
 * discount. `quotations.discount_type`/`discount_value` (migration 022)
 * remain the actual applied discount and are untouched.
 *
 * NOTE ON `ALTER TYPE ... ADD VALUE`: in PostgreSQL, a new enum value cannot
 * be *used* in the same transaction it was added in (pre-PG12 restriction;
 * PG12+ lifted it for simple cases, but this migration only ADDS values —
 * it never reads/writes rows using them — so it is safe under either
 * version and requires no special transaction handling.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TYPE customer_type ADD VALUE IF NOT EXISTS 'dealer'`);
  await knex.raw(`ALTER TYPE customer_type ADD VALUE IF NOT EXISTS 'contractor'`);
  await knex.raw(`ALTER TYPE customer_type ADD VALUE IF NOT EXISTS 'builder'`);
  await knex.raw(`ALTER TYPE customer_type ADD VALUE IF NOT EXISTS 'corporate'`);

  await knex.schema.alterTable('customers', (t) => {
    t.string('customer_group', 100);
    t.string('default_discount_type', 10);
    t.decimal('default_discount_value', 14, 2).notNullable().defaultTo(0);
  });

  await knex.raw(`
    ALTER TABLE public.customers
      ADD CONSTRAINT chk_customers_default_discount_type
      CHECK (default_discount_type IS NULL OR default_discount_type IN ('flat', 'percent'))
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS chk_customers_default_discount_type`);
  await knex.schema.alterTable('customers', (t) => {
    t.dropColumn('customer_group');
    t.dropColumn('default_discount_type');
    t.dropColumn('default_discount_value');
  });
  // Postgres cannot drop enum values — the 4 added values are left in place
  // (harmless; no row will reference them after a down-migration reverts
  // the columns that would have been set via those types).
}
