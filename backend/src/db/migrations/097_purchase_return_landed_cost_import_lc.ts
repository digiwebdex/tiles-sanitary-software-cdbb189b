import type { Knex } from 'knex';

/**
 * V2 Sprint 5E — Purchase Return, Supplier Debit Note (return-driven),
 * Landed Cost, Batch/Stock Cost Update, Import LC (BDT-only tracker).
 *
 * Purely ADDITIVE — no destructive changes, no existing column/table
 * altered in a way that changes its meaning for existing rows.
 *
 * Design decisions (asked of the user via AskUserQuestion; no response was
 * given, so the recommended defaults below were used — see
 * docs/SPRINT5E_PURCHASE_RETURN.md for the full rationale):
 *
 * 1. Purchase Return reduces what's owed to the supplier — a NEW ledger
 *    entry type `'purchase_return'` (stored POSITIVE, same sign convention
 *    as `'credit_note'`/`'refund'`), kept entirely separate from Sprint 5D's
 *    `'debit_note'` (which increases what's owed and stays exactly as
 *    approved — e.g. for a supplier under-billing correction).
 * 2. A completed Purchase Return only adjusts the running supplier balance
 *    — it does NOT auto-post a cash refund (unlike the legacy pre-V2
 *    purchase-return flow in `returns.ts`, which is untouched and keeps its
 *    own behavior for backward compatibility).
 * 3. Import LC is a BDT-only paperwork/status tracker (no FX conversion —
 *    Multi-currency is explicitly out of scope this sprint).
 *
 * Reuse notes:
 * - `purchase_returns`/`purchase_return_items` (migration 001) are reused
 *   AS-IS for the header/line rows — both tables already had everything a
 *   V2-pipeline-aware return needs except line-level source/location
 *   linkage, added below. `purchase_returns.purchase_id` already references
 *   `purchases(id)` and therefore already works for a Purchase-Invoice-flow
 *   purchase (Sprint 5D made an Invoice literally BE a `purchases` row) —
 *   no header changes needed.
 * - No per-batch cost column exists anywhere in this codebase (confirmed by
 *   inspection) — cost lives only on the dealer-wide `stock` row. "Batch
 *   Cost Update" is therefore implemented as a dealer-wide product cost
 *   adjustment, audited via `stock_cost_adjustments`, NOT a true per-batch
 *   cost override (that would be a much larger, architecture-changing
 *   effort out of proportion for this sprint — documented transparently).
 * - "Vendor" (Import LC scope) is not a new entity — it reuses the existing
 *   `suppliers` table via `supplier_id`, since no separate vendor concept
 *   exists or is needed.
 */
