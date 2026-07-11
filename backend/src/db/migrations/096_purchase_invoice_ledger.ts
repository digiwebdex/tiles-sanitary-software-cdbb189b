import type { Knex } from 'knex';

/**
 * V2 Sprint 5D — Purchase Invoice.
 *
 * Purely ADDITIVE, and deliberately does NOT introduce a new invoice table:
 * `purchases`/`purchase_items` already have everything a Purchase Invoice
 * needs (invoice_number, VAT breakdown columns, a `document_status` enum
 * whose 'draft'/'pending_approval' values have existed since migration 058
 * but were never exercised by any code — same story as Sprint 5C finding
 * `purchase_orders.status`'s partially_received/fully_received dormant).
 * Storing invoices in the existing table means every existing report that
 * already reads `purchases`/`supplier_ledger` (mv_supplier_payable,
 * payablesService, supplierPerformanceService, recordSupplierPaymentFifo,
 * autoPo.ts's last-purchase-rate) picks up a Goods-Receipt-sourced invoice
 * automatically — no new read path needed.
 *
 * 1. `purchases.document_status` CHECK — widen to add 'cancelled' (Cancel
 *    Invoice, draft-only — never applies to an already-`posted` invoice,
 *    which would need a real reversal/Purchase-Return-style flow, out of
 *    scope this sprint).
 * 2. `ledger_entry_type` enum — add 'credit_note'/'debit_note' (Supplier
 *    Ledger scope item). These are manual adjustment entries a dealer_admin
 *    records directly against a supplier — NOT an automatic byproduct of a
 *    Purchase Return (explicitly out of scope), mirroring how 'adjustment'
 *    already works as a standalone manual entry type today.
 * 3. `purchase_items.source_goods_receipt_item_id` — nullable FK, links an
 *    invoice line back to the Goods Receipt line it was generated from.
 *    Used to compute "already invoiced" quantity per GRN line (over-invoice
 *    prevention) and to support partial/multiple-GRN invoicing. NULL for
 *    every pre-existing purchase_items row (the old quick-entry flow,
 *    completely unaffected) and for any future quick-entry purchase.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE public.purchases
      DROP CONSTRAINT IF EXISTS purchases_document_status_check
  `);
  await knex.raw(`
    ALTER TABLE public.purchases
      ADD CONSTRAINT purchases_document_status_check
      CHECK (document_status IN ('draft', 'pending_approval', 'posted', 'reversed', 'cancelled'))
  `);

  // Postgres requires ADD VALUE outside an explicit transaction; this
  // migration only adds the values and never reads/writes a row using
  // them, so it's safe under any PG version (same pattern as migrations
  // 016/075/079/089/094).
  await knex.raw(`ALTER TYPE ledger_entry_type ADD VALUE IF NOT EXISTS 'credit_note'`);
  await knex.raw(`ALTER TYPE ledger_entry_type ADD VALUE IF NOT EXISTS 'debit_note'`);

  await knex.schema.alterTable('purchase_items', (t) => {
    t.uuid('source_goods_receipt_item_id').references('id').inTable('goods_receipt_items').onDelete('SET NULL');
  });
  await knex.schema.alterTable('purchase_items', (t) => {
    t.index('source_goods_receipt_item_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('purchase_items', (t) => {
    t.dropColumn('source_goods_receipt_item_id');
  });

  await knex.raw(`
    ALTER TABLE public.purchases
      DROP CONSTRAINT IF EXISTS purchases_document_status_check
  `);
  await knex.raw(`
    ALTER TABLE public.purchases
      ADD CONSTRAINT purchases_document_status_check
      CHECK (document_status IN ('draft', 'pending_approval', 'posted', 'reversed'))
  `);

  // Note: PostgreSQL cannot remove a value from an enum type; the
  // 'credit_note'/'debit_note' ledger_entry_type values are left in place
  // on rollback (harmless — matches how every prior enum-extending
  // migration in this codebase already handles this).
}
