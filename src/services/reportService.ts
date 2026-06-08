import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

const PAGE_SIZE = 25;

async function vpsRequest<T>(path: string): Promise<T> {
  const res = await vpsAuthedFetch(path);
  const body = await res.json().catch(() => ({} as any));
  if (!res.ok) {
    throw new Error((body as any)?.error || `Request failed (${res.status})`);
  }
  return body as T;
}

// ─── Stock Report (SKU-wise) ──────────────────────────────
export interface StockRow {
  productId: string;
  sku: string;
  name: string;
  brand: string | null;
  category: string;
  unitType: string;
  piecesPerBox: number;
  boxQty: number;
  sftQty: number;
  pieceQty: number;
  avgCost: number;
  stockValue: number;
  reorderLevel: number;
  isLow: boolean;
}

export async function fetchStockReport(
  dealerId: string,
  page: number,
  search?: string
): Promise<{ rows: StockRow[]; total: number }> {
  const params = new URLSearchParams({ dealerId, page: String(page) });
  if (search?.trim()) params.set("search", search.trim());
  return vpsRequest<{ rows: StockRow[]; total: number }>(`/api/reports/stock?${params}`);
}

// ─── Products Report ──────────────────────────────────────
export interface ProductReportRow {
  productId: string;
  sku: string;
  name: string;
  purchasedQty: number;
  purchasedAmount: number;
  soldQty: number;
  soldAmount: number;
  profitOrLoss: number;
  stockQty: number;
  stockAmount: number;
}

export async function fetchProductsReport(
  dealerId: string,
  page: number,
  search?: string
): Promise<{ rows: ProductReportRow[]; total: number }> {
  const params = new URLSearchParams({ dealerId, page: String(page) });
  if (search?.trim()) params.set("search", search.trim());
  return vpsRequest<{ rows: ProductReportRow[]; total: number }>(`/api/reports/products?${params}`);
}

// ─── Brand Stock Report ───────────────────────────────────
export interface BrandStockRow {
  brand: string;
  totalBox: number;
  totalSft: number;
  totalPiece: number;
  totalValue: number;
  productCount: number;
  purchasedQty: number;
  purchasedAmount: number;
  soldQty: number;
  soldAmount: number;
  profitOrLoss: number;
}

export async function fetchBrandStockReport(dealerId: string): Promise<BrandStockRow[]> {
  return vpsRequest<BrandStockRow[]>(`/api/reports/brand-stock?dealerId=${encodeURIComponent(dealerId)}`);
}

// ─── Sales Report ─────────────────────────────────────────
export interface SalesReportRow {
  date: string;
  count: number;
  totalAmount: number;
  totalCollection: number;
  totalProfit: number;
  totalDue: number;
  totalSft: number;
}

export async function fetchSalesReport(
  dealerId: string,
  mode: "daily" | "monthly",
  year: number,
  month?: number
): Promise<SalesReportRow[]> {
  const params = new URLSearchParams({ dealerId, mode, year: String(year) });
  if (month) params.set("month", String(month));
  return vpsRequest<SalesReportRow[]>(`/api/reports/sales?${params}`);
}

// ─── Retailer Sales Report ────────────────────────────────
export interface RetailerSalesRow {
  customerId: string;
  customerName: string;
  customerType: string;
  totalSft: number;
  totalAmount: number;
  totalDue: number;
  saleCount: number;
}

export async function fetchRetailerSalesReport(
  dealerId: string,
  year: number,
  customerType?: "retailer" | "customer" | "project"
): Promise<RetailerSalesRow[]> {
  const params = new URLSearchParams({ dealerId, year: String(year) });
  if (customerType) params.set("customerType", customerType);
  return vpsRequest<RetailerSalesRow[]>(`/api/reports/retailer-sales?${params}`);
}

// ─── Product History ──────────────────────────────────────
export interface ProductHistoryRow {
  id: string;
  date: string;
  type: "purchase" | "sale" | "return";
  quantity: number;
  rate: number;
  total: number;
  reference: string;
}

