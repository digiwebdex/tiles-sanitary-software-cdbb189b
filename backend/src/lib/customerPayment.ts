import type { Knex } from 'knex';

export interface RecordCustomerPaymentInput {
  dealerId: string;
  customerId: string;
  amount: number;
  note?: string;
  payment_mode?: string;
  /** When set, entire payment applies to this sale only. */
  saleId?: string;
  entry_date?: string;
}

export interface PaymentAllocation {
  saleId: string;
  invoiceNumber: string | null;
  amount: number;
}

export interface RecordCustomerPaymentResult {
  allocations: PaymentAllocation[];
  totalApplied: number;
}

type SaleRow = {
  id: string;
  invoice_number: string | null;
  due_amount: number | string;
  total_amount: number | string;
  discount: number | string;
  paid_amount: number | string;
};

/**
 * Atomically record a customer payment:
 *   - Applies to a specific sale (saleId) OR oldest due invoices first (FIFO).
 *   - Inserts customer_ledger payment rows (positive amounts).
 *   - Updates sales.paid_amount / sales.due_amount per allocation.
 *   - Inserts one cash_ledger receipt for the total applied.
 */
export async function recordCustomerPayment(
  trx: Knex.Transaction,
  input: RecordCustomerPaymentInput,
): Promise<RecordCustomerPaymentResult> {
  if (!(input.amount > 0)) {
    throw new Error('Payment amount must be positive');
  }

  const entryDate = input.entry_date ?? new Date().toISOString().slice(0, 10);

  const customer = await trx('customers')
    .where({ id: input.customerId, dealer_id: input.dealerId })
    .first('name');
  if (!customer) throw new Error('Customer not found');

  let salesToPay: SaleRow[];

  if (input.saleId) {
    const sale = await trx('sales')
      .where({
        id: input.saleId,
        dealer_id: input.dealerId,
        customer_id: input.customerId,
      })
      .forUpdate()
      .first();
    if (!sale) throw new Error('Sale not found');
    const due = Number(sale.due_amount) || 0;
    if (input.amount > due + 0.01) {
      throw new Error(`Payment exceeds outstanding amount (max ${due.toFixed(2)})`);
    }
    salesToPay = [sale as SaleRow];
  } else {
    salesToPay = (await trx('sales')
      .where({ dealer_id: input.dealerId, customer_id: input.customerId })
      .andWhere('due_amount', '>', 0)
      .orderBy('sale_date', 'asc')
      .orderBy('invoice_number', 'asc')
      .forUpdate()) as SaleRow[];

    const totalDue = salesToPay.reduce((sum, s) => sum + (Number(s.due_amount) || 0), 0);
    if (input.amount > totalDue + 0.01) {
      throw new Error(`Payment exceeds customer outstanding (max ${totalDue.toFixed(2)})`);
    }
  }

  let remaining = input.amount;
  const allocations: PaymentAllocation[] = [];

  for (const sale of salesToPay) {
    if (remaining <= 0) break;
    const due = Number(sale.due_amount) || 0;
    if (due <= 0) continue;

    const apply = input.saleId ? remaining : Math.min(remaining, due);
    if (apply <= 0) continue;

    const invoiceLabel = sale.invoice_number ?? sale.id;
    const description =
      input.note?.trim() ||
      (input.saleId
        ? `Payment for Invoice #${invoiceLabel}`
        : `Payment allocated to Invoice #${invoiceLabel}`);

    await trx('customer_ledger').insert({
      dealer_id: input.dealerId,
      customer_id: input.customerId,
      sale_id: sale.id,
      type: 'payment',
      amount: apply,
      description,
      entry_date: entryDate,
    });

    const newPaid = (Number(sale.paid_amount) || 0) + apply;
    const maxPayable = Math.max(
      0,
      (Number(sale.total_amount) || 0) - (Number(sale.discount) || 0),
    );
    const newDue = Math.max(0, maxPayable - newPaid);

    await trx('sales').where({ id: sale.id }).update({
      paid_amount: newPaid,
      due_amount: newDue,
    });

    allocations.push({
      saleId: sale.id,
      invoiceNumber: sale.invoice_number,
      amount: apply,
    });

    remaining -= apply;
    if (input.saleId) break;
  }

  if (allocations.length === 0) {
    throw new Error('No outstanding invoices to apply payment');
  }

  const totalApplied = round2(input.amount - remaining);

  await trx('cash_ledger').insert({
    dealer_id: input.dealerId,
    type: 'receipt',
    amount: totalApplied,
    description: `Payment from ${customer.name}: ${input.note?.trim() || 'Collection'}`,
    reference_type: 'customer_payment',
    reference_id: allocations[0]?.saleId ?? null,
    entry_date: entryDate,
    ...(input.payment_mode ? { payment_mode: input.payment_mode } : {}),
  });

  return { allocations, totalApplied };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
