import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import SubscriptionPage from "@/pages/subscription/SubscriptionPage";
import SubscriptionExpiredPage from "@/pages/subscription/SubscriptionExpiredPage";

/**
 * /subscription — expired dealers see the blocking renewal card (no sidebar).
 * Active dealers see the full subscription management page inside the app layout.
 */
const SubscriptionRoute = () => {
  const { user, loading, accessLevel, isSuperAdmin } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!isSuperAdmin && accessLevel === "blocked") {
    return <SubscriptionExpiredPage />;
  }

  return (
    <AppLayout>
      <SubscriptionPage />
    </AppLayout>
  );
};

export default SubscriptionRoute;
