import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('whatsapp_otp', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('phone', 20).notNullable();          // normalized +8801XXXXXXXXX
    t.string('otp_hash', 64).notNullable();        // SHA-256 of the 6-digit code
    t.string('token', 64).notNullable().unique();  // issued after successful verify
    t.boolean('verified').notNullable().defaultTo(false);
    t.integer('attempts').notNullable().defaultTo(0);
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
  });
  await knex.raw(`CREATE INDEX idx_whatsapp_otp_phone ON whatsapp_otp(phone)`);
  await knex.raw(`CREATE INDEX idx_whatsapp_otp_token ON whatsapp_otp(token)`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('whatsapp_otp');
}
