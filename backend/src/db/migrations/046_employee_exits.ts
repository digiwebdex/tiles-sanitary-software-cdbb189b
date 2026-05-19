import type { Knex } from 'knex';

/**
 * Phase 20 — Employee Exit / Offboarding Workflow
 *
 *   employee_exits             exit header (resignation, last working day, status, settlement totals)
 *   employee_exit_clearances   per-department clearance checklist rows
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('employee_exits', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('dealer_id').notNullable().references('id').inTable('dealers').onDelete('CASCADE');
    t.uuid('employee_id').notNullable().references('id').inTable('employees').onDelete('CASCADE');
    t.string('exit_code', 40).notNullable();
    t.string('exit_type', 20).notNullable().defaultTo('resignation'); // resignation | termination | retirement | absconding | end_of_contract
    t.date('resignation_date').notNullable();
    t.date('last_working_date').notNullable();
    t.integer('notice_period_days').notNullable().defaultTo(0);
    t.text('reason');
    t.string('status', 20).notNullable().defaultTo('initiated'); // initiated | clearance | settled | cancelled
    // Settlement breakdown
    t.decimal('unpaid_salary', 14, 2).notNullable().defaultTo(0);
    t.decimal('leave_encashment', 14, 2).notNullable().defaultTo(0);
    t.decimal('bonus', 14, 2).notNullable().defaultTo(0);
    t.decimal('gratuity', 14, 2).notNullable().defaultTo(0);
    t.decimal('other_additions', 14, 2).notNullable().defaultTo(0);
    t.decimal('outstanding_loans', 14, 2).notNullable().defaultTo(0);
    t.decimal('outstanding_advances', 14, 2).notNullable().defaultTo(0);
    t.decimal('other_deductions', 14, 2).notNullable().defaultTo(0);
    t.decimal('net_payable', 14, 2).notNullable().defaultTo(0);
    t.string('payment_method', 16); // cash | bank
    t.uuid('bank_account_id').references('id').inTable('bank_accounts').onDelete('SET NULL');
    t.date('settled_date');
    t.text('exit_interview_notes');
    t.text('rehire_eligible_notes');
    t.boolean('rehire_eligible').notNullable().defaultTo(true);
    t.uuid('created_by');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['dealer_id', 'exit_code']);
    t.unique(['dealer_id', 'employee_id', 'status']); // one active exit per employee (cancelled allowed via different code path)
    t.index(['dealer_id', 'status']);
  });

  await knex.schema.createTable('employee_exit_clearances', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('dealer_id').notNullable().references('id').inTable('dealers').onDelete('CASCADE');
    t.uuid('exit_id').notNullable().references('id').inTable('employee_exits').onDelete('CASCADE');
    t.string('department', 40).notNullable(); // HR | Accounts | IT | Admin | Sales | Warehouse
    t.string('item', 200).notNullable();      // e.g. "Return laptop", "Clear pending invoices"
    t.string('status', 16).notNullable().defaultTo('pending'); // pending | done | na
    t.uuid('cleared_by');
    t.timestamp('cleared_at', { useTz: true });
    t.text('remarks');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['dealer_id', 'exit_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('employee_exit_clearances');
  await knex.schema.dropTableIfExists('employee_exits');
}
