import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LogOut, Clock } from "lucide-react";
import { useDealerId } from "@/hooks/useDealerId";
import { PendingApprovalsBadge } from "@/components/approval/PendingApprovalsBadge";
import SAImpersonationBanner from "@/components/SAImpersonationBanner";
import { DemoBanner } from "@/components/DemoBanner";
import { AnnouncementBanner } from "@/components/AnnouncementBanner";
import { AppHeader } from "@/components/AppHeader";
import { SidebarNav } from "@/components/SidebarNav";
import { useQuery } from "@tanstack/react-query";
import { fetchCurrentSubscription } from "@/services/dealerSubscriptionService";
import { usePermissions } from "@/hooks/usePermissions";

const AppLayout = ({ children }: { children: React.ReactNode }) => {
  const { profile, accessLevel, isSuperAdmin, isSaEmployee, isDealerAdmin, menuMode, planFeatures, signOut } = useAuth();
  const { isManager, isAccountant, isSalesman } = usePermissions();
  const { data: currentSub } = useQuery({
    queryKey: ["current-subscription-badge"],
    queryFn: fetchCurrentSubscription,
    enabled: !isSuperAdmin,
    staleTime: 5 * 60 * 1000,
  });
  const navigate = useNavigate();
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

        <SidebarNav
          isReadonly={isReadonly}
          isDealerAdmin={isDealerAdmin}
          isSuperAdmin={isSuperAdmin}
          isSaEmployee={isSaEmployee}
          isManager={isManager}
          isAccountant={isAccountant}
          isSalesman={isSalesman}
          menuMode={menuMode}
          planFeatures={planFeatures}
        />

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
        <SidebarNav
          className="md:hidden border-b bg-card px-2 py-1"
          compact
          isReadonly={isReadonly}
          isDealerAdmin={isDealerAdmin}
          isSuperAdmin={isSuperAdmin}
          isSaEmployee={isSaEmployee}
          isManager={isManager}
          isAccountant={isAccountant}
          isSalesman={isSalesman}
          menuMode={menuMode}
          planFeatures={planFeatures}
        />

        <AppHeader />
        <SAImpersonationBanner />
        <DemoBanner />
        <AnnouncementBanner />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
};

export default AppLayout;
