import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  LayoutDashboard, Package, ShoppingCart, Receipt, RotateCcw,
  BookOpen, BarChart3, LogOut, Settings, Clock, Truck, Users, ShieldCheck, FileText,
  Undo2, MapPin, Zap, Gift, Wallet, FileSignature, Folder, HandCoins, MonitorSpeaker,
  MessageCircle, UserCog, Inbox, HelpCircle, Crown, Landmark, Scale, Warehouse, ClipboardCheck, Sparkles, CalendarDays, AlertTriangle, CalendarClock, Building2, Megaphone, Award, GraduationCap, Laptop, BadgeDollarSign, LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useDealerId } from "@/hooks/useDealerId";
import { PendingApprovalsBadge } from "@/components/approval/PendingApprovalsBadge";
import SAImpersonationBanner from "@/components/SAImpersonationBanner";
import { DemoBanner } from "@/components/DemoBanner";
import { AppHeader } from "@/components/AppHeader";
import { useQuery } from "@tanstack/react-query";
import { fetchCurrentSubscription } from "@/services/dealerSubscriptionService";

const navItems = [
  { path: "/dashboard", label: "Dashboard", icon: LayoutDashboard, readonlyAllowed: true },
  { path: "/products", label: "Products", icon: Package },
  { path: "/damage", label: "Damage / Broken", icon: AlertTriangle, dealerAdminOnly: true },
  { path: "/suppliers", label: "Suppliers", icon: Truck },
  { path: "/purchases", label: "Purchases", icon: ShoppingCart },
  { path: "/purchases/auto-draft", label: "Auto-PO Drafts", icon: Sparkles, dealerAdminOnly: true },
  { path: "/customers", label: "Customers", icon: Users },
  { path: "/leads", label: "Leads", icon: HandCoins },
  { path: "/leads/visits", label: "Visit Register", icon: HandCoins },
  { path: "/leads/options", label: "Lead Options", icon: HandCoins, dealerAdminOnly: true },
  { path: "/customers/statements", label: "Customer Statements", icon: FileText, dealerAdminOnly: true },
  { path: "/projects", label: "Projects", icon: Folder },
  { path: "/quotations", label: "Quotations", icon: FileSignature },
  { path: "/sales", label: "Sales", icon: Receipt },
  { path: "/sales/pos", label: "POS", icon: Zap },
  { path: "/challans", label: "Challans", icon: FileText },
  { path: "/deliveries", label: "Deliveries", icon: MapPin },
  { path: "/sales-returns", label: "Sales Returns", icon: RotateCcw },
  { path: "/purchase-returns", label: "Purchase Returns", icon: Undo2 },
  { path: "/ledger", label: "Ledger", icon: BookOpen },
  { path: "/collections", label: "Payments", icon: Wallet },
  { path: "/bank-accounts", label: "Bank Accounts", icon: Landmark, dealerAdminOnly: true },
  { path: "/cashbook", label: "Cashbook", icon: BookOpen, dealerAdminOnly: true },
  { path: "/cash-closing", label: "Day-End Closing", icon: ClipboardCheck, dealerAdminOnly: true },
  { path: "/financials", label: "Financial Statements", icon: Scale, dealerAdminOnly: true },
  { path: "/journal", label: "Journal Entries", icon: BookOpen, dealerAdminOnly: true },
  { path: "/emi", label: "EMI Plans", icon: CalendarClock, dealerAdminOnly: true },
  { path: "/hrm", label: "HRM (Employees)", icon: Users, dealerAdminOnly: true },
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
  { path: "/directors", label: "Directors", icon: Crown, dealerAdminOnly: true },
  { path: "/warehouses", label: "Warehouses", icon: Warehouse, dealerAdminOnly: true },
  { path: "/reports/operations", label: "Operations Reports", icon: Scale, dealerAdminOnly: true },
  { path: "/approvals", label: "Approvals", icon: ShieldCheck },
  { path: "/campaigns", label: "Campaigns", icon: Gift },
  { path: "/referrals", label: "Referrals", icon: HandCoins },
  { path: "/display-sample", label: "Display & Samples", icon: MonitorSpeaker },
  { path: "/reports", label: "Reports", icon: BarChart3, readonlyAllowed: true },
  { path: "/reports/credit", label: "Credit Report", icon: ShieldCheck, readonlyAllowed: true },
  { path: "/whatsapp-logs", label: "WhatsApp Log", icon: MessageCircle },
  { path: "/sms/single", label: "Send SMS", icon: MessageCircle },
  { path: "/files", label: "File Manager", icon: Folder, dealerAdminOnly: true },
  { path: "/admin/portal-users", label: "Portal Users", icon: UserCog, dealerAdminOnly: true },
  { path: "/admin/portal-requests", label: "Portal Requests", icon: Inbox, dealerAdminOnly: true },
  { path: "/user-guide", label: "User Guide", icon: HelpCircle, readonlyAllowed: true },
  { path: "/subscription", label: "Subscription", icon: Crown, dealerAdminOnly: true, readonlyAllowed: true },
  { path: "/notices", label: "Notice Board", icon: Megaphone, readonlyAllowed: true },
  { path: "/settings/branches", label: "Manage Branches", icon: Building2, dealerAdminOnly: true },
  { path: "/settings", label: "Settings", icon: Settings, readonlyAllowed: false },
];

