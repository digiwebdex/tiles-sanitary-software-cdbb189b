import express from 'express';

import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import { checkDbConnection } from './db/connection';
import { optionalAuth } from './middleware/auth';
import { demoReadOnly } from './middleware/demoReadOnly';
import { requireActiveSubscription } from './middleware/subscription';
import { enforcePlanFeatures } from './middleware/requireFeature';

// Routes
import authRoutes from './routes/auth';
import healthRoutes from './routes/health';
import suppliersRoutes from './routes/suppliers';
import customersRoutes from './routes/customers';
import productsRoutes from './routes/products';
import stockRoutes from './routes/stock';
import batchesRoutes from './routes/batches';
import dealersRoutes from './routes/dealers';
import subscriptionsRoutes from './routes/subscriptions';
import plansRoutes from './routes/plans';
import backupsRoutes from './routes/backups';
import googleDriveRoutes from './routes/googleDrive';
import auditLogsRoutes from './routes/auditLogs';
import subscriptionStatusRoutes from './routes/subscriptionStatus';
import dealerPaymentRequestsRoutes from './routes/dealerPaymentRequests';
import notificationsRoutes from './routes/notifications';
import smtpSettingsRoutes from './routes/smtpSettings';
import uploadsRoutes from './routes/uploads';
import dashboardRoutes from './routes/dashboard';
import ledgerRoutes from './routes/ledger';
import collectionsRoutes from './routes/collections';
import salesRoutes from './routes/sales';
import purchasesRoutes from './routes/purchases';
import payablesRoutes from './routes/payables';
import returnsRoutes from './routes/returns';
import deliveriesRoutes from './routes/deliveries';
import challansRoutes from './routes/challans';
import reportsRoutes from './routes/reports';
import pricingTierReportsRoutes from './routes/pricingTierReports';
import projectReportsRoutes from './routes/projectReports';
import projectsRoutes from './routes/projects';
import portalRoutes from './routes/portal';
import supplierPerformanceReportsRoutes from './routes/supplierPerformanceReports';
import expensesRoutes from './routes/expenses';
import adjustmentsRoutes from './routes/adjustments';
import reservationsRoutes from './routes/reservations';
import approvalsRoutes from './routes/approvals';
import adminStatsRoutes, { cronRouter } from './routes/adminStats';
import saAdminRoutes from './routes/saAdmin';
import saEmployeesRoutes from './routes/saEmployees';
import announcementsRoutes from './routes/announcements';
import remindersRoutes from './routes/reminders';
import signupOtpRoutes from './routes/signupOtp';
import importsRoutes from './routes/imports';
import creditRoutes from './routes/credit';
import pricingTiersRoutes from './routes/pricingTiers';
import commissionsRoutes from './routes/commissions';
import campaignGiftsRoutes from './routes/campaignGifts';
import demandPlanningSettingsRoutes from './routes/demandPlanningSettings';
import dealerSettingsRoutes from './routes/dealerSettings';
import displayStockRoutes from './routes/displayStock';
import sampleIssuesRoutes from './routes/sampleIssues';
import purchasePlanningRoutes from './routes/purchasePlanning';
import quotationsRoutes from './routes/quotations';
import salesOrdersRoutes from './routes/salesOrders';
import whatsappRoutes from './routes/whatsapp';
import demandPlanningRoutes from './routes/demandPlanning';
import backordersRoutes from './routes/backorders';
import dataExportRoutes from './routes/dataExport';
import dealerDriveRoutes from './routes/dealerDrive';
import teamRoutes from './routes/team';
import bankAccountsRoutes from './routes/bankAccounts';
import cashbookRoutes from './routes/cashbook';
import cashClosingsRoutes from './routes/cashClosings';
import financialsRoutes from './routes/financials';
import employeesRoutes from './routes/employees';
import directorsRoutes from './routes/directors';
import warehousesRoutes from './routes/warehouses';
import godownsRoutes from './routes/godowns';
import racksRoutes from './routes/racks';
import binsRoutes from './routes/bins';
import availabilityRoutes from './routes/availability';
import inventoryIntelligenceRoutes from './routes/inventoryIntelligence';
import phase3ReportsRoutes from './routes/phase3Reports';
import autoPoRoutes from './routes/autoPo';
import customerStatementsRoutes from './routes/customerStatements';
import leadsRoutes from './routes/leads';
import purchaseRequestsRoutes from './routes/purchaseRequests';
import rfqRoutes from './routes/rfq';
import purchaseOrdersRoutes from './routes/purchaseOrders';
import goodsReceiptsRoutes from './routes/goodsReceipts';
import purchaseInvoicesRoutes from './routes/purchaseInvoices';
import supplierLedgerEntriesRoutes from './routes/supplierLedgerEntries';
import supplierAgingRoutes from './routes/supplierAging';
import purchaseReturnsRoutes from './routes/purchaseReturns';
import landedCostSheetsRoutes from './routes/landedCostSheets';
import stockCostAdjustmentsRoutes from './routes/stockCostAdjustments';
import importLcRoutes from './routes/importLc';
import filesRoutes from './routes/files';
import holidaysRoutes from './routes/holidays';
import journalRoutes from './routes/journal';
import glRoutes from './routes/gl';
import fiscalYearsRoutes from './routes/fiscalYears';
import openingBalanceRoutes from './routes/openingBalance';
import transfersRoutes from './routes/transfers';
import chequeRegisterRoutes from './routes/chequeRegister';
import bankReconciliationRoutes from './routes/bankReconciliation';
import customerAgingRoutes from './routes/customerAging';
import postingsRoutes from './routes/postings';
import vatReportsRoutes from './routes/vatReports';
import emiRoutes from './routes/emi';
import branchesRoutes from './routes/branches';
import noticesRoutes from './routes/notices';
import leavesRoutes from './routes/leaves';
import salaryComponentsRoutes from './routes/salaryComponents';
import employeeDocumentsRoutes from './routes/employeeDocuments';
import shiftsRoutes from './routes/shifts';
import performanceRoutes from './routes/performance';
import trainingRoutes from './routes/training';
import assetsRoutes from './routes/assets';
import employeeLoansRoutes from './routes/employeeLoans';
import employeeExitsRoutes from './routes/employeeExits';
import path from 'path';

