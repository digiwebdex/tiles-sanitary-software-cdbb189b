import type { Knex } from 'knex';

/**
 * Formal Purchase Orders (legacy BanglaERP parity): advance order to a
 * supplier with expected delivery and advance payment, later converted
 * into a purchase draft when the goods arrive.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('purchase_orders', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('dealer_id').notNullable().references('id').inTable('dealers').onDelete('CASCADE');
    t.string('po_number', 30).notNullable();
    t.uuid('supplier_id').notNullable().references('id').inTable('suppliers');
    t.date('order_date').notNullable();
    t.date('expected_delivery_date');
    t.string('status', 20).notNullable().defaultTo('ordered'); // ordered | received | cancelled
    t.decimal('advance_paid', 14, 2).notNullable().defaultTo(0);
    t.decimal('total_amount', 14, 2).notNullable().defaultTo(0);
    t.text('notes');
    t.uuid('converted_draft_id');
    t.uuid('created_by');
    t.timestamps(true, true);
    t.unique(['dealer_id', 'po_number']);
    t.index(['dealer_id', 'status']);
  });

  await knex.schema.createTable('purchase_order_items', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('po_id').notNullable().references('id').inTable('purchase_orders').onDelete('CASCADE');
    t.uuid('product_id').notNullable().references('id').inTable('products');
    t.decimal('quantity', 14, 3).notNullable();
    t.decimal('unit_price', 14, 2).notNullable().defaultTo(0);
    t.decimal('total', 14, 2).notNullable().defaultTo(0);
    t.index(['po_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('purchase_order_items');
  await knex.schema.dropTableIfExists('purchase_orders');
}
