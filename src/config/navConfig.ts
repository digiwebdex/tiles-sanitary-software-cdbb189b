import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard, Package, ShoppingCart, Receipt, RotateCcw,
  BookOpen, BarChart3, Settings, Truck, Users, ShieldCheck, FileText,
  Undo2, MapPin, Zap, Gift, Wallet, FileSignature, Folder, HandCoins, MonitorSpeaker,
  MessageCircle, UserCog, Inbox, HelpCircle, Crown, Landmark, Scale, Warehouse,
  ClipboardCheck, Sparkles, CalendarDays, AlertTriangle, CalendarClock, Building2,
  Megaphone, Award, GraduationCap, Laptop, BadgeDollarSign, Clock, LogOut,
} from "lucide-react";

export type NavItem = {
  path: string;
  label: string;
  icon: LucideIcon;
  readonlyAllowed?: boolean;
  dealerAdminOnly?: boolean;
  superAdminOnly?: boolean;
};

export type NavSection = {
  id: string;
  label: string;
  defaultOpen?: boolean;
  items: NavItem[];
};

/** Phase 7 — grouped collapsible sidebar (10 sections). */
export const navSections: NavSection[] = [
  {
    id: "overview",
    label: "Overview",
    defaultOpen: true,
    items: [
      { path: "/dashboard", label: "Dashboard", icon: LayoutDashboard, readonlyAllowed: true },
      { path: "/approvals", label: "Approvals", icon: ShieldCheck },
      { path: "/notices", label: "Notice Board", icon: Megaphone, readonlyAllowed: true },
      { path: "/user-guide", label: "User Guide", icon: HelpCircle, readonlyAllowed: true },
    ],
  },
  {
    id: "sales",
    label: "Sales",
    defaultOpen: true,
    items: [
      { path: "/sales", label: "Sales", icon: Receipt },
      { path: "/sales/pos", label: "POS", icon: Zap },
      { path: "/challans", label: "Challans", icon: FileText },
      { path: "/deliveries", label: "Deliveries", icon: MapPin },
      { path: "/sales-returns", label: "Sales Returns", icon: RotateCcw },
      { path: "/customers", label: "Customers", icon: Users },
      { path: "/customers/statements", label: "Customer Statements", icon: FileText, dealerAdminOnly: true },
      { path: "/leads", label: "Leads", icon: HandCoins },
      { path: "/leads/visits", label: "Visit Register", icon: HandCoins },
      { path: "/leads/options", label: "Lead Options", icon: HandCoins, dealerAdminOnly: true },
      { path: "/projects", label: "Projects", icon: Folder },
      { path: "/quotations", label: "Quotations", icon: FileSignature },
      { path: "/collections", label: "Collections", icon: Wallet },
    ],
  },
  {
    id: "purchase",
    label: "Purchase",
    defaultOpen: true,
    items: [
      { path: "/suppliers", label: "Suppliers", icon: Truck },
      { path: "/purchases", label: "Purchases", icon: ShoppingCart },
      { path: "/purchases/auto-draft", label: "Auto-PO Drafts", icon: Sparkles, dealerAdminOnly: true },
      { path: "/purchase-returns", label: "Purchase Returns", icon: Undo2 },
      { path: "/payables", label: "Supplier Payables", icon: Truck, dealerAdminOnly: true },
      { path: "/payables/pay", label: "Pay Supplier", icon: Wallet, dealerAdminOnly: true },
    ],
  },
  {
    id: "inventory",
    label: "Inventory",
    defaultOpen: false,
    items: [
      { path: "/products", label: "Products", icon: Package },
      { path: "/damage", label: "Damage / Broken", icon: AlertTriangle, dealerAdminOnly: true },
      { path: "/warehouses", label: "Warehouses", icon: Warehouse, dealerAdminOnly: true },
      { path: "/display-sample", label: "Display & Samples", icon: MonitorSpeaker },
    ],
  },
  {
    id: "finance",
    label: "Finance",
    defaultOpen: false,
    items: [
      { path: "/ledger", label: "Ledger", icon: BookOpen },
      { path: "/bank-accounts", label: "Bank Accounts", icon: Landmark, dealerAdminOnly: true },
      { path: "/cashbook", label: "Cashbook", icon: BookOpen, dealerAdminOnly: true },
      { path: "/cash-closing", label: "Day-End Closing", icon: ClipboardCheck, dealerAdminOnly: true },
      { path: "/financials", label: "Financial Statements", icon: Scale, dealerAdminOnly: true },
      { path: "/journal", label: "Journal Entries", icon: BookOpen, dealerAdminOnly: true },
      { path: "/emi", label: "EMI Plans", icon: CalendarClock, dealerAdminOnly: true },
      { path: "/directors", label: "Directors", icon: Crown, dealerAdminOnly: true },
    ],
  },
  {
    id: "hrm",
    label: "HRM",
    defaultOpen: false,
    items: [
      { path: "/hrm", label: "Employees", icon: Users, dealerAdminOnly: true },
      { path: "/hrm/leaves", label: "Leave Management", icon: CalendarDays, dealerAdminOnly: true },
      { path: "/hrm/salary-structure", label: "Salary Structure", icon: Wallet, dealerAdminOnly: true },
      { path: "/hrm/documents", label: "Employee Documents", icon: FileText, dealerAdminOnly: true },
      { path: "/hrm/shifts", label: "Shift Management", icon: Clock, dealerAdminOnly: true },
      { path: "/hrm/performance", label: "Performance Reviews", icon: Award, dealerAdminOnly: true },
      { path: "/hrm/training", label: "Training & Skills", icon: GraduationCap, dealerAdminOnly: true },
      { path: "/hrm/assets", label: "Asset Management", icon: Laptop, dealerAdminOnly: true },
      { path: "/hrm/loans", label: "Employee Loans", icon: BadgeDollarSign, dealerAdminOnly: true },
      { path: "/hrm/exits", label: "Exit / Offboarding", icon: LogOut, dealerAdminOnly: true },
      { path: "/holidays", label: "Holidays", icon: CalendarDays, dealerAdminOnly: true },
    ],
  },
  {
    id: "reports",
    label: "Reports",
    defaultOpen: false,
    items: [
      { path: "/reports", label: "Reports Hub", icon: BarChart3, readonlyAllowed: true },
      { path: "/reports/operations", label: "Operations Reports", icon: Scale, dealerAdminOnly: true },
      { path: "/reports/credit", label: "Credit Report", icon: ShieldCheck, readonlyAllowed: true },
    ],
  },
  {
    id: "campaigns",
    label: "Campaigns",
    defaultOpen: false,
    items: [
      { path: "/campaigns", label: "Campaigns", icon: Gift },
      { path: "/referrals", label: "Referrals", icon: HandCoins },
      { path: "/whatsapp-logs", label: "WhatsApp Log", icon: MessageCircle },
      { path: "/sms/single", label: "Send SMS", icon: MessageCircle },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    defaultOpen: false,
    items: [
      { path: "/settings", label: "Settings", icon: Settings },
      { path: "/settings/branches", label: "Manage Branches", icon: Building2, dealerAdminOnly: true },
      { path: "/files", label: "File Manager", icon: Folder, dealerAdminOnly: true },
      { path: "/admin/portal-users", label: "Portal Users", icon: UserCog, dealerAdminOnly: true },
      { path: "/admin/portal-requests", label: "Portal Requests", icon: Inbox, dealerAdminOnly: true },
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

export function filterNavItem(
  item: NavItem,
  opts: { isReadonly: boolean; isDealerAdmin: boolean; isSuperAdmin: boolean },
): boolean {
  if (item.superAdminOnly && !opts.isSuperAdmin) return false;
  if (item.dealerAdminOnly && !opts.isDealerAdmin && !opts.isSuperAdmin) return false;
  return true;
}
