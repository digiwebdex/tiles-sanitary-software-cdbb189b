import type { Knex } from 'knex';

/** Extend Free Trial plan from 3 → 7 days for new signups and marketing parity. */
export async function up(knex: Knex): Promise<void> {
  const rows = await knex('plans').whereRaw("lower(name) = 'free trial'");

  for (const row of rows) {
    let features: string[] = [];
    if (Array.isArray(row.features)) {
      features = row.features as string[];
    } else if (typeof row.features === 'string') {
      try {
        features = JSON.parse(row.features) as string[];
      } catch {
        features = [];
      }
    }

    const updatedFeatures = features.map((f) =>
      f === '3 days access' ? '7 days access' : f,
    );

    await knex('plans').where({ id: row.id }).update({
      trial_days: 7,
      features: JSON.stringify(updatedFeatures),
      updated_at: knex.fn.now(),
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const rows = await knex('plans').whereRaw("lower(name) = 'free trial'");

  for (const row of rows) {
    let features: string[] = [];
    if (Array.isArray(row.features)) {
      features = row.features as string[];
    } else if (typeof row.features === 'string') {
      try {
        features = JSON.parse(row.features) as string[];
      } catch {
        features = [];
      }
    }

    const updatedFeatures = features.map((f) =>
      f === '7 days access' ? '3 days access' : f,
    );

    await knex('plans').where({ id: row.id }).update({
      trial_days: 3,
      features: JSON.stringify(updatedFeatures),
      updated_at: knex.fn.now(),
    });
  }
}
