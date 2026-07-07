import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard, Package, ShoppingCart, Receipt, RotateCcw,
  BookOpen, BarChart3, Settings, Truck, Users, ShieldCheck, FileText,
  Undo2, MapPin, Zap, Gift, Wallet, FileSignature, Folder, HandCoins, MonitorSpeaker,
  MessageCircle, UserCog, Inbox, HelpCircle, Crown, Landmark, Scale, Warehouse,
  ClipboardCheck, Sparkles, CalendarDays, AlertTriangle, CalendarClock, Building2,
  Megaphone, Award, GraduationCap, Laptop, BadgeDollarSign, Clock, LogOut,
  Calculator, Boxes, Bookmark, Gauge, ClipboardList, FileEdit, Send, FileCheck2, PackageCheck,
} from "lucide-react";

/** Staff roles below the owner (dealer_admin). Owner + super_admin see all. */
export type StaffRole = "manager" | "accountant" | "salesman";

/**
 * Plan-gated feature keys. When a dealer's plan does not include the feature,
 * all nav items tagged with that planFeature are hidden.
 */
export type PlanFeatureKey =
  | "hrm"
  | "campaigns"
  | "portal"
  | "advanced_finance"
  | "advanced_reports"
  | "pos"
  | "leads"
  | "projects"
  | "quotations"
  | "backorders";

export type NavItem = {
  path: string;
  label: string;
  icon: LucideIcon;
  readonlyAllowed?: boolean;
  dealerAdminOnly?: boolean;
  superAdminOnly?: boolean;
  /**
   * Hidden when the dealer's menu mode is "simple". Owner can reveal via Settings.
   */
  tier?: "advanced";
  /**
   * Which staff roles may see this item. Owner (dealer_admin) and super_admin
   * always see it (subject to tier/planFeature). If omitted, all staff roles see it.
   */
  roles?: StaffRole[];
  /**
   * Plan-gated feature. Hidden unless the dealer's active plan has this
   * feature enabled. super_admin is unaffected (sees all items).
   */
  planFeature?: PlanFeatureKey;
};

export type NavSection = {
  id: string;
  label: string;
  defaultOpen?: boolean;
  items: NavItem[];
};

export type PlanFeaturesMap = {
  hrmEnabled: boolean;
  campaignsEnabled: boolean;
  portalEnabled: boolean;
  advancedFinanceEnabled: boolean;
  advancedReportsEnabled: boolean;
  posEnabled: boolean;
  leadsEnabled: boolean;
  projectsEnabled: boolean;
  quotationsEnabled: boolean;
  backordersEnabled: boolean;
};

