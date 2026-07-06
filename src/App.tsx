import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider, QueryCache } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { getHostEntryRedirect } from "@/lib/hostRouting";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppLayout from "@/components/AppLayout";
import ScrollToTop from "@/components/ScrollToTop";
import LoginPage from "./pages/auth/LoginPage";
import LandingPage from "./pages/LandingPage";
import PricingPage from "./pages/public/PricingPage";
import PrivacyPolicyPage from "./pages/public/PrivacyPolicyPage";
import TermsPage from "./pages/public/TermsPage";
import ContactPage from "./pages/public/ContactPage";
import GetStartedPage from "./pages/public/GetStartedPage";
import SubscriptionBlockedPage from "./pages/auth/SubscriptionBlockedPage";
import SubscriptionPage from "./pages/subscription/SubscriptionPage";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import ProductsPage from "./pages/products/ProductsPage";
import InventoryPage from "./pages/inventory/InventoryPage";
import CreateProductRoute from "./pages/products/CreateProductRoute";
import EditProduct from "./pages/products/EditProduct";
import DamagePage from "./pages/damage/DamagePage";
import PurchasesPage from "./pages/purchases/PurchasesPage";
import CreatePurchase from "./pages/purchases/CreatePurchase";
import ViewPurchase from "./pages/purchases/ViewPurchase";
import SalesPage from "./pages/sales/SalesPage";
import CreateSale from "./pages/sales/CreateSale";
import InvoicePage from "./pages/sales/InvoicePage";
import EditSale from "./pages/sales/EditSale";
import ChallanPage from "./pages/sales/ChallanPage";
import SalesReturnsPage from "./pages/sales-returns/SalesReturnsPage";
import CreateSalesReturn from "./pages/sales-returns/CreateSalesReturn";
import LedgerPage from "./pages/ledger/LedgerPage";
import ReportsPage from "./pages/reports/ReportsPage";
import SuppliersPage from "./pages/suppliers/SuppliersPage";
import CreateSupplier from "./pages/suppliers/CreateSupplier";
import EditSupplier from "./pages/suppliers/EditSupplier";
import CustomersPage from "./pages/customers/CustomersPage";
import CreateCustomer from "./pages/customers/CreateCustomer";
import EditCustomer from "./pages/customers/EditCustomer";
import CustomerProfilePage from "./pages/customers/CustomerProfilePage";
import CreditReportPage from "./pages/reports/CreditReportPage";
import ChallansPage from "./pages/challans/ChallansPage";
import PurchaseReturnsPage from "./pages/purchase-returns/PurchaseReturnsPage";
import CreatePurchaseReturn from "./pages/purchase-returns/CreatePurchaseReturn";
import DeliveriesPage from "./pages/deliveries/DeliveriesPage";
import POSSalePage from "./pages/sales/POSSalePage";
import TileCalculatorPage from "./pages/tools/TileCalculatorPage";
import LoginHistoryPage from "./pages/settings/LoginHistoryPage";
import CampaignsPage from "./pages/campaigns/CampaignsPage";
import CollectionsPage from "./pages/collections/CollectionsPage";
import SupplierPayablesPage from "./pages/payables/SupplierPayablesPage";
import SupplierPaymentPage from "./pages/payables/SupplierPaymentPage";
import ApprovalsPage from "./pages/approvals/ApprovalsPage";
import QuotationsPage from "./pages/quotations/QuotationsPage";
import CreateQuotation from "./pages/quotations/CreateQuotation";
import EditQuotation from "./pages/quotations/EditQuotation";
import ProjectsPage from "./pages/projects/ProjectsPage";
import ReferralSourcesPage from "./pages/referrals/ReferralSourcesPage";
import DisplaySampleStockPage from "./pages/display-sample/DisplaySampleStockPage";
import WhatsAppLogsPage from "./pages/whatsapp/WhatsAppLogsPage";
import UserGuidePage from "./pages/UserGuidePage";
import BankAccountsPage from "./pages/bank-accounts/BankAccountsPage";
import BankAccountDetailPage from "./pages/bank-accounts/BankAccountDetailPage";
import CashbookPage from "./pages/cashbook/CashbookPage";
import CashClosingPage from "./pages/cash-closing/CashClosingPage";
import FinancialStatementsPage from "./pages/financials/FinancialStatementsPage";
import JournalPage from "./pages/journal/JournalPage";
import EmiPage from "./pages/emi/EmiPage";
import HRMPage from "./pages/hrm/HRMPage";
import LeavesPage from "./pages/hrm/LeavesPage";
import SalaryStructurePage from "./pages/hrm/SalaryStructurePage";
import EmployeeDocumentsPage from "./pages/hrm/EmployeeDocumentsPage";
import ShiftsPage from "./pages/hrm/ShiftsPage";
import PerformanceReviewsPage from "./pages/hrm/PerformanceReviewsPage";
import TrainingPage from "./pages/hrm/TrainingPage";
import AssetsPage from "./pages/hrm/AssetsPage";
import EmployeeLoansPage from "./pages/hrm/EmployeeLoansPage";
import EmployeeExitsPage from "./pages/hrm/EmployeeExitsPage";
import PayslipPage from "./pages/hrm/PayslipPage";
import DirectorsPage from "./pages/directors/DirectorsPage";
import WarehousesPage from "./pages/warehouses/WarehousesPage";
import ReservationsPage from "./pages/reservations/ReservationsPage";
import InventoryIntelligencePage from "./pages/inventory-intelligence/InventoryIntelligencePage";
import Phase3ReportsPage from "./pages/reports/Phase3ReportsPage";
import SalaryVoucherPage from "./pages/vouchers/SalaryVoucherPage";
import DirectorVoucherPage from "./pages/vouchers/DirectorVoucherPage";
import AutoPoDraftPage from "./pages/purchases/AutoPoDraftPage";
import CustomerStatementPage from "./pages/customers/CustomerStatementPage";
import CustomerStatementsBulkPage from "./pages/customers/CustomerStatementsBulkPage";
import LeadsPage from "./pages/leads/LeadsPage";
import LeadVisitRegisterPage from "./pages/leads/LeadVisitRegisterPage";
import LeadOptionsPage from "./pages/leads/LeadOptionsPage";
import SingleSmsPage from "./pages/sms/SingleSmsPage";
import FileManagerPage from "./pages/files/FileManagerPage";
import HolidaysPage from "./pages/holidays/HolidaysPage";