const app = express();
app.set('trust proxy', 1);

// ── Security ──
app.use(helmet());

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'https://sanitileserp.com',
  'https://www.sanitileserp.com',
  'https://app.sanitileserp.com',
  'https://portal.sanitileserp.com',
  'https://a944558b-6da4-4037-9510-b636b7c4dafa.lovableproject.com',
  'https://id-preview--a944558b-6da4-4037-9510-b636b7c4dafa.lovable.app',
  'https://tiles-sanitary-software.lovable.app',
];

const allowedOrigins = Array.from(new Set([
  ...DEFAULT_ALLOWED_ORIGINS,
  ...env.CORS_ORIGIN.split(',').map(origin => origin.trim()).filter(Boolean),
]));

// P0 hardening: hardcode the allowed headers + methods. Never reflect
// `Access-Control-Request-Headers` from the browser — that would let
// arbitrary attacker-chosen headers be advertised as allowed and is the
// vector flagged in the audit (CORS header reflection).
const ALLOWED_METHODS = 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS';
const ALLOWED_HEADERS = 'Content-Type, Authorization, X-Requested-With, X-Restore-Token';
const EXPOSED_HEADERS = 'Content-Disposition';

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
  res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
  res.setHeader('Access-Control-Expose-Headers', EXPOSED_HEADERS);
  res.setHeader('Access-Control-Max-Age', '600');

  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }

  next();
});

// ── Rate limiting ──
// The app sits behind Cloudflare → nginx. `req.ip` (even with trust proxy) can
// resolve to a rotating Cloudflare edge address, which put every request in a
// fresh bucket and made both limiters no-ops (remaining never decremented).
// Key on CF-Connecting-IP — the real client IP that Cloudflare sets and clients
// cannot spoof through CF — falling back to the normalised req.ip when the
// header is absent (e.g. direct/local access).
const clientIpKey = (req: express.Request): string => {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf.trim()) return cf.trim();
  return req.ip ?? 'unknown';
};
// Disable the library's built-in validators for these two limiters: we use a
// custom keyGenerator (CF-Connecting-IP, already a single normalised address),
// which otherwise trips the IPv6-fallback sanity check.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientIpKey,
  validate: false,
});
app.use(limiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyGenerator: clientIpKey,
  validate: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
  skip: (req) => {
    const path = req.originalUrl.split('?')[0];
    return [
      '/api/auth/me',
      '/api/auth/refresh',
      '/api/auth/logout',
      '/api/auth/lock-status',
    ].includes(path);
  },
});

