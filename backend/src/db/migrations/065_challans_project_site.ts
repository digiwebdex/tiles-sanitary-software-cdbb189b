import type { Knex } from 'knex';

/** Challans/deliveries project+site columns (parity with Supabase batch 2). */
export async function up(knex: Knex): Promise<void> {
  const hasChallanProject = await knex.schema.hasColumn('challans', 'project_id');
  if (!hasChallanProject) {
    await knex.schema.alterTable('challans', (t) => {
      t.uuid('project_id').nullable().references('id').inTable('projects').onDelete('SET NULL');
      t.uuid('site_id').nullable().references('id').inTable('project_sites').onDelete('SET NULL');
    });
    await knex.raw(
      'CREATE INDEX IF NOT EXISTS idx_challans_project_id ON challans(project_id) WHERE project_id IS NOT NULL',
    );
    await knex.raw(
      'CREATE INDEX IF NOT EXISTS idx_challans_site_id ON challans(site_id) WHERE site_id IS NOT NULL',
    );
  }

  const hasDeliveryProject = await knex.schema.hasColumn('deliveries', 'project_id');
  if (!hasDeliveryProject) {
    await knex.schema.alterTable('deliveries', (t) => {
      t.uuid('project_id').nullable().references('id').inTable('projects').onDelete('SET NULL');
      t.uuid('site_id').nullable().references('id').inTable('project_sites').onDelete('SET NULL');
    });
    await knex.raw(
      'CREATE INDEX IF NOT EXISTS idx_deliveries_project_id ON deliveries(project_id) WHERE project_id IS NOT NULL',
    );
    await knex.raw(
      'CREATE INDEX IF NOT EXISTS idx_deliveries_site_id ON deliveries(site_id) WHERE site_id IS NOT NULL',
    );
  }

  await knex.raw(`
    UPDATE challans c
    SET project_id = s.project_id, site_id = s.site_id
    FROM sales s
    WHERE c.sale_id = s.id
      AND c.project_id IS NULL
      AND s.project_id IS NOT NULL
  `);

  await knex.raw(`
    UPDATE deliveries d
    SET project_id = s.project_id, site_id = s.site_id
    FROM sales s
    WHERE d.sale_id = s.id
      AND d.project_id IS NULL
      AND s.project_id IS NOT NULL
  `);

  // Active subscriptions with null end_date → 1 year from start (fixes Read-Only UI).
  await knex.raw(`
    UPDATE subscriptions
    SET end_date = (COALESCE(start_date, CURRENT_DATE) + INTERVAL '365 days')::date
    WHERE end_date IS NULL AND status = 'active'
  `);
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('challans', 'project_id')) {
    await knex.schema.alterTable('challans', (t) => {
      t.dropColumn('project_id');
      t.dropColumn('site_id');
    });
  }
  if (await knex.schema.hasColumn('deliveries', 'project_id')) {
    await knex.schema.alterTable('deliveries', (t) => {
      t.dropColumn('project_id');
      t.dropColumn('site_id');
    });
  }
}
