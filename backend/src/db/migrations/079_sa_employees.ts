import type { Knex } from 'knex';

/**
 * SA Employee account system.
 *
 * Adds `sa_employee` to the app_role enum so company staff (sales reps,
 * support agents, finance team) can log in to the Super Admin panel with
 * scoped access.  Each employee gets a row in `sa_employee_permissions`
 * that controls which SA sections they can see/act on.
 */
export async function up(knex: Knex): Promise<void> {
  // 1. Extend app_role enum — safe to add in Postgres
  await knex.raw(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_enum
        WHERE enumlabel = 'sa_employee'
          AND enumtypid = 'app_role'::regtype
      ) THEN
        ALTER TYPE app_role ADD VALUE 'sa_employee';
      END IF;
    END $$;
  `);

  // 2. Employee permission table (one row per sa_employee user)
  const exists = await knex.schema.hasTable('sa_employee_permissions');
  if (!exists) {
    await knex.schema.createTable('sa_employee_permissions', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
      t.string('designation', 100).nullable().comment('Job title shown in UI e.g. Sales Manager');

      // ── Access flags ──────────────────────────────────────────────────────
      t.boolean('can_manage_dealers').notNullable().defaultTo(false)
        .comment('Create / edit / activate / suspend dealer accounts');
      t.boolean('can_manage_subscriptions').notNullable().defaultTo(false)
        .comment('Assign plans, record payments, extend subscriptions');
      t.boolean('can_view_financials').notNullable().defaultTo(false)
        .comment('View subscription payment history and revenue data');
      t.boolean('can_send_reminders').notNullable().defaultTo(false)
        .comment('Manually trigger expiry reminder notifications');
      t.boolean('can_view_audit_log').notNullable().defaultTo(false)
        .comment('Read the SA audit trail');
      t.boolean('can_manage_announcements').notNullable().defaultTo(false)
        .comment('Create and broadcast system-wide announcements');
      t.boolean('can_view_dealer_users').notNullable().defaultTo(false)
        .comment('View users inside dealer accounts (read-only)');

      t.string('notes', 500).nullable().comment('Internal notes about this employee');
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

      t.unique(['user_id']);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('sa_employee_permissions');
  // Note: Postgres does not support removing enum values — sa_employee stays in enum.
}
