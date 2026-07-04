/**
 * Dealer Data Export & Restore — per-table CSV download for the
 * authenticated dealer's tenant. Read-only export of dealer-scoped tables.
 *
 *   GET /api/data-export/manifest            → [{ key, label, table, rows }]
 *   GET /api/data-export/:key.csv            → CSV file for that table
 *   GET /api/data-export/daily?date=YYYY-MM-DD → CSV of all transactions on date
 *   GET /api/data-export/full-backup.zip     → ZIP of all tables as CSVs
 *
 * Restore (CSV upload) is delegated to the existing /api/imports/* routes
 * for products / customers / suppliers.
 */
import { Router, Request, Response } from 'express';
import ExcelJS from 'exceljs';
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const { ZipArchive } = require('archiver') as { ZipArchive: new (opts?: any) => any };
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { requireRole } from '../middleware/roles';
import {
  sumCustomerOutstandingFromSales,
  sumSupplierPayable,
  sumInventoryValuationWac,
} from '../services/reportQueryService';

const router = Router();
router.use(authenticate, tenantGuard, requireRole('dealer_admin'));

interface ExportSpec {
  key: string;
  label: string;
  table: string;
}

export const EXPORTS: ExportSpec[] = [
  { key: 'customers', label: 'Customers', table: 'customers' },
  { key: 'suppliers', label: 'Suppliers', table: 'suppliers' },
  { key: 'products', label: 'Products', table: 'products' },
  { key: 'product_batches', label: 'Product Batches', table: 'product_batches' },
  { key: 'stock', label: 'Stock', table: 'stock' },
  { key: 'sales', label: 'Sales', table: 'sales' },
  { key: 'sale_items', label: 'Sale Items', table: 'sale_items' },
  { key: 'purchases', label: 'Purchases', table: 'purchases' },
  { key: 'purchase_items', label: 'Purchase Items', table: 'purchase_items' },
  { key: 'deliveries', label: 'Deliveries', table: 'deliveries' },
  { key: 'challans', label: 'Challans', table: 'challans' },
  { key: 'expenses', label: 'Expenses', table: 'expenses' },
  { key: 'customer_ledger', label: 'Customer Ledger', table: 'customer_ledger' },
  { key: 'supplier_ledger', label: 'Supplier Ledger', table: 'supplier_ledger' },
  { key: 'cash_ledger', label: 'Cash Ledger', table: 'cash_ledger' },
  { key: 'sales_returns', label: 'Sales Returns', table: 'sales_returns' },
  { key: 'purchase_returns', label: 'Purchase Returns', table: 'purchase_returns' },
  { key: 'quotations', label: 'Quotations', table: 'quotations' },
];

// Tables that have a date column and are exported in the daily report
const DAILY_SPECS: Array<{ label: string; table: string; dateCol: string }> = [
  { label: 'Sales', table: 'sales', dateCol: 'sale_date' },
  { label: 'Sale Items', table: 'sale_items', dateCol: 'created_at' },
  { label: 'Purchases', table: 'purchases', dateCol: 'purchase_date' },
  { label: 'Expenses', table: 'expenses', dateCol: 'expense_date' },
  { label: 'Customer Payments (Ledger)', table: 'customer_ledger', dateCol: 'entry_date' },
  { label: 'Supplier Payments (Ledger)', table: 'supplier_ledger', dateCol: 'entry_date' },
  { label: 'Cash Ledger', table: 'cash_ledger', dateCol: 'entry_date' },
  { label: 'Challans', table: 'challans', dateCol: 'challan_date' },
  { label: 'Sales Returns', table: 'sales_returns', dateCol: 'return_date' },
  { label: 'Purchase Returns', table: 'purchase_returns', dateCol: 'return_date' },
  { label: 'Deliveries', table: 'deliveries', dateCol: 'delivery_date' },
];

function resolveDealer(req: Request, res: Response): string | null {
  if (!req.dealerId) {
    res.status(403).json({ error: 'No dealer assigned to your account' });
    return null;
  }
  return req.dealerId;
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s: string;
  if (v instanceof Date) s = v.toISOString();
  else if (typeof v === 'object') s = JSON.stringify(v);
  else s = String(v);
  if (/[",\n\r]/.test(s)) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function rowsToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '(no records)\n';
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(','));
  }
  return lines.join('\n') + '\n';
}

// ── GET /manifest ─────────────────────────────────────────────────
router.get('/manifest', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  const out: Array<ExportSpec & { rows: number }> = [];
  for (const spec of EXPORTS) {
    try {
      const r = await db(spec.table).where({ dealer_id: dealerId }).count<{ count: string }>('* as count').first();
      out.push({ ...spec, rows: Number(r?.count || 0) });
    } catch {
      out.push({ ...spec, rows: 0 });
    }
  }
  res.json(out);
});

