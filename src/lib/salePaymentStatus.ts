export type SalePaymentStatusInput = {
  due_amount?: number | string | null;
  paid_amount?: number | string | null;
  document_status?: string | null;
  sale_status?: string | null;
};

export function isSaleReversed(sale: Pick<SalePaymentStatusInput, 'document_status' | 'sale_status'>): boolean {
  return sale.document_status === 'reversed' || sale.sale_status === 'cancelled';
}

export type SalePaymentDisplayStatus = 'reversed' | 'paid' | 'partial' | 'pending';

export function resolveSalePaymentStatus(sale: SalePaymentStatusInput): SalePaymentDisplayStatus {
  if (isSaleReversed(sale)) return 'reversed';

  const due = Number(sale.due_amount) || 0;
  const paid = Number(sale.paid_amount) || 0;
  if (due <= 0) return 'paid';
  if (paid > 0) return 'partial';
  return 'pending';
}

export function salePaymentStatusLabel(status: SalePaymentDisplayStatus): string {
  switch (status) {
    case 'reversed':
      return 'Reversed';
    case 'paid':
      return 'Paid';
    case 'partial':
      return 'Partial';
    default:
      return 'Pending';
  }
}

export function salePaymentStatusClassName(status: SalePaymentDisplayStatus): string {
  switch (status) {
    case 'reversed':
      return 'bg-red-100 text-red-700';
    case 'paid':
      return 'bg-green-600 text-white hover:bg-green-700';
    case 'partial':
      return 'border-yellow-500 text-yellow-600';
    default:
      return 'bg-orange-100 text-orange-700';
  }
}
