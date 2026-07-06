import type { Knex } from 'knex';

/**
 * V2 Sprint 3D — Inventory Intelligence.
 *
 * Purely ADDITIVE: one new table, no existing table touched. Deliberately
 * does NOT add columns to `products` (Product Master is explicitly frozen
 * for this sprint) — Min/Max Stock live in their own small table instead,
 * FK'd to `products` but owned by Inventory Intelligence.
 *
 * Everything else this sprint needs (Reorder Level, Safety Stock via
 * velocity, Dead/Slow/Fast-moving flags, Reorder Suggestions) already exists
 * — see docs/SPRINT3D_INVENTORY_INTELLIGENCE.md §1 for the full inventory of
 * what was reused vs. genuinely missing. No other schema change was needed.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('product_stock_thresholds', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('dealer_id').notNullable().references('id').inTable('dealers').onDelete('CASCADE');
    t.uuid('product_id').notNullable().references('id').inTable('products').onDelete('CASCADE');
    t.decimal('min_stock', 14, 4);
    t.decimal('max_stock', 14, 4);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['dealer_id', 'product_id']);
    t.index('dealer_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('product_stock_thresholds');
}