// Super Admin
import SuperAdminLayout from "./pages/super-admin/SuperAdminLayout";
import SADashboardPage from "./pages/super-admin/SADashboardPage";
import SADealersPage from "./pages/super-admin/SADealersPage";
import SAPlansPage from "./pages/super-admin/SAPlansPage";
import SASubscriptionsPage from "./pages/super-admin/SASubscriptionsPage";
import SARevenuePage from "./pages/super-admin/SARevenuePage";
import SADealerPaymentsPage from "./pages/super-admin/SADealerPaymentsPage";
import SAPaymentRequestsPage from "./pages/super-admin/SAPaymentRequestsPage";
import SASystemPage from "./pages/super-admin/SASystemPage";
import SASubscriptionStatusPage from "./pages/super-admin/SASubscriptionStatusPage";
import SARemindersPage from "./pages/super-admin/SARemindersPage";
import SACmsPage from "./pages/super-admin/SACmsPage";
import SABackupPage from "./pages/super-admin/SABackupPage";
import SAUserGuidePage from "./pages/super-admin/SAUserGuidePage";
import SAAnnouncementsPage from "./pages/super-admin/SAAnnouncementsPage";
import SAAuditLogPage from "./pages/super-admin/SAAuditLogPage";
import SATotpSetupPage from "./pages/super-admin/SATotpSetupPage";
import SaEmployeeManagement from "./pages/admin/SaEmployeeManagement";
import SASettingsPage from "./pages/super-admin/SASettingsPage";
import SettingsPage from "./pages/settings/SettingsPage";
import PricingTiersPage from "./pages/settings/PricingTiersPage";
import DataBackupPage from "./pages/settings/DataBackupPage";
import RoleManagementPage from "./pages/settings/RoleManagementPage";
import BranchesPage from "./pages/settings/BranchesPage";
import NoticesPage from "./pages/settings/NoticesPage";
import PortalUsersPage from "./pages/admin/PortalUsersPage";
import PortalLayout from "./pages/portal/PortalLayout";
import PortalLoginPage from "./pages/portal/PortalLoginPage";
import PortalDashboardPage from "./pages/portal/PortalDashboardPage";
import PortalQuotationsPage from "./pages/portal/PortalQuotationsPage";
import PortalOrdersPage from "./pages/portal/PortalOrdersPage";
import PortalDeliveriesPage from "./pages/portal/PortalDeliveriesPage";
import PortalProjectsPage from "./pages/portal/PortalProjectsPage";
import PortalProjectDetailPage from "./pages/portal/PortalProjectDetailPage";
import PortalLedgerPage from "./pages/portal/PortalLedgerPage";
import PortalAccountPage from "./pages/portal/PortalAccountPage";
import PortalRequestsPage from "./pages/portal/PortalRequestsPage";
import PortalDocumentPage from "./pages/portal/PortalDocumentPage";
import PortalRequestsAdminPage from "./pages/admin/PortalRequestsAdminPage";