// ── GET /daily?date=YYYY-MM-DD — all transactions for one day ─────
router.get('/daily', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;

  const dateStr = req.query.date as string | undefined;
  const date = dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : new Date().toISOString().slice(0, 10);

  const stamp = date;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="daily_report_${stamp}.csv"`);

  // Write a combined single CSV with section headers separating each table
  for (const spec of DAILY_SPECS) {
    try {
      const rows = await db(spec.table)
        .where({ dealer_id: dealerId })
        .whereRaw(`${spec.dateCol}::date = ?`, [date])
        .select('*');

      res.write(`\n=== ${spec.label.toUpperCase()} — ${date} (${rows.length} record${rows.length !== 1 ? 's' : ''}) ===\n`);
      res.write(rowsToCsv(rows));
    } catch {
      res.write(`\n=== ${spec.label.toUpperCase()} — skipped (table may not have column ${spec.dateCol}) ===\n`);
    }
  }

  res.end();
});

// ── GET /full-backup.zip — all tables as CSVs in a ZIP ───────────
router.get('/full-backup.zip', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="full_backup_${stamp}.zip"`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const archive: any = new ZipArchive({ zlib: { level: 6 } });
  archive.on('error', (err: Error) => {
    console.error('[dataExport] zip error', err);
    // Can't change headers now — just end
    res.end();
  });
  archive.pipe(res);

  for (const spec of EXPORTS) {
    try {
      const rows = await db(spec.table).where({ dealer_id: dealerId }).select('*');
      const csv = rowsToCsv(rows);
      archive.append(csv, { name: `${spec.key}.csv` });
    } catch (err) {
      archive.append(`Error exporting ${spec.table}: ${(err as Error).message}\n`, {
        name: `${spec.key}_error.txt`,
      });
    }
  }

  // Add a README
  const readme =
    `Full Data Backup — ${stamp}\n` +
    `Dealer ID: ${dealerId}\n` +
    `Generated: ${new Date().toISOString()}\n\n` +
    `Contents:\n` +
    EXPORTS.map((e) => `  ${e.key}.csv  — ${e.label}`).join('\n') + '\n';
  archive.append(readme, { name: 'README.txt' });

  await archive.finalize();
});