/** Phase 7 — grouped collapsible sidebar (10 sections). */
export const navSections: NavSection[] = [
  {
    id: "overview",
    label: "Overview",
    defaultOpen: true,
    items: [
      { path: "/dashboard", label: "Dashboard", icon: LayoutDashboard, readonlyAllowed: true },
      { path: "/approvals", label: "Approvals", icon: ShieldCheck, roles: ["manager", "accountant"] },
      { path: "/notices", label: "Notice Board", icon: Megaphone, readonlyAllowed: true, tier: "advanced" },
      { path: "/user-guide", label: "User Guide", icon: HelpCircle, readonlyAllowed: true },
    ],
  },
  {
    id: "sales",
    label: "Sales",
    defaultOpen: true,
    items: [
      { path: "/sales", label: "Sales", icon: Receipt, roles: ["manager", "salesman"] },
      { path: "/sales/pos", label: "POS", icon: Zap, planFeature: "pos", roles: ["manager", "salesman"] },
      { path: "/tools/tile-calculator", label: "Tile Calculator", icon: Calculator, readonlyAllowed: true, roles: ["manager", "salesman"] },
      { path: "/challans", label: "Challans", icon: FileText, roles: ["manager", "salesman"] },
      { path: "/deliveries", label: "Deliveries", icon: MapPin, roles: ["manager", "salesman"] },
      { path: "/sales-returns", label: "Sales Returns", icon: RotateCcw, roles: ["manager", "salesman"] },
      { path: "/customers", label: "Customers", icon: Users, roles: ["manager", "salesman", "accountant"] },
      { path: "/customers/statements", label: "Customer Statements", icon: FileText, dealerAdminOnly: true },
      { path: "/leads", label: "Leads", icon: HandCoins, planFeature: "leads", roles: ["manager", "salesman"] },
      { path: "/leads/visits", label: "Visit Register", icon: HandCoins, planFeature: "leads", roles: ["manager", "salesman"] },
      { path: "/leads/options", label: "Lead Options", icon: HandCoins, dealerAdminOnly: true, planFeature: "leads" },
      { path: "/projects", label: "Projects", icon: Folder, planFeature: "projects", roles: ["manager", "salesman"] },
      { path: "/quotations", label: "Quotations", icon: FileSignature, planFeature: "quotations", roles: ["manager", "salesman"] },
      { path: "/sales-orders", label: "Sales Orders", icon: ClipboardList, planFeature: "quotations", roles: ["manager", "salesman"] },
      { path: "/collections", label: "Collections", icon: Wallet, roles: ["manager", "salesman", "accountant"] },
    ],
  },
  {
    id: "purchase",
    label: "Purchase",
    defaultOpen: true,
    items: [
      { path: "/suppliers", label: "Suppliers", icon: Truck, roles: ["manager", "accountant"] },
      { path: "/purchase-requests", label: "Purchase Requests", icon: FileEdit, roles: ["manager"] },
      { path: "/rfqs", label: "RFQs", icon: Send, roles: ["manager"], tier: "advanced" },
      { path: "/purchase-orders", label: "Purchase Orders", icon: FileCheck2, roles: ["manager"] },
      { path: "/goods-receipts", label: "Goods Receipt (GRN)", icon: PackageCheck, roles: ["manager"] },
      { path: "/purchase-invoices", label: "Purchase Invoices", icon: Receipt, roles: ["manager", "accountant"] },
      { path: "/purchases", label: "Purchases", icon: ShoppingCart, roles: ["manager"] },
      { path: "/purchases/auto-draft", label: "Auto-PO Drafts", icon: Sparkles, dealerAdminOnly: true, tier: "advanced" },
      { path: "/purchase-returns", label: "Purchase Returns", icon: Undo2, roles: ["manager"] },
      { path: "/payables", label: "Supplier Payables", icon: Truck, dealerAdminOnly: true },
      { path: "/payables/pay", label: "Pay Supplier", icon: Wallet, dealerAdminOnly: true },
      { path: "/supplier-ledger/statement", label: "Supplier Statement", icon: FileText, roles: ["manager", "accountant"] },
      { path: "/supplier-ledger/aging", label: "Payables Aging", icon: CalendarClock, dealerAdminOnly: true },
      { path: "/purchase-returns-v2", label: "Purchase Returns (V2)", icon: RotateCcw, roles: ["manager", "accountant"] },
      { path: "/landed-cost", label: "Landed Cost", icon: Calculator, dealerAdminOnly: true },
      { path: "/stock-cost-adjustments", label: "Stock Cost Update", icon: Scale, dealerAdminOnly: true },
      { path: "/import-lc", label: "Import LC", icon: Landmark, roles: ["manager", "accountant"], tier: "advanced" },
    ],
  },
  {
    id: "inventory",
    label: "Inventory",
    defaultOpen: false,
    items: [
      { path: "/products", label: "Products", icon: Package, roles: ["manager", "salesman"] },
      // V2 Sprint 3A — Inventory Core: dealer-wide current stock, stock
      // ledger/history, movement, adjustment, and summary.
      { path: "/inventory", label: "Current Stock", icon: Boxes, roles: ["manager", "salesman"] },
      { path: "/damage", label: "Damage / Broken", icon: AlertTriangle, dealerAdminOnly: true },
      // Warehouses visible on all plans — quantity is limited by plan (enforced in backend)
      { path: "/warehouses", label: "Warehouses", icon: Warehouse, dealerAdminOnly: true },
      { path: "/display-sample", label: "Display & Samples", icon: MonitorSpeaker, roles: ["manager", "salesman"] },
      // V2 Sprint 3C — Reservation, Backorder & Availability Engine.
      { path: "/reservations", label: "Reservations & Backorders", icon: Bookmark, roles: ["manager", "salesman"] },
      // V2 Sprint 3D — Inventory Intelligence.
      { path: "/inventory-intelligence", label: "Inventory Intelligence", icon: Gauge, dealerAdminOnly: true },
    ],
  },
  {
    id: "finance",
    label: "Finance",
    defaultOpen: false,
    items: [
      { path: "/ledger", label: "Ledger", icon: BookOpen, roles: ["manager", "accountant"] },
      { path: "/bank-accounts", label: "Bank Accounts", icon: Landmark, dealerAdminOnly: true },
      { path: "/cashbook", label: "Cashbook", icon: BookOpen, dealerAdminOnly: true },
      { path: "/cash-closing", label: "Day-End Closing", icon: ClipboardCheck, dealerAdminOnly: true },
      { path: "/financials", label: "Financial Statements", icon: Scale, dealerAdminOnly: true },
      { path: "/journal", label: "Journal Entries", icon: BookOpen, dealerAdminOnly: true, planFeature: "advanced_finance" },
      { path: "/journal/chart-of-accounts", label: "Chart of Accounts", icon: Landmark, dealerAdminOnly: true, planFeature: "advanced_finance" },
      { path: "/journal/fiscal-years", label: "Fiscal Years", icon: CalendarClock, dealerAdminOnly: true, planFeature: "advanced_finance" },
      { path: "/emi", label: "EMI Plans", icon: CalendarClock, dealerAdminOnly: true, planFeature: "advanced_finance" },
      { path: "/directors", label: "Directors", icon: Crown, dealerAdminOnly: true, planFeature: "advanced_finance" },
    ],
  },
  {
    id: "hrm",
    label: "HRM",
    defaultOpen: false,
    items: [
      { path: "/hrm", label: "Employees", icon: Users, dealerAdminOnly: true, planFeature: "hrm" },
      { path: "/hrm/leaves", label: "Leave Management", icon: CalendarDays, dealerAdminOnly: true, planFeature: "hrm" },
      { path: "/hrm/salary-structure", label: "Salary Structure", icon: Wallet, dealerAdminOnly: true, planFeature: "hrm" },
      { path: "/hrm/documents", label: "Employee Documents", icon: FileText, dealerAdminOnly: true, planFeature: "hrm" },
      { path: "/hrm/shifts", label: "Shift Management", icon: Clock, dealerAdminOnly: true, planFeature: "hrm" },
      { path: "/hrm/performance", label: "Performance Reviews", icon: Award, dealerAdminOnly: true, planFeature: "hrm" },
      { path: "/hrm/training", label: "Training & Skills", icon: GraduationCap, dealerAdminOnly: true, planFeature: "hrm" },
      { path: "/hrm/assets", label: "Asset Management", icon: Laptop, dealerAdminOnly: true, planFeature: "hrm" },
      { path: "/hrm/loans", label: "Employee Loans", icon: BadgeDollarSign, dealerAdminOnly: true, planFeature: "hrm" },
      { path: "/hrm/exits", label: "Exit / Offboarding", icon: LogOut, dealerAdminOnly: true, planFeature: "hrm" },
      { path: "/holidays", label: "Holidays", icon: CalendarDays, dealerAdminOnly: true, planFeature: "hrm" },
    ],
  },
  {
    id: "reports",
    label: "Reports",
    defaultOpen: false,
    items: [
      { path: "/reports", label: "Reports Hub", icon: BarChart3, readonlyAllowed: true, roles: ["manager", "accountant"] },
      { path: "/reports/operations", label: "Operations Reports", icon: Scale, dealerAdminOnly: true, planFeature: "advanced_reports" },
      { path: "/reports/credit", label: "Credit Report", icon: ShieldCheck, readonlyAllowed: true, roles: ["manager", "accountant"] },
      { path: "/reports/vat", label: "VAT Reports", icon: Landmark, dealerAdminOnly: true },
    ],
  },
  {
    id: "campaigns",
    label: "Campaigns",
    defaultOpen: false,
    items: [
      { path: "/campaigns", label: "Campaigns", icon: Gift, planFeature: "campaigns", roles: ["manager"] },
      { path: "/referrals", label: "Referrals", icon: HandCoins, planFeature: "campaigns", roles: ["manager"] },
      { path: "/whatsapp-logs", label: "WhatsApp Log", icon: MessageCircle, planFeature: "campaigns", roles: ["manager"] },
      { path: "/sms/single", label: "Send SMS", icon: MessageCircle, planFeature: "campaigns", roles: ["manager"] },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    defaultOpen: false,
    items: [
      { path: "/settings", label: "Settings", icon: Settings },
      { path: "/settings/login-history", label: "Login History", icon: ShieldCheck, dealerAdminOnly: true },
      { path: "/settings/branches", label: "Manage Branches", icon: Building2, dealerAdminOnly: true, tier: "advanced" },
      { path: "/files", label: "File Manager", icon: Folder, dealerAdminOnly: true, tier: "advanced" },
      { path: "/admin/portal-users", label: "Portal Users", icon: UserCog, dealerAdminOnly: true, planFeature: "portal" },
      { path: "/admin/portal-requests", label: "Portal Inbox", icon: Inbox, dealerAdminOnly: true, planFeature: "portal" },
      { path: "/subscription", label: "Subscription", icon: Crown, dealerAdminOnly: true, readonlyAllowed: true },
    ],
  },
  {
    id: "super-admin",
    label: "Super Admin",
    defaultOpen: false,
    items: [
      { path: "/super-admin", label: "Super Admin Console", icon: Settings, superAdminOnly: true },
    ],
  },
];

export function isNavItemActive(pathname: string, itemPath: string): boolean {
  if (pathname === itemPath) return true;
  if (itemPath === "/dashboard") return false;
  return pathname.startsWith(`${itemPath}/`);
}

export type NavFilterOpts = {
  isReadonly: boolean;
  isDealerAdmin: boolean;
  isSuperAdmin: boolean;
  isSaEmployee?: boolean;
  isManager?: boolean;
  isAccountant?: boolean;
  isSalesman?: boolean;
  menuMode?: "simple" | "advanced";
  planFeatures?: PlanFeaturesMap | null;
};

// Advanced plan features (everything except the standard POS). An item behind
// one of these — or flagged tier:"advanced" — belongs to the advanced menu.
const ADVANCED_FEATURES = new Set<PlanFeatureKey>([
  "quotations", "projects", "leads", "hrm", "campaigns",
  "advanced_finance", "advanced_reports", "portal", "backorders",
]);

/**
 * A package has the advanced menu if it includes any advanced feature — i.e.
 * Business / Premium Custom. Used both to gate the advanced items and to decide
 * whether the Simple/Advanced toggle appears in Settings.
 */
export function planHasAdvancedMenu(pf: PlanFeaturesMap | null | undefined): boolean {
  if (!pf) return false;
  return !!(
    pf.quotationsEnabled || pf.projectsEnabled || pf.leadsEnabled || pf.hrmEnabled ||
    pf.campaignsEnabled || pf.advancedFinanceEnabled || pf.advancedReportsEnabled ||
    pf.portalEnabled || pf.backordersEnabled
  );
}

export function filterNavItem(item: NavItem, opts: NavFilterOpts): boolean {
  if (item.superAdminOnly) return !!opts.isSuperAdmin || !!opts.isSaEmployee;
  if (item.dealerAdminOnly && !opts.isDealerAdmin && !opts.isSuperAdmin) return false;

  // Advanced menu: an item is "advanced" if flagged tier:"advanced" (the 4
  // utility items: Notice Board, Auto-PO, Manage Branches, File Manager) OR
  // gated by an advanced plan feature (Quotations, HRM, Projects, …). The whole
  // advanced menu exists ONLY for packages that include advanced features
  // (Business / Premium Custom); within those, the dealer turns it on via the
  // Settings Simple/Advanced toggle.
  const isAdvancedItem =
    item.tier === "advanced" ||
    (!!item.planFeature && ADVANCED_FEATURES.has(item.planFeature));
  if (isAdvancedItem && !opts.isSuperAdmin) {
    if (!planHasAdvancedMenu(opts.planFeatures)) return false; // not a Business/Premium package
    if (opts.menuMode === "simple") return false;              // dealer hasn't enabled it
  }

  // Plan-feature gate: super_admin bypasses all plan restrictions.
  if (item.planFeature && !opts.isSuperAdmin) {
    const pf = opts.planFeatures;
    if (!pf) return false;
    const featureMap: Record<PlanFeatureKey, boolean> = {
      hrm: pf.hrmEnabled,
      campaigns: pf.campaignsEnabled,
      portal: pf.portalEnabled,
      advanced_finance: pf.advancedFinanceEnabled,
      advanced_reports: pf.advancedReportsEnabled,
      pos: pf.posEnabled,
      leads: pf.leadsEnabled,
      projects: pf.projectsEnabled,
      quotations: pf.quotationsEnabled,
      backorders: pf.backordersEnabled,
    };
    if (!featureMap[item.planFeature]) return false;
  }

  // Role scoping applies only to staff (not the owner or super_admin).
  const isStaffOnly = !opts.isDealerAdmin && !opts.isSuperAdmin;
  if (isStaffOnly && item.roles) {
    const allowed =
      (!!opts.isManager && item.roles.includes("manager")) ||
      (!!opts.isAccountant && item.roles.includes("accountant")) ||
      (!!opts.isSalesman && item.roles.includes("salesman"));
    if (!allowed) return false;
  }

  return true;
}