const AppLayout = ({ children }: { children: React.ReactNode }) => {
  const { profile, accessLevel, isSuperAdmin, isDealerAdmin, signOut } = useAuth();
  const { data: currentSub } = useQuery({
    queryKey: ["current-subscription-badge"],
    queryFn: fetchCurrentSubscription,
    enabled: !isSuperAdmin,
    staleTime: 5 * 60 * 1000,
  });
  const navigate = useNavigate();
  const location = useLocation();
  const dealerIdForBadge = profile?.dealer_id ?? "";

  const isReadonly = accessLevel === "readonly";
  const isGrace = accessLevel === "grace";

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside className="hidden md:flex w-56 flex-col border-r bg-card p-4 gap-1">
        <div className="flex items-center justify-between mb-4 px-2">
          <h2 className="text-lg font-bold text-foreground">ERP</h2>
          {isDealerAdmin && dealerIdForBadge && (
            <PendingApprovalsBadge dealerId={dealerIdForBadge} onClick={() => navigate("/approvals")} />
          )}
        </div>

        {isGrace && (
          <Badge variant="outline" className="mb-3 text-yellow-600 border-yellow-400 justify-center text-xs">
            <Clock className="mr-1 h-3 w-3" /> Grace Period
          </Badge>
        )}
        {isReadonly && (
          <Badge variant="destructive" className="mb-3 justify-center text-xs">
            Read-Only
          </Badge>
        )}

        <nav className="flex-1 space-y-1">
          {navItems.map((item) => {
            if ((item as any).dealerAdminOnly && !isDealerAdmin && !isSuperAdmin) return null;
            const disabled = isReadonly && !item.readonlyAllowed;
            const active = location.pathname === item.path;
            return (
              <button
                key={item.path}
                onClick={() => !disabled && navigate(item.path)}
                disabled={disabled}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  disabled && "opacity-40 cursor-not-allowed hover:bg-transparent hover:text-muted-foreground"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
          {isSuperAdmin && (
            <button
              onClick={() => navigate("/super-admin")}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <Settings className="h-4 w-4" />
              Super Admin
            </button>
          )}
        </nav>

        <div className="mt-auto space-y-2 pt-4 border-t">
          <p className="text-xs text-muted-foreground truncate px-2">{profile?.name}</p>
          <div className="flex flex-wrap gap-1 px-2">
            {currentSub?.plan_name && (
              <Badge className="bg-primary/15 text-primary border border-primary/30 text-[10px] px-2 py-0">
                {currentSub.plan_name}
              </Badge>
            )}
            {isDealerAdmin && (
              <Badge variant="outline" className="text-[10px] px-2 py-0 border-amber-500/40 text-amber-500">
                Tenant Owner
              </Badge>
            )}
          </div>
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={signOut}>
            <LogOut className="mr-2 h-4 w-4" /> Sign Out
          </Button>
        </div>
      </aside>

      {/* Mobile header */}
      <div className="flex flex-1 flex-col">
        <header className="flex md:hidden items-center justify-between border-b bg-card px-4 py-3">
          <h2 className="text-lg font-bold text-foreground">ERP</h2>
          <div className="flex items-center gap-2">
            {isGrace && <Badge variant="outline" className="text-yellow-600 border-yellow-400 text-xs"><Clock className="mr-1 h-3 w-3" />Grace</Badge>}
            {isReadonly && <Badge variant="destructive" className="text-xs">Read-Only</Badge>}
            <Button variant="ghost" size="sm" onClick={signOut}><LogOut className="h-4 w-4" /></Button>
          </div>
        </header>

        {/* Mobile nav */}
        <nav className="flex md:hidden overflow-x-auto border-b bg-card px-2 py-1 gap-1">
          {navItems.map((item) => {
            const disabled = isReadonly && !item.readonlyAllowed;
            const active = location.pathname === item.path;
            return (
              <button
                key={item.path}
                onClick={() => !disabled && navigate(item.path)}
                disabled={disabled}
                className={cn(
                  "flex items-center gap-1 whitespace-nowrap rounded-md px-3 py-1.5 text-xs transition-colors",
                  active ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                  disabled && "opacity-40 cursor-not-allowed"
                )}
              >
                <item.icon className="h-3 w-3" />
                {item.label}
              </button>
            );
          })}
        </nav>

        <AppHeader />
        <SAImpersonationBanner />
        <DemoBanner />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
};

export default AppLayout;