// ── GET /full-backup.xlsx — native Excel workbook, one sheet per area ──
// Streams a real .xlsx (not CSV): each data area becomes its own sheet with
// bold headers. Values that are objects/JSON are stringified so Excel shows
// readable text instead of "[object Object]".
function cellSafe(v: unknown): string | number | boolean | Date | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') { try { return JSON.stringify(v); } catch { return String(v); } }
  return v as string | number | boolean;
}
function sheetName(label: string): string {
  // Excel sheet names: max 31 chars, cannot contain \ / ? * [ ] :
  return label.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet';
}
function round2(n: unknown): number {
  const v = Number(n) || 0;
  return Math.round(v * 100) / 100;
}
// snake_case DB column → friendly "Title Case" header
function prettyHeader(h: string): string {
  return h
    .replace(/_/g, ' ')
    .replace(/\bid\b/gi, 'ID')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const TEAL = 'FF0F766E';
const TEAL_LIGHT = 'FFCCFBF1';
const MONEY_FMT = '#,##0.00';

router.get('/full-backup.xlsx', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', `attachment; filename="full_backup_${stamp}.xlsx"`);

  const wb = new ExcelJS.Workbook();

  // ─── Sheet 1: Dashboard (business summary, first sheet) ───
  const dash = wb.addWorksheet('Dashboard', { views: [{ showGridLines: false }] });
  dash.columns = [{ width: 36 }, { width: 22 }];

  const dealer = await db('dealers').where({ id: dealerId }).first().catch(() => null);
  dash.addRow(['SaniTiles ERP — Business Backup & Summary']).font = { bold: true, size: 16, color: { argb: TEAL } };
  dash.addRow([(dealer as any)?.business_name || (dealer as any)?.name || 'Dealer']).font = { bold: true, size: 12 };
  dash.addRow([`Generated: ${new Date().toLocaleString()}`]).font = { italic: true, color: { argb: 'FF666666' } };
  dash.addRow([]);

  // KPI helpers — dark text on light fill so headers stay readable even if fill is dropped.
  function section(title: string) {
    const r = dash.addRow([title, '']);
    for (let i = 1; i <= 2; i++) {
      const c = r.getCell(i);
      c.font = { bold: true, size: 11, color: { argb: TEAL } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL_LIGHT } };
    }
  }
  function kpi(label: string, value: number | null, money = true) {
    const r = dash.addRow([label, value === null ? 'n/a' : value]);
    r.getCell(1).font = { color: { argb: 'FF334155' } };
    const vc = r.getCell(2);
    vc.font = { bold: true };
    vc.alignment = { horizontal: 'right' };
    if (money && typeof value === 'number') vc.numFmt = MONEY_FMT;
  }

  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const yearStart = `${now.getFullYear()}-01-01`;
  const money = async (fn: () => Promise<unknown>): Promise<number | null> => {
    try { return round2(await fn()); } catch { return null; }
  };
  const count = async (table: string): Promise<number | null> => {
    try {
      const r = await db(table).where({ dealer_id: dealerId }).count<{ c: string }>('* as c').first();
      return Number((r as any)?.c ?? 0);
    } catch { return null; }
  };
  const sumCol = (table: string, col: string, dateCol?: string, from?: string) => money(async () => {
    let q = db(table).where({ dealer_id: dealerId });
    if (dateCol && from) q = q.where(dateCol, '>=', from);
    return (await q.sum({ s: col }).first() as any)?.s;
  });

  const [
    monthSales, monthProfit, monthColl, monthPurch, todaySales, yearSales,
    custDue, supPay, cash, stockVal, nCust, nSup, nProd, nSales,
  ] = await Promise.all([
    sumCol('sales', 'total_amount', 'sale_date', monthStart),
    sumCol('sales', 'net_profit', 'sale_date', monthStart),
    money(async () => (await db('customer_ledger').where({ dealer_id: dealerId, type: 'payment' }).where('entry_date', '>=', monthStart).sum({ s: 'amount' }).first() as any)?.s),
    sumCol('purchases', 'total_amount', 'purchase_date', monthStart),
    sumCol('sales', 'total_amount', 'sale_date', todayStr),
    sumCol('sales', 'total_amount', 'sale_date', yearStart),
    money(() => sumCustomerOutstandingFromSales(dealerId)),
    money(() => sumSupplierPayable(dealerId)),
    money(async () => (await db('cash_ledger').where({ dealer_id: dealerId }).sum({ s: 'amount' }).first() as any)?.s),
    money(() => sumInventoryValuationWac(dealerId)),
    count('customers'), count('suppliers'), count('products'), count('sales'),
  ]);

  section('THIS MONTH (Tk)');
  kpi('Sales', monthSales);
  kpi('Profit', monthProfit);
  kpi('Collections received', monthColl);
  kpi('Purchases', monthPurch);
  dash.addRow([]);
  section('TODAY (Tk)');
  kpi("Today's sales", todaySales);
  dash.addRow([]);
  section('MONEY POSITION — right now (Tk)');
  kpi('Customer dues (they owe you)', custDue);
  kpi('Supplier payable (you owe)', supPay);
  kpi('Cash in hand', cash);
  kpi('Stock value (at cost)', stockVal);
  kpi('Sales this year', yearSales);
  dash.addRow([]);
  section('TOTALS (count)');
  kpi('Customers', nCust, false);
  kpi('Suppliers', nSup, false);
  kpi('Products', nProd, false);
  kpi('Sales invoices', nSales, false);
  dash.addRow([]);

  // ─── One sheet per data area, with friendly headers ───
  const contents: Array<[string, number | string]> = [];
  for (const spec of EXPORTS) {
    try {
      const rows = await db(spec.table).where({ dealer_id: dealerId }).select('*');
      const ws = wb.addWorksheet(sheetName(spec.label));
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      if (rows.length > 0) {
        const headers = Object.keys(rows[0]);
        ws.columns = headers.map((h) => ({
          header: prettyHeader(h),
          key: h,
          width: Math.min(42, Math.max(12, prettyHeader(h).length + 2)),
        }));
        const hr = ws.getRow(1);
        hr.font = { bold: true, color: { argb: TEAL } };
        hr.alignment = { vertical: 'middle' };
        for (let i = 1; i <= headers.length; i++) {
          hr.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL_LIGHT } };
        }
        for (const row of rows) {
          const out: Record<string, unknown> = {};
          for (const h of headers) out[h] = cellSafe((row as any)[h]);
          ws.addRow(out);
        }
      } else {
        ws.addRow(['(no records)']);
      }
      contents.push([spec.label, rows.length]);
    } catch (err) {
      const ws = wb.addWorksheet(sheetName(spec.label));
      ws.addRow([`Error exporting ${spec.table}: ${(err as Error).message}`]);
      contents.push([spec.label, 'error']);
    }
  }

  // Contents / navigation table at the bottom of the Dashboard.
  section('SHEETS IN THIS FILE');
  const ch = dash.addRow(['Sheet', 'Records']);
  ch.getCell(1).font = { bold: true };
  ch.getCell(2).font = { bold: true };
  ch.getCell(2).alignment = { horizontal: 'right' };
  for (const [label, n] of contents) {
    const r = dash.addRow([label, n]);
    if (typeof n === 'number') r.getCell(2).alignment = { horizontal: 'right' };
  }

  await wb.xlsx.write(res);
  res.end();
});

// ── GET /:key.csv — single table CSV ─────────────────────────────
router.get('/:key.csv', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  const spec = EXPORTS.find((e) => e.key === req.params.key);
  if (!spec) {
    res.status(404).json({ error: 'Unknown export key' });
    return;
  }
  const rows = await db(spec.table).where({ dealer_id: dealerId }).select('*');
  const headers = rows.length > 0 ? Object.keys(rows[0]) : ['(empty)'];
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${spec.key}_${stamp}.csv"`);
  res.write(headers.join(',') + '\n');
  for (const row of rows) {
    res.write(headers.map((h) => csvEscape((row as any)[h])).join(',') + '\n');
  }
  res.end();
});

export default router;