// ── Body parsers ──
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Demo read-only guard ──
// optionalAuth decodes the JWT (if present) so demoReadOnly can inspect
// req.user.isDemo. Routes still run their own `authenticate` for hard auth.
app.use('/api', optionalAuth, demoReadOnly);

// ── Subscription paywall (server-side) ──
// Blocks state-changing requests for dealers with an expired/suspended
// subscription. Runs after optionalAuth so req.user is available; reads and
// auth/renewal endpoints stay open (see middleware allowlist).
app.use('/api', requireActiveSubscription);

// ── Plan / feature enforcement (V2 Sprint 1) ──
// Central path→feature gate. Ships in DRY-RUN ('log') mode by default so it
// changes NO behaviour until FEATURE_ENFORCEMENT=enforce is set. super_admin/
// sa_employee bypass; reads always allowed; fails open.
app.use('/api', enforcePlanFeatures);

// ── Routes ──
app.use('/api/health', healthRoutes);
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/suppliers', suppliersRoutes);
app.use('/api/customers', customersRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/stock', stockRoutes);
app.use('/api/batches', batchesRoutes);
app.use('/api/dealers', dealersRoutes);
app.use('/api/subscriptions', subscriptionsRoutes);
app.use('/api/plans', plansRoutes);
app.use('/api/backups', backupsRoutes);
app.use('/api/google-drive', googleDriveRoutes);
app.use('/api/audit-logs', auditLogsRoutes);
app.use('/api/subscription', subscriptionStatusRoutes);
app.use('/api/payment-requests', dealerPaymentRequestsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/smtp-settings', smtpSettingsRoutes);
app.use('/api/uploads', uploadsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/ledger', ledgerRoutes);
app.use('/api/collections', collectionsRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/purchases', purchasesRoutes);
app.use('/api/payables', payablesRoutes);
app.use('/api/returns', returnsRoutes);
app.use('/api/deliveries', deliveriesRoutes);
app.use('/api/challans', challansRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/reports/pricing-tier', pricingTierReportsRoutes);
app.use('/api/reports/projects', projectReportsRoutes);
app.use('/api/projects', projectsRoutes);
app.use('/api/portal', portalRoutes);
app.use('/api/reports/supplier-performance', supplierPerformanceReportsRoutes);
app.use('/api/reports/vat', vatReportsRoutes);
app.use('/api/expenses', expensesRoutes);
app.use('/api/adjustments', adjustmentsRoutes);
app.use('/api/reservations', reservationsRoutes);
app.use('/api/approvals', approvalsRoutes);
app.use('/api/signup', signupOtpRoutes);
app.use('/api/admin/reminders', remindersRoutes);
app.use('/api/admin/cron', cronRouter);
app.use('/api/admin', saAdminRoutes);
app.use('/api/admin', adminStatsRoutes);
app.use('/api/sa/employees', saEmployeesRoutes);
app.use('/api/announcements', announcementsRoutes);
app.use('/api/imports', importsRoutes);
app.use('/api/credit', creditRoutes);
app.use('/api/pricing-tiers', pricingTiersRoutes);
app.use('/api/commissions', commissionsRoutes);
app.use('/api/campaign-gifts', campaignGiftsRoutes);
app.use('/api/demand-planning-settings', demandPlanningSettingsRoutes);
app.use('/api/dealer-settings', dealerSettingsRoutes);
app.use('/api/display-stock', displayStockRoutes);
app.use('/api/sample-issues', sampleIssuesRoutes);
app.use('/api/purchase-planning', purchasePlanningRoutes);
app.use('/api/quotations', quotationsRoutes);
app.use('/api/sales-orders', salesOrdersRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/demand-planning', demandPlanningRoutes);
app.use('/api/backorders', backordersRoutes);
app.use('/api/data-export', dataExportRoutes);
app.use('/api/dealer-drive', dealerDriveRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/bank-accounts', bankAccountsRoutes);
app.use('/api/cashbook', cashbookRoutes);
app.use('/api/cash-closings', cashClosingsRoutes);
app.use('/api/financials', financialsRoutes);
app.use('/api/employees', employeesRoutes);
app.use('/api/directors', directorsRoutes);
app.use('/api/warehouses', warehousesRoutes);
app.use('/api/godowns', godownsRoutes);
app.use('/api/racks', racksRoutes);
app.use('/api/bins', binsRoutes);
app.use('/api/availability', availabilityRoutes);
app.use('/api/inventory-intelligence', inventoryIntelligenceRoutes);
app.use('/api/reports', phase3ReportsRoutes);
app.use('/api/auto-po', autoPoRoutes);
app.use('/api/customer-statements', customerStatementsRoutes);
app.use('/api/leads', leadsRoutes);
app.use('/api/purchase-requests', purchaseRequestsRoutes);
app.use('/api/rfqs', rfqRoutes);
app.use('/api/purchase-orders', purchaseOrdersRoutes);
app.use('/api/goods-receipts', goodsReceiptsRoutes);
app.use('/api/purchase-invoices', purchaseInvoicesRoutes);
app.use('/api/supplier-ledger-entries', supplierLedgerEntriesRoutes);
app.use('/api/supplier-aging', supplierAgingRoutes);
app.use('/api/purchase-returns', purchaseReturnsRoutes);
app.use('/api/landed-cost-sheets', landedCostSheetsRoutes);
app.use('/api/stock-cost-adjustments', stockCostAdjustmentsRoutes);
app.use('/api/import-lc', importLcRoutes);
app.use('/api/files', filesRoutes);
app.use('/api/holidays', holidaysRoutes);
app.use('/api/journal', journalRoutes);
app.use('/api/gl', glRoutes);
app.use('/api/fiscal-years', fiscalYearsRoutes);
app.use('/api/opening-balance', openingBalanceRoutes);
app.use('/api/transfers', transfersRoutes);
app.use('/api/cheque-register', chequeRegisterRoutes);
app.use('/api/bank-reconciliation', bankReconciliationRoutes);
app.use('/api/customer-aging', customerAgingRoutes);
app.use('/api/postings', postingsRoutes);
app.use('/api/emi', emiRoutes);
app.use('/api/branches', branchesRoutes);
app.use('/api/notices', noticesRoutes);
app.use('/api/leaves', leavesRoutes);
app.use('/api/salary-components', salaryComponentsRoutes);
app.use('/api/employee-documents', employeeDocumentsRoutes);
app.use('/api/shifts', shiftsRoutes);
app.use('/api/performance', performanceRoutes);
app.use('/api/training', trainingRoutes);
app.use('/api/assets', assetsRoutes);
app.use('/api/employee-loans', employeeLoansRoutes);
app.use('/api/employee-exits', employeeExitsRoutes);

// Static file serving for uploaded product images, etc.
app.use(
  '/uploads',
  express.static(path.resolve(process.cwd(), 'uploads'), {
    maxAge: '7d',
    fallthrough: true,
  }),
);

// ── 404 handler ──
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Global error handler ──
app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  // Honour a status carried on the error. body-parser sets status 400 +
  // type 'entity.parse.failed' for malformed JSON, so this returns a clean
  // 400 instead of an opaque 500.
  const status =
    Number(err?.statusCode || err?.status) ||
    (err?.type === 'entity.parse.failed' || err instanceof SyntaxError ? 400 : 500);
  console.error('[ERROR]', status, err?.message);
  const isClientError = status >= 400 && status < 500;
  res.status(status).json({
    error:
      isClientError || env.NODE_ENV !== 'production'
        ? err?.message || 'Request failed'
        : 'Internal server error',
    ...(err?.code ? { code: err.code } : {}),
  });
});

// ── Process-level safety nets ──
// Express 4 does not route rejected promises from async handlers to the error
// middleware, so an unhandled rejection could otherwise crash the process
// (availability risk). Log and keep the process alive; individual handlers are
// still responsible for responding to their own request.
process.on('unhandledRejection', (reason: unknown) => {
  console.error('[unhandledRejection]', reason instanceof Error ? reason.stack : reason);
});
process.on('uncaughtException', (err: Error) => {
  console.error('[uncaughtException]', err.stack || err.message);
});

// ── Start ──
async function start() {
  console.log(`[TilesERP] Starting in ${env.NODE_ENV} mode...`);

  const server = app.listen(env.PORT, '127.0.0.1', () => {
    console.log(`[API] Server running on 127.0.0.1:${env.PORT}`);
  });
  server.on('error', (err) => {
    console.error('[API] Server error:', err);
    process.exit(1);
  });

  const dbOk = await checkDbConnection();
  if (!dbOk) {
    console.error('[DB] Cannot connect to database. API stays online for health diagnostics.');
    return;
  }
  console.log('[DB] Connected successfully');
}

start();

export default app;