const IS_PRODUCTION = import.meta.env.PROD;

const queryClient = new QueryClient({
  // Global query-error surfacing: previously a failed *query* silently rendered
  // an empty state ("No records found") indistinguishable from a real load
  // error. In react-query v5 per-query onError was removed, so the QueryCache
  // handler is the single place to surface load failures as a toast. It fires
  // once per query after retries settle (not per retry).
  queryCache: new QueryCache({
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Failed to load data";
      console.error("[QueryError]", error);
      toast({
        title: "Couldn’t load data",
        description: message,
        variant: "destructive",
      });
    },
  }),
  defaultOptions: {
    queries: {
      retry: IS_PRODUCTION ? 2 : 0,
      staleTime: 30_000,
    },
    mutations: {
      // A DEFAULT handler: react-query only invokes it for mutations that do
      // NOT define their own onError, so this adds a fallback toast for the
      // many fire-and-forget mutations without doubling up on the ~74 that
      // already surface their own error.
      onError: (error: unknown) => {
        const message = error instanceof Error ? error.message : "Something went wrong";
        console.error("[MutationError]", error);
        toast({
          title: "Action failed",
          description: message,
          variant: "destructive",
        });
      },
    },
  },
});

/**
 * Bounces "/" to the right entry for the current subdomain.
 *   app.sanitileserp.com/    → /login
 *   portal.sanitileserp.com/ → /portal/login
 * Marketing host keeps "/" as the landing page.
 */
