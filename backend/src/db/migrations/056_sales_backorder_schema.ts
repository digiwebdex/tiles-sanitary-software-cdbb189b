import type { Knex } from 'knex';

/**
 * Backorder schema — sales.has_backorder, sale_items.available_qty_at_sale,
 * backorder_allocations table. Supabase had these; Knex chain was incomplete.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE public.sales
      ADD COLUMN IF NOT EXISTS has_backorder boolean NOT NULL DEFAULT false;
  `);

  await knex.raw(`
    ALTER TABLE public.sale_items
      ADD COLUMN IF NOT EXISTS available_qty_at_sale numeric(14,4) NOT NULL DEFAULT 0;
  `);

  const hasTable = await knex.schema.hasTable('backorder_allocations');
  if (!hasTable) {
    await knex.schema.createTable('backorder_allocations', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('dealer_id').notNullable().references('id').inTable('dealers').onDelete('CASCADE');
      t.uuid('sale_item_id').notNullable().references('id').inTable('sale_items').onDelete('CASCADE');
      t.uuid('purchase_item_id').notNullable().references('id').inTable('purchase_items').onDelete('CASCADE');
      t.uuid('product_id').notNullable().references('id').inTable('products').onDelete('CASCADE');
      t.decimal('allocated_qty', 14, 4).notNullable().defaultTo(0);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['dealer_id']);
      t.index(['sale_item_id']);
      t.index(['product_id']);
    });
  }

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_sales_has_backorder
      ON public.sales (dealer_id)
      WHERE has_backorder = true;
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_sale_items_backorder
      ON public.sale_items (product_id, dealer_id)
      WHERE backorder_qty > 0;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP INDEX IF EXISTS public.idx_sale_items_backorder;`);
  await knex.raw(`DROP INDEX IF EXISTS public.idx_sales_has_backorder;`);
  await knex.schema.dropTableIfExists('backorder_allocations');
  await knex.raw(`
    ALTER TABLE public.sale_items
      DROP COLUMN IF EXISTS available_qty_at_sale;
  `);
  await knex.raw(`
    ALTER TABLE public.sales
      DROP COLUMN IF EXISTS has_backorder;
  `);
}
