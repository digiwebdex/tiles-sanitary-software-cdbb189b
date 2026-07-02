import type { Knex } from 'knex';

/**
 * Phase 6 foundation — portal_users + portal_requests on VPS PostgreSQL.
 * Mirrors Supabase portal schema for eventual portal API cutover (P6-03).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    DO $$ BEGIN
      CREATE TYPE portal_role AS ENUM ('contractor', 'architect', 'project_customer');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;

    DO $$ BEGIN
      CREATE TYPE portal_request_type AS ENUM ('reorder', 'quote');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;

    DO $$ BEGIN
      CREATE TYPE portal_request_status AS ENUM ('pending', 'reviewed', 'converted', 'closed');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);

  const hasPortalUsers = await knex.schema.hasTable('portal_users');
  if (!hasPortalUsers) {
    await knex.schema.createTable('portal_users', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('dealer_id').notNullable().references('id').inTable('dealers').onDelete('CASCADE');
      t.uuid('customer_id').notNullable().references('id').inTable('customers').onDelete('CASCADE');
      t.uuid('auth_user_id').nullable().unique().references('id').inTable('users').onDelete('SET NULL');
      t.string('email', 255).notNullable();
      t.string('name', 255).notNullable();
      t.string('phone', 50).nullable();
      t.specificType('portal_role', 'portal_role').notNullable().defaultTo('contractor');
      t.string('status', 20).notNullable().defaultTo('invited');
      t.timestamp('invited_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('activated_at', { useTz: true }).nullable();
      t.timestamp('last_login_at', { useTz: true }).nullable();
      t.uuid('invited_by').nullable().references('id').inTable('users').onDelete('SET NULL');
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.unique(['dealer_id', 'email']);
      t.index(['dealer_id']);
      t.index(['customer_id']);
      t.index(['auth_user_id']);
    });

    await knex.raw(`
      ALTER TABLE portal_users
      ADD CONSTRAINT portal_users_status_check
      CHECK (status IN ('invited','active','inactive','revoked'))
    `);
  }

  const hasPortalRequests = await knex.schema.hasTable('portal_requests');
  if (!hasPortalRequests) {
    await knex.schema.createTable('portal_requests', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('dealer_id').notNullable().references('id').inTable('dealers').onDelete('CASCADE');
      t.uuid('customer_id').notNullable().references('id').inTable('customers').onDelete('CASCADE');
      t.uuid('portal_user_id').nullable().references('id').inTable('portal_users').onDelete('SET NULL');
      t.specificType('request_type', 'portal_request_type').notNullable();
      t.specificType('status', 'portal_request_status').notNullable().defaultTo('pending');
      t.uuid('source_sale_id').nullable().references('id').inTable('sales').onDelete('SET NULL');
      t.uuid('source_quotation_id').nullable().references('id').inTable('quotations').onDelete('SET NULL');
      t.uuid('project_id').nullable().references('id').inTable('projects').onDelete('SET NULL');
      t.uuid('site_id').nullable().references('id').inTable('project_sites').onDelete('SET NULL');
      t.text('message').nullable();
      t.jsonb('items').notNullable().defaultTo('[]');
      t.text('review_note').nullable();
      t.uuid('reviewed_by').nullable().references('id').inTable('users').onDelete('SET NULL');
      t.timestamp('reviewed_at', { useTz: true }).nullable();
      t.uuid('converted_quotation_id').nullable().references('id').inTable('quotations').onDelete('SET NULL');
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.index(['dealer_id', 'status', 'created_at']);
      t.index(['customer_id', 'created_at']);
      t.index(['portal_user_id']);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('portal_requests');
  await knex.schema.dropTableIfExists('portal_users');
  await knex.raw('DROP TYPE IF EXISTS portal_request_status');
  await knex.raw('DROP TYPE IF EXISTS portal_request_type');
  await knex.raw('DROP TYPE IF EXISTS portal_role');
}