const HostEntryRedirect = () => {
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const target = getHostEntryRedirect(location.pathname, window.location.hostname);
    if (target && target !== location.pathname) {
      navigate(target, { replace: true });
    }
  }, [location.pathname, navigate]);
  return null;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <HostEntryRedirect />
          <ScrollToTop />
          <Routes>
            {/* Public */}
            <Route path="/" element={<LandingPage />} />
            <Route path="/landing" element={<LandingPage />} />
            <Route path="/pricing" element={<PricingPage />} />
            <Route path="/privacy" element={<PrivacyPolicyPage />} />
            <Route path="/terms" element={<TermsPage />} />
            <Route path="/contact" element={<ContactPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/get-started" element={<GetStartedPage />} />
            <Route path="/subscription-blocked" element={<SubscriptionBlockedPage />} />

            {/* Super Admin Panel — role guard inside layout */}
            <Route path="/super-admin" element={<SuperAdminLayout />}>
              <Route index element={<SADashboardPage />} />
              <Route path="dealers" element={<SADealersPage />} />
              <Route path="plans" element={<SAPlansPage />} />
              <Route path="subscriptions" element={<SASubscriptionsPage />} />
              <Route path="subscription-status" element={<SASubscriptionStatusPage />} />
              <Route path="reminders" element={<SARemindersPage />} />
              <Route path="revenue" element={<SARevenuePage />} />
              <Route path="payments" element={<SADealerPaymentsPage />} />
              <Route path="payment-requests" element={<SAPaymentRequestsPage />} />
              <Route path="cms" element={<SACmsPage />} />
              <Route path="backups" element={<SABackupPage />} />
              <Route path="user-guide" element={<SAUserGuidePage />} />
              <Route path="system" element={<SASystemPage />} />
              <Route path="announcements" element={<SAAnnouncementsPage />} />
              <Route path="audit" element={<SAAuditLogPage />} />
              <Route path="totp-setup" element={<SATotpSetupPage />} />
              <Route path="settings" element={<SASettingsPage />} />
              <Route path="staff" element={<SaEmployeeManagement />} />
            </Route>

            {/* Dashboard + Reports: allowed in readonly */}
            <Route path="/dashboard" element={<ProtectedRoute allowReadonly><AppLayout><Index /></AppLayout></ProtectedRoute>} />
            <Route path="/reports" element={<ProtectedRoute allowReadonly><AppLayout><ReportsPage /></AppLayout></ProtectedRoute>} />
            <Route path="/reports/credit" element={<ProtectedRoute allowReadonly><AppLayout><CreditReportPage /></AppLayout></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute><AppLayout><SettingsPage /></AppLayout></ProtectedRoute>} />
            <Route path="/settings/login-history" element={<ProtectedRoute><AppLayout><LoginHistoryPage /></AppLayout></ProtectedRoute>} />
            <Route path="/subscription" element={<ProtectedRoute allowReadonly><AppLayout><SubscriptionPage /></AppLayout></ProtectedRoute>} />
            <Route path="/settings/pricing-tiers" element={<ProtectedRoute><AppLayout><PricingTiersPage /></AppLayout></ProtectedRoute>} />
            <Route path="/settings/data-backup" element={<ProtectedRoute><AppLayout><DataBackupPage /></AppLayout></ProtectedRoute>} />
            <Route path="/settings/roles" element={<ProtectedRoute><AppLayout><RoleManagementPage /></AppLayout></ProtectedRoute>} />
            <Route path="/settings/branches" element={<ProtectedRoute><AppLayout><BranchesPage /></AppLayout></ProtectedRoute>} />
            <Route path="/settings/notices" element={<ProtectedRoute><AppLayout><NoticesPage /></AppLayout></ProtectedRoute>} />
            <Route path="/notices" element={<ProtectedRoute allowReadonly><AppLayout><NoticesPage /></AppLayout></ProtectedRoute>} />
            <Route path="/bank-accounts" element={<ProtectedRoute><AppLayout><BankAccountsPage /></AppLayout></ProtectedRoute>} />
            <Route path="/bank-accounts/:id" element={<ProtectedRoute><AppLayout><BankAccountDetailPage /></AppLayout></ProtectedRoute>} />
            <Route path="/cashbook" element={<ProtectedRoute><AppLayout><CashbookPage /></AppLayout></ProtectedRoute>} />
            <Route path="/cash-closing" element={<ProtectedRoute><AppLayout><CashClosingPage /></AppLayout></ProtectedRoute>} />
            <Route path="/purchases/auto-draft" element={<ProtectedRoute><AppLayout><AutoPoDraftPage /></AppLayout></ProtectedRoute>} />
            <Route path="/customers/statements" element={<ProtectedRoute><AppLayout><CustomerStatementsBulkPage /></AppLayout></ProtectedRoute>} />
            <Route path="/customers/:customerId/statement" element={<ProtectedRoute><AppLayout><CustomerStatementPage /></AppLayout></ProtectedRoute>} />
            <Route path="/financials" element={<ProtectedRoute><AppLayout><FinancialStatementsPage /></AppLayout></ProtectedRoute>} />
            <Route path="/journal" element={<ProtectedRoute><AppLayout><JournalPage /></AppLayout></ProtectedRoute>} />
            <Route path="/emi" element={<ProtectedRoute><AppLayout><EmiPage /></AppLayout></ProtectedRoute>} />
            <Route path="/hrm" element={<ProtectedRoute><AppLayout><HRMPage /></AppLayout></ProtectedRoute>} />
            <Route path="/hrm/leaves" element={<ProtectedRoute><AppLayout><LeavesPage /></AppLayout></ProtectedRoute>} />
            <Route path="/hrm/salary-structure" element={<ProtectedRoute><AppLayout><SalaryStructurePage /></AppLayout></ProtectedRoute>} />
            <Route path="/hrm/documents" element={<ProtectedRoute><AppLayout><EmployeeDocumentsPage /></AppLayout></ProtectedRoute>} />
            <Route path="/hrm/shifts" element={<ProtectedRoute><AppLayout><ShiftsPage /></AppLayout></ProtectedRoute>} />
            <Route path="/hrm/performance" element={<ProtectedRoute><AppLayout><PerformanceReviewsPage /></AppLayout></ProtectedRoute>} />
            <Route path="/hrm/training" element={<ProtectedRoute><AppLayout><TrainingPage /></AppLayout></ProtectedRoute>} />
            <Route path="/hrm/assets" element={<ProtectedRoute><AppLayout><AssetsPage /></AppLayout></ProtectedRoute>} />
            <Route path="/hrm/loans" element={<ProtectedRoute><AppLayout><EmployeeLoansPage /></AppLayout></ProtectedRoute>} />
            <Route path="/hrm/exits" element={<ProtectedRoute><AppLayout><EmployeeExitsPage /></AppLayout></ProtectedRoute>} />
            <Route path="/hrm/payslip/:id" element={<ProtectedRoute><AppLayout><PayslipPage /></AppLayout></ProtectedRoute>} />
            <Route path="/directors" element={<ProtectedRoute><AppLayout><DirectorsPage /></AppLayout></ProtectedRoute>} />
            <Route path="/warehouses" element={<ProtectedRoute><AppLayout><WarehousesPage /></AppLayout></ProtectedRoute>} />
            <Route path="/reservations" element={<ProtectedRoute><AppLayout><ReservationsPage /></AppLayout></ProtectedRoute>} />
            <Route path="/inventory-intelligence" element={<ProtectedRoute><AppLayout><InventoryIntelligencePage /></AppLayout></ProtectedRoute>} />
            <Route path="/reports/operations" element={<ProtectedRoute><AppLayout><Phase3ReportsPage /></AppLayout></ProtectedRoute>} />
            <Route path="/vouchers/salary/:id" element={<ProtectedRoute><AppLayout><SalaryVoucherPage /></AppLayout></ProtectedRoute>} />
            <Route path="/vouchers/director/:id" element={<ProtectedRoute><AppLayout><DirectorVoucherPage /></AppLayout></ProtectedRoute>} />

            {/* Full-access routes */}
            <Route path="/products" element={<ProtectedRoute><AppLayout><ProductsPage /></AppLayout></ProtectedRoute>} />
            <Route path="/products/new" element={<ProtectedRoute><AppLayout><CreateProductRoute /></AppLayout></ProtectedRoute>} />
            <Route path="/products/:id/edit" element={<ProtectedRoute><AppLayout><EditProduct /></AppLayout></ProtectedRoute>} />
            {/* V2 Sprint 3A — Inventory Core */}
            <Route path="/inventory" element={<ProtectedRoute><AppLayout><InventoryPage /></AppLayout></ProtectedRoute>} />
            <Route path="/damage" element={<ProtectedRoute><AppLayout><DamagePage /></AppLayout></ProtectedRoute>} />
            <Route path="/suppliers" element={<ProtectedRoute><AppLayout><SuppliersPage /></AppLayout></ProtectedRoute>} />
            <Route path="/suppliers/new" element={<ProtectedRoute><AppLayout><CreateSupplier /></AppLayout></ProtectedRoute>} />
            <Route path="/suppliers/:id/edit" element={<ProtectedRoute><AppLayout><EditSupplier /></AppLayout></ProtectedRoute>} />
            <Route path="/purchases" element={<ProtectedRoute><AppLayout><PurchasesPage /></AppLayout></ProtectedRoute>} />
            <Route path="/purchases/new" element={<ProtectedRoute><AppLayout><CreatePurchase /></AppLayout></ProtectedRoute>} />
            <Route path="/purchases/:id" element={<ProtectedRoute><AppLayout><ViewPurchase /></AppLayout></ProtectedRoute>} />
            <Route path="/customers" element={<ProtectedRoute><AppLayout><CustomersPage /></AppLayout></ProtectedRoute>} />
            <Route path="/customers/new" element={<ProtectedRoute><AppLayout><CreateCustomer /></AppLayout></ProtectedRoute>} />
            <Route path="/customers/:id/edit" element={<ProtectedRoute><AppLayout><EditCustomer /></AppLayout></ProtectedRoute>} />
            <Route path="/customers/:id" element={<ProtectedRoute><AppLayout><CustomerProfilePage /></AppLayout></ProtectedRoute>} />
            <Route path="/leads" element={<ProtectedRoute><AppLayout><LeadsPage /></AppLayout></ProtectedRoute>} />
            <Route path="/leads/visits" element={<ProtectedRoute><AppLayout><LeadVisitRegisterPage /></AppLayout></ProtectedRoute>} />
            <Route path="/leads/options" element={<ProtectedRoute><AppLayout><LeadOptionsPage /></AppLayout></ProtectedRoute>} />
            <Route path="/sms/single" element={<ProtectedRoute><AppLayout><SingleSmsPage /></AppLayout></ProtectedRoute>} />
            <Route path="/files" element={<ProtectedRoute><AppLayout><FileManagerPage /></AppLayout></ProtectedRoute>} />
            <Route path="/holidays" element={<ProtectedRoute><AppLayout><HolidaysPage /></AppLayout></ProtectedRoute>} />
            <Route path="/sales" element={<ProtectedRoute><AppLayout><SalesPage /></AppLayout></ProtectedRoute>} />
            <Route path="/tools/tile-calculator" element={<ProtectedRoute allowReadonly><AppLayout><TileCalculatorPage /></AppLayout></ProtectedRoute>} />
            <Route path="/sales/new" element={<ProtectedRoute><AppLayout><CreateSale /></AppLayout></ProtectedRoute>} />
            <Route path="/sales/:id/invoice" element={<ProtectedRoute><AppLayout><InvoicePage /></AppLayout></ProtectedRoute>} />
            <Route path="/sales/:id/edit" element={<ProtectedRoute><AppLayout><EditSale /></AppLayout></ProtectedRoute>} />
            <Route path="/challans/:id" element={<ProtectedRoute><AppLayout><ChallanPage /></AppLayout></ProtectedRoute>} />
            <Route path="/challans" element={<ProtectedRoute><AppLayout><ChallansPage /></AppLayout></ProtectedRoute>} />
            <Route path="/deliveries" element={<ProtectedRoute><AppLayout><DeliveriesPage /></AppLayout></ProtectedRoute>} />
            <Route path="/sales-returns" element={<ProtectedRoute><AppLayout><SalesReturnsPage /></AppLayout></ProtectedRoute>} />
            <Route path="/sales-returns/new" element={<ProtectedRoute><AppLayout><CreateSalesReturn /></AppLayout></ProtectedRoute>} />
            <Route path="/purchase-returns" element={<ProtectedRoute><AppLayout><PurchaseReturnsPage /></AppLayout></ProtectedRoute>} />
            <Route path="/purchase-returns/new" element={<ProtectedRoute><AppLayout><CreatePurchaseReturn /></AppLayout></ProtectedRoute>} />
            <Route path="/sales/pos" element={<ProtectedRoute><POSSalePage /></ProtectedRoute>} />
            <Route path="/ledger" element={<ProtectedRoute><AppLayout><LedgerPage /></AppLayout></ProtectedRoute>} />
            <Route path="/campaigns" element={<ProtectedRoute><AppLayout><CampaignsPage /></AppLayout></ProtectedRoute>} />
            <Route path="/collections" element={<ProtectedRoute><AppLayout><CollectionsPage /></AppLayout></ProtectedRoute>} />
            <Route path="/payables" element={<ProtectedRoute><AppLayout><SupplierPayablesPage /></AppLayout></ProtectedRoute>} />
            <Route path="/payables/pay" element={<ProtectedRoute><AppLayout><SupplierPaymentPage /></AppLayout></ProtectedRoute>} />
            <Route path="/approvals" element={<ProtectedRoute><AppLayout><ApprovalsPage /></AppLayout></ProtectedRoute>} />
            <Route path="/quotations" element={<ProtectedRoute><AppLayout><QuotationsPage /></AppLayout></ProtectedRoute>} />
            <Route path="/quotations/new" element={<ProtectedRoute><AppLayout><CreateQuotation /></AppLayout></ProtectedRoute>} />
            <Route path="/quotations/:id/edit" element={<ProtectedRoute><AppLayout><EditQuotation /></AppLayout></ProtectedRoute>} />
            <Route path="/projects" element={<ProtectedRoute><AppLayout><ProjectsPage /></AppLayout></ProtectedRoute>} />
            <Route path="/referrals" element={<ProtectedRoute><AppLayout><ReferralSourcesPage /></AppLayout></ProtectedRoute>} />
            <Route path="/display-sample" element={<ProtectedRoute><AppLayout><DisplaySampleStockPage /></AppLayout></ProtectedRoute>} />
            <Route path="/whatsapp-logs" element={<ProtectedRoute><AppLayout><WhatsAppLogsPage /></AppLayout></ProtectedRoute>} />
            <Route path="/admin/portal-users" element={<ProtectedRoute><AppLayout><PortalUsersPage /></AppLayout></ProtectedRoute>} />
            <Route path="/admin/portal-requests" element={<ProtectedRoute><AppLayout><PortalRequestsAdminPage /></AppLayout></ProtectedRoute>} />
            <Route path="/user-guide" element={<ProtectedRoute><AppLayout><UserGuidePage /></AppLayout></ProtectedRoute>} />

            {/* Customer / Contractor Portal (external users) */}
            <Route path="/portal/login" element={<PortalLoginPage />} />
            <Route path="/portal" element={<PortalLayout />}>
              <Route index element={<Navigate to="/portal/dashboard" replace />} />
              <Route path="dashboard" element={<PortalDashboardPage />} />
              <Route path="quotations" element={<PortalQuotationsPage />} />
              <Route path="orders" element={<PortalOrdersPage />} />
              <Route path="deliveries" element={<PortalDeliveriesPage />} />
              <Route path="projects" element={<PortalProjectsPage />} />
              <Route path="projects/:id" element={<PortalProjectDetailPage />} />
              <Route path="statement" element={<PortalLedgerPage />} />
              <Route path="requests" element={<PortalRequestsPage />} />
              <Route path="account" element={<PortalAccountPage />} />
              <Route path="quotation/:id" element={<PortalDocumentPage kind="quotation" />} />
              <Route path="invoice/:id" element={<PortalDocumentPage kind="invoice" />} />
              <Route path="challan/:id" element={<PortalDocumentPage kind="challan" />} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