export interface ProductHistoryResponse {
  rows: ProductHistoryRow[];
  total: number;
  unitType: string | null;
  piecesPerBox: number;
  category: string | null;
}

export async function fetchProductHistory(
  dealerId: string,
  productId: string,
  page: number
): Promise<ProductHistoryResponse> {
  const params = new URLSearchParams({ dealerId, productId, page: String(page) });
  return vpsRequest<ProductHistoryResponse>(`/api/reports/product-history?${params}`);
}

// ─── Customer Due Report ──────────────────────────────────
export interface CustomerDueRow {
  customerId: string;
  customerName: string;
  customerType: string;
  totalDebit: number;
  totalCredit: number;
  balance: number;
}

/** Customer due rows; `balance` = type-based ledger outstanding (matches Collections). */
export async function fetchCustomerDueReport(
  dealerId: string,
  page: number
): Promise<{ rows: CustomerDueRow[]; total: number }> {
  return vpsRequest<{ rows: CustomerDueRow[]; total: number }>(
    `/api/reports/customer-due?dealerId=${encodeURIComponent(dealerId)}&page=${page}`,
  );
}

// ─── Supplier Payable Report ──────────────────────────────
export interface SupplierPayableRow {
  supplierId: string;
  supplierName: string;
  totalDebit: number;
  totalCredit: number;
  balance: number;
}

export async function fetchSupplierPayableReport(
  dealerId: string,
  page: number
): Promise<{ rows: SupplierPayableRow[]; total: number }> {
  return vpsRequest<{ rows: SupplierPayableRow[]; total: number }>(
    `/api/reports/supplier-payable?dealerId=${encodeURIComponent(dealerId)}&page=${page}`,
  );
}

// ─── Accounting Summary ───────────────────────────────────
export interface AccountingSummaryRow {
  month: string;
  totalSales: number;
  totalCollection: number;
  totalDue: number;
  totalSftSold: number;
  totalPurchases: number;
  totalExpenses: number;
  netProfit: number;
  cashIn: number;
  cashOut: number;
}

export async function fetchAccountingSummary(
  dealerId: string,
  year: number
): Promise<AccountingSummaryRow[]> {
  return vpsRequest<AccountingSummaryRow[]>(
    `/api/reports/accounting-summary?dealerId=${encodeURIComponent(dealerId)}&year=${year}`,
  );
}

// ─── Inventory Aging Report ───────────────────────────────
export interface InventoryAgingRow {
  productId: string;
  sku: string;
  name: string;
  brand: string | null;
  category: string;
  unitType: string;
  piecesPerBox: number;
  boxQty: number;
  sftQty: number;
  pieceQty: number;
  avgCostPerUnit: number;
  fifoStockValue: number;
  lastSaleDate: string | null;
  daysSinceLastSale: number | null;
  agingCategory: "fast" | "normal" | "slow" | "unsold";
}

export async function fetchInventoryAgingReport(dealerId: string): Promise<{
  rows: InventoryAgingRow[];
  totalFifoValue: number;
}> {
  return vpsRequest<{ rows: InventoryAgingRow[]; totalFifoValue: number }>(
    `/api/reports/inventory-aging?dealerId=${encodeURIComponent(dealerId)}`,
  );
}

export const REPORT_PAGE_SIZE = PAGE_SIZE;

// ─── Low Stock Report ─────────────────────────────────────
export interface LowStockRow {
  productId: string;
  sku: string;
  name: string;
  brand: string | null;
  category: string;
  unitType: string;
  piecesPerBox?: number;
  totalPieces?: number;
  currentStock: number;
  reorderLevel: number;
  suggestedReorderQty: number;
}

export async function fetchLowStockReport(dealerId: string): Promise<LowStockRow[]> {
  return vpsRequest<LowStockRow[]>(`/api/reports/low-stock?dealerId=${encodeURIComponent(dealerId)}`);
}
