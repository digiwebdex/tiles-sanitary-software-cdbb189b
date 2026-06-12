import { ReactNode, useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { logAudit } from "@/services/auditService";

interface ProtectedRouteProps {
  children: ReactNode;
  /** @deprecated Legacy prop; expired subscriptions are now blocked, not readonly */
  allowReadonly?: boolean;
}

const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  const { user, loading, accessLevel, profile, isSuperAdmin, roles } = useAuth();
  const location = useLocation();

  /**
   * Derived guard: subscription decision is only trustworthy once:
   *  - loading is complete (profile, roles, subscription all fetched), AND
   *  - the user object is confirmed present
   *
   * This prevents premature redirects to /subscription-blocked that
   * happen when accessLevel is evaluated before auth state is fully ready.
   */
  const authReady = !loading && user !== null;

  // Audit log for non-super-admin restricted access attempts
  useEffect(() => {
    if (
      authReady &&
      !isSuperAdmin &&
      accessLevel === "blocked"
    ) {
      logAudit({
        dealer_id: profile?.dealer_id ?? "",
        user_id: user!.id,
        action: "EXPIRED_SUBSCRIPTION_ACCESS",
        table_name: "route_guard",
        record_id: "",
        new_data: {
          access_level: accessLevel,
          path: location.pathname,
          timestamp: new Date().toISOString(),
        },
      });
    }
  }, [authReady, accessLevel, location.pathname, isSuperAdmin]);

  // 1. Wait until profile, roles, and subscription are all loaded.
  //    Never evaluate access level or redirect until this is done.
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  // 2. Unauthenticated → login
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // 3. Roles not yet populated — hold the gate.
  //    This is a secondary safety net: if roles array is empty for an
  //    authenticated user, we cannot make a correct access decision yet.
  //    (Should not happen in normal flow, but guards against edge cases.)
  if (roles.length === 0 && !isSuperAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">Verifying access…</p>
      </div>
    );
  }

  // 4. super_admin → always full access, never check subscription
  if (isSuperAdmin) {
    return <>{children}</>;
  }

  // 5. dealer_admin / salesman subscription enforcement.
  //    Only redirect after auth is fully ready to avoid false "blocked" state.
  if (authReady && accessLevel === "blocked") {
    return <Navigate to="/subscription-blocked" replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
