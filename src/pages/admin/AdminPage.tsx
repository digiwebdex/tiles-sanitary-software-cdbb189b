import { useAuth } from "@/contexts/AuthContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Shield, Store, CreditCard, CalendarPlus, Users, UserCog } from "lucide-react";
import DealerManagement from "./DealerManagement";
import PlanManagement from "./PlanManagement";
import SubscriptionManagement from "./SubscriptionManagement";
import DealerUsersOverview from "./DealerUsersOverview";
import SaEmployeeManagement from "./SaEmployeeManagement";

const AdminPage = () => {
  const { isSuperAdmin, isSaEmployee, saPermissions } = useAuth();

  if (!isSuperAdmin && !isSaEmployee) {
    return (
      <div className="container mx-auto max-w-4xl p-6">
        <p className="text-destructive">Access denied. Super admin only.</p>
      </div>
    );
  }

  // Determine which tabs are visible based on role / permissions
  const canDealers       = isSuperAdmin || !!saPermissions?.can_manage_dealers;
  const canPlans         = isSuperAdmin;
  const canSubscriptions = isSuperAdmin || !!saPermissions?.can_manage_subscriptions;
  const canUsers         = isSuperAdmin || !!saPermissions?.can_view_dealer_users;
  const canEmployees     = isSuperAdmin; // Only full SA can manage employee accounts

  const visibleTabCount = [canDealers, canPlans, canSubscriptions, canUsers, canEmployees].filter(Boolean).length;

  const defaultTab = canDealers ? "dealers"
    : canSubscriptions ? "subscriptions"
    : canUsers ? "users"
    : "employees";

  return (
    <div className="container mx-auto max-w-6xl p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Shield className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {isSuperAdmin ? "Super Admin Panel" : "Admin Panel"}
          </h1>
          {isSaEmployee && saPermissions?.designation && (
            <p className="text-sm text-muted-foreground">{saPermissions.designation}</p>
          )}
        </div>
      </div>

      <Tabs defaultValue={defaultTab} className="w-full">
        <TabsList className={`grid w-full grid-cols-${visibleTabCount}`}>
          {canDealers && (
            <TabsTrigger value="dealers" className="flex items-center gap-1.5 text-xs sm:text-sm">
              <Store className="h-4 w-4" />
              <span className="hidden sm:inline">Dealers</span>
            </TabsTrigger>
          )}
          {canPlans && (
            <TabsTrigger value="plans" className="flex items-center gap-1.5 text-xs sm:text-sm">
              <CreditCard className="h-4 w-4" />
              <span className="hidden sm:inline">Plans</span>
            </TabsTrigger>
          )}
          {canSubscriptions && (
            <TabsTrigger value="subscriptions" className="flex items-center gap-1.5 text-xs sm:text-sm">
              <CalendarPlus className="h-4 w-4" />
              <span className="hidden sm:inline">Subscriptions</span>
            </TabsTrigger>
          )}
          {canUsers && (
            <TabsTrigger value="users" className="flex items-center gap-1.5 text-xs sm:text-sm">
              <Users className="h-4 w-4" />
              <span className="hidden sm:inline">Users</span>
            </TabsTrigger>
          )}
          {canEmployees && (
            <TabsTrigger value="employees" className="flex items-center gap-1.5 text-xs sm:text-sm">
              <UserCog className="h-4 w-4" />
              <span className="hidden sm:inline">Employees</span>
            </TabsTrigger>
          )}
        </TabsList>

        {canDealers       && <TabsContent value="dealers"><DealerManagement /></TabsContent>}
        {canPlans         && <TabsContent value="plans"><PlanManagement /></TabsContent>}
        {canSubscriptions && <TabsContent value="subscriptions"><SubscriptionManagement /></TabsContent>}
        {canUsers         && <TabsContent value="users"><DealerUsersOverview /></TabsContent>}
        {canEmployees     && <TabsContent value="employees"><SaEmployeeManagement /></TabsContent>}
      </Tabs>
    </div>
  );
};

export default AdminPage;
