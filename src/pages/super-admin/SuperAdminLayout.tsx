import { useState, useEffect } from "react";
import { Outlet, useNavigate, useLocation, Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  LayoutDashboard, Store, CreditCard, CalendarPlus, Banknote, Settings,
  LogOut, Menu, X, Shield, Activity, Globe, HardDrive, BookOpen, Receipt,
  BellRing, ChevronLeft, ChevronRight, Users, TrendingUp, Zap,
  Megaphone, ShieldCheck, UserCog,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

// ─── Nav structure ─────────────────────────────────────────────────────────────

const NAV_GROUPS = [
  {
    label: "Overview",
    items: [
      { path: "/super-admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
      { path: "/super-admin/system", label: "System", icon: Activity },
    ],
  },
  {
    label: "Dealers & Finance",
    items: [
      { path: "/super-admin/dealers", label: "Dealers", icon: Store },
      { path: "/super-admin/plans", label: "Plans", icon: CreditCard },
      { path: "/super-admin/subscriptions", label: "Subscriptions", icon: CalendarPlus },
      { path: "/super-admin/subscription-status", label: "Sub. Status", icon: Users },
      { path: "/super-admin/revenue", label: "Revenue", icon: TrendingUp },
      { path: "/super-admin/payments", label: "Payments", icon: Receipt },
      { path: "/super-admin/payment-requests", label: "Pay Requests", icon: Banknote, alertKey: "payRequests" as const },
    ],
  },
  {
    label: "Operations",
    items: [
      { path: "/super-admin/reminders", label: "Reminders", icon: BellRing, alertKey: "reminders" },
      { path: "/super-admin/announcements", label: "Announcements", icon: Megaphone },
      { path: "/super-admin/cms", label: "CMS", icon: Globe },
      { path: "/super-admin/backups", label: "Backups", icon: HardDrive },
      { path: "/super-admin/user-guide", label: "User Guide", icon: BookOpen },
    ],
  },
  {
    label: "Security",
    items: [
      { path: "/super-admin/staff", label: "SA Staff", icon: UserCog },
      { path: "/super-admin/audit", label: "Audit Trail", icon: ShieldCheck },
      { path: "/super-admin/totp-setup", label: "2FA / Authenticator", icon: Shield },
    ],
  },
  {
    label: "Configuration",
    items: [
      { path: "/super-admin/settings", label: "Settings", icon: Settings },
    ],
  },
];

// flat list for header title lookup
const ALL_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

// ─── Component ──────────────────────────────────────────────────────────────────

const SuperAdminLayout = () => {
  const { user, profile, isSuperAdmin, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [clock, setClock] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  // lightweight alert count: expiring soon + grace
  const { data: alertCount = 0 } = useQuery({
    queryKey: ["sa-alert-count"],
    queryFn: async () => {
      const res = await vpsAuthedFetch("/api/admin/dashboard-v2");
      if (!res.ok) return 0;
      const body = await res.json();
      return (Number(body.kpi?.expiring_soon ?? 0) + Number(body.kpi?.grace_period ?? 0));
    },
    refetchInterval: 5 * 60 * 1000,
    enabled: !!user && !!isSuperAdmin,
  });

  const { data: pendingPayRequests = 0 } = useQuery({
    queryKey: ["sa-pay-requests-pending"],
    queryFn: async () => {
      const res = await vpsAuthedFetch("/api/payment-requests/sa/all?status=pending");
      if (!res.ok) return 0;
      const body = await res.json();
      return Number(body.pendingCount ?? 0);
    },
    refetchInterval: 2 * 60 * 1000,
    enabled: !!user && !!isSuperAdmin,
  });

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Shield className="h-8 w-8 text-primary animate-pulse" />
          <p className="text-sm text-muted-foreground">Loading Super Admin…</p>
        </div>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (!isSuperAdmin) return <Navigate to="/dashboard" replace />;

  const initials = (profile?.name ?? "SA")
    .split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);

  const isActive = (path: string, exact?: boolean) => {
    if (exact) return location.pathname === path;
    if (path === "/super-admin") return location.pathname === "/super-admin";
    return location.pathname.startsWith(path);
  };

  const currentLabel = ALL_ITEMS.find((i) => isActive(i.path, i.exact))?.label ?? "Super Admin";

  const navTo = (path: string) => { navigate(path); setMobileOpen(false); };

  const timeStr = clock.toLocaleTimeString("en-BD", { hour: "2-digit", minute: "2-digit" });
  const dateStr = clock.toLocaleDateString("en-BD", { weekday: "short", month: "short", day: "numeric" });

  const SidebarContent = ({ mini }: { mini?: boolean }) => (
    <nav className="flex-1 px-2 py-3 overflow-y-auto space-y-4">
      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          {!mini && (
            <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
              {group.label}
            </p>
          )}
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const active = isActive(item.path, item.exact);
              const hasAlert =
                (item.alertKey === "reminders" && alertCount > 0) ||
                (item.alertKey === "payRequests" && pendingPayRequests > 0);
              const btn = (
                <button
                  key={item.path}
                  onClick={() => navTo(item.path)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150",
                    mini ? "justify-center px-2" : "",
                    active
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  <div className="relative flex-shrink-0">
                    <item.icon className="h-4 w-4" />
                    {hasAlert && (
                      <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-destructive ring-1 ring-background" />
                    )}
                  </div>
                  {!mini && (
                    <>
                      <span className="flex-1 text-left">{item.label}</span>
                      {hasAlert && (
                        <Badge variant="destructive" className="h-4 px-1.5 text-[10px]">
                          {alertCount}
                        </Badge>
                      )}
                    </>
                  )}
                </button>
              );
              if (mini) {
                return (
                  <Tooltip key={item.path} delayDuration={0}>
                    <TooltipTrigger asChild>{btn}</TooltipTrigger>
                    <TooltipContent side="right" className="text-xs">{item.label}</TooltipContent>
                  </Tooltip>
                );
              }
              return btn;
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  return (
    <TooltipProvider>
      <div className="flex min-h-screen bg-muted/20">

        {/* ── Desktop Sidebar ── */}
        <aside
          className={cn(
            "hidden lg:flex flex-col border-r bg-card fixed inset-y-0 left-0 z-30 transition-all duration-200",
            collapsed ? "w-14" : "w-60"
          )}
        >
          {/* Logo */}
          <div className={cn(
            "flex items-center border-b h-14 px-3 gap-2",
            collapsed ? "justify-center" : "px-4"
          )}>
            <Shield className="h-5 w-5 text-primary flex-shrink-0" />
            {!collapsed && (
              <span className="font-bold text-sm tracking-tight text-foreground flex-1">Super Admin</span>
            )}
            <button
              onClick={() => setCollapsed((c) => !c)}
              className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
            >
              {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </button>
          </div>

          <SidebarContent mini={collapsed} />

          {/* Bottom: clock + email */}
          {!collapsed && (
            <div className="px-4 py-3 border-t space-y-0.5">
              <p className="text-xs font-medium text-foreground">{timeStr}</p>
              <p className="text-[10px] text-muted-foreground">{dateStr}</p>
              <p className="text-[10px] text-muted-foreground truncate">{profile?.email}</p>
            </div>
          )}
        </aside>

        {/* ── Mobile overlay ── */}
        {mobileOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
            <aside className="absolute inset-y-0 left-0 w-64 bg-card border-r flex flex-col z-50 animate-in slide-in-from-left duration-200">
              <div className="flex items-center justify-between px-4 h-14 border-b">
                <div className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-primary" />
                  <span className="font-bold text-sm">Super Admin</span>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setMobileOpen(false)}>
                  <X className="h-5 w-5" />
                </Button>
              </div>
              <SidebarContent />
              <div className="px-4 py-3 border-t">
                <p className="text-xs text-muted-foreground truncate">{profile?.email}</p>
              </div>
            </aside>
          </div>
        )}

        {/* ── Main ── */}
        <div className={cn("flex-1 flex flex-col transition-all duration-200", collapsed ? "lg:ml-14" : "lg:ml-60")}>

          {/* Top header */}
          <header className="sticky top-0 z-20 flex items-center justify-between h-14 px-4 lg:px-6 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)}>
                <Menu className="h-5 w-5" />
              </Button>
              <div>
                <h2 className="text-sm font-semibold text-foreground leading-none">{currentLabel}</h2>
                <p className="text-[10px] text-muted-foreground mt-0.5 hidden sm:block">
                  TilesERP Super Admin Console
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Alert bell */}
              {alertCount > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="relative"
                      onClick={() => navigate("/super-admin/subscription-status")}
                    >
                      <BellRing className="h-4 w-4 text-destructive" />
                      <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-destructive" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{alertCount} dealer(s) need attention</TooltipContent>
                </Tooltip>
              )}

              {/* Quick action */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={() => navigate("/super-admin/reminders")}>
                    <Zap className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Send Reminders</TooltipContent>
              </Tooltip>

              {/* User menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="flex items-center gap-2 px-2 h-9">
                    <Avatar className="h-7 w-7">
                      <AvatarFallback className="bg-primary text-primary-foreground text-xs font-bold">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <span className="hidden sm:inline text-sm font-medium">{profile?.name ?? "Admin"}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuLabel>
                    <p className="text-sm font-medium">{profile?.name}</p>
                    <p className="text-xs text-muted-foreground font-normal">{profile?.email}</p>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate("/super-admin/dealers")}>
                    <Store className="mr-2 h-4 w-4" /> Manage Dealers
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate("/super-admin/settings")}>
                    <Settings className="mr-2 h-4 w-4" /> Settings
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate("/super-admin/system")}>
                    <Activity className="mr-2 h-4 w-4" /> System Monitor
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={signOut} className="text-destructive">
                    <LogOut className="mr-2 h-4 w-4" /> Sign Out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>

          {/* Page content */}
          <main className="flex-1 p-4 lg:p-6 overflow-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
};

export default SuperAdminLayout;