export async function up(knex: Knex): Promise<void> {
  // ── 1. Purchase Return — line-level source + location linkage ──────────
  await knex.schema.alterTable('purchase_return_items', (t) => {
    t.uuid('source_purchase_item_id').references('id').inTable('purchase_items').onDelete('SET NULL');
    t.uuid('warehouse_id').references('id').inTable('warehouses').onDelete('SET NULL');
    t.uuid('godown_id').references('id').inTable('godowns').onDelete('SET NULL');
    t.uuid('rack_id').references('id').inTable('racks').onDelete('SET NULL');
  });
  await knex.schema.alterTable('purchase_return_items', (t) => {
    t.index('source_purchase_item_id');
  });

  // ── 2. Supplier Ledger — new entry type + return linkage ───────────────
  await knex.raw(`ALTER TYPE ledger_entry_type ADD VALUE IF NOT EXISTS 'purchase_return'`);
  await knex.schema.alterTable('supplier_ledger', (t) => {
    t.uuid('purchase_return_id').references('id').inTable('purchase_returns').onDelete('SET NULL');
  });
  await knex.schema.alterTable('supplier_ledger', (t) => {
    t.index('purchase_return_id');
  });

  // ── 3. Landed Cost — shipment-level charges allocated across invoice lines ──
  await knex.schema.createTable('landed_cost_sheets', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('dealer_id').notNullable().references('id').inTable('dealers').onDelete('CASCADE');
    t.uuid('purchase_id').notNullable().references('id').inTable('purchases').onDelete('CASCADE');
    t.string('sheet_no', 50).notNullable();
    t.date('sheet_date').notNullable().defaultTo(knex.fn.now());
    t.decimal('freight_amount', 14, 2).notNullable().defaultTo(0);
    t.decimal('insurance_amount', 14, 2).notNullable().defaultTo(0);
    t.decimal('customs_duty_amount', 14, 2).notNullable().defaultTo(0);
    t.decimal('vat_amount', 14, 2).notNullable().defaultTo(0);
    t.decimal('port_charges_amount', 14, 2).notNullable().defaultTo(0);
    t.decimal('cf_charges_amount', 14, 2).notNullable().defaultTo(0);
    t.decimal('local_transport_amount', 14, 2).notNullable().defaultTo(0);
    t.decimal('other_charges_amount', 14, 2).notNullable().defaultTo(0);
    t.decimal('total_amount', 14, 2).notNullable().defaultTo(0);
    t.string('status', 20).notNullable().defaultTo('draft'); // draft | applied | cancelled
    t.text('notes');
    t.timestamp('applied_at', { useTz: true });
    t.uuid('created_by');
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    t.index('dealer_id');
    t.index('purchase_id');
  });

  await knex.schema.createTable('landed_cost_sheet_items', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('landed_cost_sheet_id').notNullable().references('id').inTable('landed_cost_sheets').onDelete('CASCADE');
    t.uuid('dealer_id').notNullable().references('id').inTable('dealers').onDelete('CASCADE');
    t.uuid('purchase_item_id').notNullable().references('id').inTable('purchase_items').onDelete('CASCADE');
    t.uuid('product_id').notNullable().references('id').inTable('products').onDelete('RESTRICT');
    t.decimal('line_value', 14, 2).notNullable(); // snapshot: quantity * purchase_rate, used for proportional allocation
    t.decimal('qty_base', 14, 4).notNullable(); // snapshot: sft_qty or piece_qty basis at allocation time
    t.decimal('allocated_amount', 14, 2).notNullable().defaultTo(0);
    t.decimal('avg_cost_before', 14, 4);
    t.decimal('avg_cost_after', 14, 4);
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    t.index('landed_cost_sheet_id');
  });

  // ── 4. Batch/Stock Cost Update — audit trail for any average_cost_per_unit change outside a normal receipt ──
  await knex.schema.createTable('stock_cost_adjustments', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('dealer_id').notNullable().references('id').inTable('dealers').onDelete('CASCADE');
    t.uuid('product_id').notNullable().references('id').inTable('products').onDelete('CASCADE');
    t.decimal('old_avg_cost', 14, 4).notNullable();
    t.decimal('new_avg_cost', 14, 4).notNullable();
    t.text('reason').notNullable();
    t.string('adjustment_type', 20).notNullable().defaultTo('manual'); // manual | landed_cost
    t.uuid('landed_cost_sheet_id').references('id').inTable('landed_cost_sheets').onDelete('SET NULL');
    t.uuid('created_by');
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    t.index('dealer_id');
    t.index('product_id');
  });

  // ── 5. Import LC — BDT-only Proforma Invoice / LC / Shipment / Container tracker ──
  await knex.schema.createTable('import_proforma_invoices', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('dealer_id').notNullable().references('id').inTable('dealers').onDelete('CASCADE');
    t.uuid('supplier_id').notNullable().references('id').inTable('suppliers').onDelete('RESTRICT');
    t.string('pi_number', 50).notNullable();
    t.date('pi_date').notNullable().defaultTo(knex.fn.now());
    t.decimal('total_amount', 14, 2).notNullable().defaultTo(0);
    t.string('currency_note', 255); // e.g. "USD 12,000 @ approx rate" — no FX conversion (Multi-currency out of scope)
    t.string('status', 20).notNullable().defaultTo('draft'); // draft | confirmed | cancelled
    t.text('notes');
    t.uuid('created_by');
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    t.index('dealer_id');
  });

  await knex.schema.createTable('import_letters_of_credit', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('dealer_id').notNullable().references('id').inTable('dealers').onDelete('CASCADE');
    t.uuid('proforma_invoice_id').references('id').inTable('import_proforma_invoices').onDelete('SET NULL');
    t.uuid('supplier_id').notNullable().references('id').inTable('suppliers').onDelete('RESTRICT');
    t.string('lc_number', 50).notNullable();
    t.date('lc_date').notNullable().defaultTo(knex.fn.now());
    t.string('issuing_bank', 255);
    t.decimal('lc_amount', 14, 2).notNullable().defaultTo(0);
    t.date('expiry_date');
    t.string('status', 20).notNullable().defaultTo('draft'); // draft | opened | amended | closed | cancelled
    t.text('notes');
    t.uuid('created_by');
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    t.index('dealer_id');
    t.index('proforma_invoice_id');
  });

  await knex.schema.createTable('import_shipments', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('dealer_id').notNullable().references('id').inTable('dealers').onDelete('CASCADE');
    t.uuid('letter_of_credit_id').references('id').inTable('import_letters_of_credit').onDelete('SET NULL');
    t.uuid('supplier_id').notNullable().references('id').inTable('suppliers').onDelete('RESTRICT');
    t.uuid('purchase_id').references('id').inTable('purchases').onDelete('SET NULL'); // optional cross-reference once invoiced via the normal pipeline
    t.string('shipment_ref', 100).notNullable();
    t.string('vessel_name', 255);
    t.string('port_of_loading', 255);
    t.string('port_of_discharge', 255);
    t.date('eta_date');
    t.date('actual_arrival_date');
    t.string('cf_agent_name', 255);
    t.string('cf_agent_contact', 100);
    t.string('customs_bill_of_entry_no', 100);
    t.date('customs_clearance_date');
    t.string('status', 30).notNullable().defaultTo('in_transit'); // in_transit | arrived | customs_clearance | cleared | cancelled
    t.text('notes');
    t.uuid('created_by');
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    t.index('dealer_id');
    t.index('letter_of_credit_id');
  });

  await knex.schema.createTable('import_shipment_containers', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('import_shipment_id').notNullable().references('id').inTable('import_shipments').onDelete('CASCADE');
    t.uuid('dealer_id').notNullable().references('id').inTable('dealers').onDelete('CASCADE');
    t.string('container_no', 50).notNullable();
    t.string('container_size', 20); // e.g. 20ft | 40ft
    t.string('seal_no', 50);
    t.text('notes');
    t.index('import_shipment_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('import_shipment_containers');
  await knex.schema.dropTableIfExists('import_shipments');
  await knex.schema.dropTableIfExists('import_letters_of_credit');
  await knex.schema.dropTableIfExists('import_proforma_invoices');
  await knex.schema.dropTableIfExists('stock_cost_adjustments');
  await knex.schema.dropTableIfExists('landed_cost_sheet_items');
  await knex.schema.dropTableIfExists('landed_cost_sheets');

  await knex.schema.alterTable('supplier_ledger', (t) => {
    t.dropColumn('purchase_return_id');
  });
  await knex.schema.alterTable('purchase_return_items', (t) => {
    t.dropColumn('source_purchase_item_id');
    t.dropColumn('warehouse_id');
    t.dropColumn('godown_id');
    t.dropColumn('rack_id');
  });

  // Note: PostgreSQL cannot remove a value from an enum type; the
  // 'purchase_return' ledger_entry_type value is left in place on rollback
  // — harmless, matching every prior enum-extending migration in this codebase.
}
