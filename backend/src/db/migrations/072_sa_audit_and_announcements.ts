import type { Knex } from 'knex';

/**
 * Platform-level Super Admin features:
 *   1. sa_audit_log         — records every super-admin action (who/what/when/IP)
 *   2. platform_announcements — broadcast banners pushed to dealers
 *
 * Both are platform-scoped (NOT dealer-scoped). The dealer-scoped `audit_logs`
 * and `notices` tables remain untouched.
 */
export async function up(knex: Knex): Promise<void> {
  // ── Super Admin audit log ──────────────────────────────────────────
  const hasAudit = await knex.schema.hasTable('sa_audit_log');
  if (!hasAudit) {
    await knex.schema.createTable('sa_audit_log', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('actor_user_id').nullable();
      t.string('actor_email').nullable();
      t.string('action').notNullable();           // e.g. 'dealer.suspend'
      t.string('target_type').nullable();          // 'dealer' | 'plan' | 'subscription' | ...
      t.string('target_id').nullable();            // uuid or key of the affected entity
      t.string('target_label').nullable();         // human-friendly name
      t.jsonb('details').nullable();               // arbitrary before/after or context
      t.string('ip_address').nullable();
      t.string('user_agent').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());

      t.index(['created_at'], 'idx_sa_audit_created');
      t.index(['action'], 'idx_sa_audit_action');
      t.index(['actor_user_id'], 'idx_sa_audit_actor');
      t.index(['target_type', 'target_id'], 'idx_sa_audit_target');
    });
  }

  // ── Platform announcements (broadcast) ─────────────────────────────
  const hasAnn = await knex.schema.hasTable('platform_announcements');
  if (!hasAnn) {
    await knex.schema.createTable('platform_announcements', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.string('title').notNullable();
      t.text('body').notNullable();
      // info | warning | critical | success
      t.string('severity').notNullable().defaultTo('info');
      // all | active | expiring | trial | suspended
      t.string('audience').notNullable().defaultTo('all');
      t.boolean('is_active').notNullable().defaultTo(true);
      t.boolean('dismissible').notNullable().defaultTo(true);
      t.timestamp('start_at').nullable();
      t.timestamp('end_at').nullable();
      t.uuid('created_by').nullable();
      t.string('created_by_email').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.timestamp('updated_at').defaultTo(knex.fn.now());

      t.index(['is_active'], 'idx_ann_active');
      t.index(['audience'], 'idx_ann_audience');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('platform_announcements');
  await knex.schema.dropTableIfExists('sa_audit_log');
}
