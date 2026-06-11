/**
 * Phase 5 — Mushak-style VAT register queries (P5-04).
 */
import { db } from '../db/connection';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function num(v: unknown): number {
  return Number(v) || 0;
}

export interface VatSalesRegisterRow {
  saleId: string;
  invoiceNumber: string | null;
  saleDate: string;
  customerId: string;
  customerName: string;
  customerTaxId: string | null;
  taxableAmount: number;
  vatRate: number;
  vatAmount: number;
  sdAmount: number;
  totalAmount: number;
}

export interface VatPurchaseRegisterRow {
  purchaseId: string;
  invoiceNumber: string | null;
  purchaseDate: string;
  supplierId: string;
  supplierName: string;
  supplierTaxId: string | null;
  taxableAmount: number;
  vatRate: number;
  vatAmount: number;
  sdAmount: number;
  totalAmount: number;
}

export async function fetchMushak63SalesRegister(
  dealerId: string,
  from: string,
  to: string,
): Promise<{ rows: VatSalesRegisterRow[]; totals: { taxable: number; vat: number; sd: number; total: number } }> {
  const rows = await db('sales as s')
    .join('customers as c', 'c.id', 's.customer_id')
    .where('s.dealer_id', dealerId)
    .whereBetween('s.sale_date', [from, to])
    .whereRaw("COALESCE(s.document_status, 'posted') <> 'reversed'")
    .orderBy('s.sale_date', 'asc')
    .orderBy('s.invoice_number', 'asc')
    .select(
      's.id as sale_id',
      's.invoice_number',
      's.sale_date',
      's.customer_id',
      'c.name as customer_name',
      'c.tax_id as customer_tax_id',
      's.taxable_amount',
      's.vat_rate',
      's.vat_amount',
      's.sd_amount',
      's.total_amount',
    );

  const mapped = (rows as any[]).map((r) => ({
    saleId: r.sale_id,
    invoiceNumber: r.invoice_number ?? null,
    saleDate: String(r.sale_date).slice(0, 10),
    customerId: r.customer_id,
    customerName: r.customer_name,
    customerTaxId: r.customer_tax_id ?? null,
    taxableAmount: round2(num(r.taxable_amount)),
    vatRate: round2(num(r.vat_rate)),
    vatAmount: round2(num(r.vat_amount)),
    sdAmount: round2(num(r.sd_amount)),
    totalAmount: round2(num(r.total_amount)),
  }));

  const totals = mapped.reduce(
    (acc, r) => ({
      taxable: acc.taxable + r.taxableAmount,
      vat: acc.vat + r.vatAmount,
      sd: acc.sd + r.sdAmount,
      total: acc.total + r.totalAmount,
    }),
    { taxable: 0, vat: 0, sd: 0, total: 0 },
  );

  return {
    rows: mapped,
    totals: {
      taxable: round2(totals.taxable),
      vat: round2(totals.vat),
      sd: round2(totals.sd),
      total: round2(totals.total),
    },
  };
}

export async function fetchMushak61PurchaseRegister(
  dealerId: string,
  from: string,
  to: string,
): Promise<{ rows: VatPurchaseRegisterRow[]; totals: { taxable: number; vat: number; sd: number; total: number } }> {
  const rows = await db('purchases as p')
    .join('suppliers as s', 's.id', 'p.supplier_id')
    .where('p.dealer_id', dealerId)
    .whereBetween('p.purchase_date', [from, to])
    .whereRaw("COALESCE(p.document_status, 'posted') <> 'reversed'")
    .orderBy('p.purchase_date', 'asc')
    .orderBy('p.invoice_number', 'asc')
    .select(
      'p.id as purchase_id',
      'p.invoice_number',
      'p.purchase_date',
      'p.supplier_id',
      's.name as supplier_name',
      's.gstin as supplier_tax_id',
      'p.taxable_amount',
      'p.vat_rate',
      'p.vat_amount',
      'p.sd_amount',
      'p.total_amount',
    );

  const mapped = (rows as any[]).map((r) => ({
    purchaseId: r.purchase_id,
    invoiceNumber: r.invoice_number ?? null,
    purchaseDate: String(r.purchase_date).slice(0, 10),
    supplierId: r.supplier_id,
    supplierName: r.supplier_name,
    supplierTaxId: r.supplier_tax_id ?? null,
    taxableAmount: round2(num(r.taxable_amount)),
    vatRate: round2(num(r.vat_rate)),
    vatAmount: round2(num(r.vat_amount)),
    sdAmount: round2(num(r.sd_amount)),
    totalAmount: round2(num(r.total_amount)),
  }));

  const totals = mapped.reduce(
    (acc, r) => ({
      taxable: acc.taxable + r.taxableAmount,
      vat: acc.vat + r.vatAmount,
      sd: acc.sd + r.sdAmount,
      total: acc.total + r.totalAmount,
    }),
    { taxable: 0, vat: 0, sd: 0, total: 0 },
  );

  return {
    rows: mapped,
    totals: {
      taxable: round2(totals.taxable),
      vat: round2(totals.vat),
      sd: round2(totals.sd),
      total: round2(totals.total),
    },
  };
}
