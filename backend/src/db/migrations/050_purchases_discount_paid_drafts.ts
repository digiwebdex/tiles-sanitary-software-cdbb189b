import type { Knex } from "knex";

/**
 * Phase 3U-31: Purchase form upgrade.
 *
 *   1. purchases.voucher_discount   numeric(14,2)  default 0
 *   2. purchases.paid_on_create     numeric(14,2)  default 0
 *   3. purchases.paid_account_id    uuid           nullable
 *      └─ nullable FK to bank_accounts (NULL = cash)
 *   4. purchase_drafts              new table for "Save as Draft"
 *
 * Backward compat: existing purchases get 0 / 0 / NULL.
 * The frontend defaults `paid_on_create` to the full purchase amount on
 * create, so live accounting behavior is preserved.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE public.purchases
      ADD COLUMN IF NOT EXISTS voucher_discount numeric(14,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS paid_on_create   numeric(14,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS paid_account_id  uuid NULL
        REFERENCES public.bank_accounts(id) ON DELETE SET NULL;
  `);

  await knex.schema.createTable("purchase_drafts", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.uuid("dealer_id")
      .notNullable()
      .references("id")
      .inTable("dealers")
      .onDelete("CASCADE");
    t.uuid("created_by"); // auth.users id snapshot, no FK (consistent with other tables)
    t.string("label", 120);
    t.jsonb("payload").notNullable();
    t.timestamp("created_at", { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    t.timestamp("updated_at", { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    t.index(["dealer_id", "created_by"]);
    t.index(["dealer_id", "updated_at"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("purchase_drafts");
  await knex.raw(`
    ALTER TABLE public.purchases
      DROP COLUMN IF EXISTS paid_account_id,
      DROP COLUMN IF EXISTS paid_on_create,
      DROP COLUMN IF EXISTS voucher_discount;
  `);
}
