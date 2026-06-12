import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Crown } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { fetchCurrentSubscription } from "@/services/dealerSubscriptionService";
import SubscriptionRenewalPanel from "@/components/subscription/SubscriptionRenewalPanel";

/**
 * Blocking renewal screen shown when trial/subscription has ended.
 * Matches the clean centered-card pattern (trial ended → renew CTA).
 */
const SubscriptionExpiredPage = () => {
  const navigate = useNavigate();
  const { loading, user, signOut } = useAuth();
  const [showRenewal, setShowRenewal] = useState(false);

  const subQuery = useQuery({
    queryKey: ["dealer-subscription-current"],
    queryFn: fetchCurrentSubscription,
    enabled: !!user,
  });

  if (!loading && !user) {
    return <Navigate to="/login" replace />;
  }

  const sub = subQuery.data;
  const planLabel = sub?.plan_name?.trim() || "subscription plan";
  const isTrial = !!sub?.is_trial;
  const trialDays = sub?.is_trial ? Number(sub.trial_days || 3) : null;

  const headline = isTrial ? "Trial Period Ended" : "Subscription Ended";

  const leadLine = isTrial
    ? (
        <>
          Your{" "}
          <span className="font-semibold text-foreground">
            {trialDays ? `${trialDays}-day ` : ""}
            {planLabel}
          </span>{" "}
          has ended. Subscribe to a plan to continue using all features.
        </>
      )
    : (
        <>
          Your{" "}
          <span className="font-semibold text-foreground">{planLabel}</span>{" "}
          has ended. Subscribe to renew and continue using all features.
        </>
      );

  return (
    <div className="min-h-screen bg-white dark:bg-background flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <div className="rounded-2xl border border-red-100 dark:border-red-900/30 bg-white dark:bg-card px-8 py-10 text-center shadow-sm">
          <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-red-50 dark:bg-red-950/40">
            <AlertTriangle className="h-7 w-7 text-red-500" strokeWidth={2} />
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-foreground mb-4">
            {headline}
          </h1>

          <p className="text-sm text-muted-foreground leading-relaxed mb-3">
            {leadLine}
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed mb-8">
            Please renew your subscription to continue using the platform. Your data is
            safe and will be available once you reactivate.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button
              size="lg"
              className="w-full sm:w-auto bg-orange-500 hover:bg-orange-600 text-white border-0 px-8"
              onClick={() => setShowRenewal((v) => !v)}
            >
              <Crown className="mr-2 h-4 w-4" />
              {showRenewal ? "Hide Plans" : "Renew / Upgrade"}
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="w-full sm:w-auto px-8"
              onClick={() => navigate("/")}
            >
              Back to Home
            </Button>
          </div>

          <button
            type="button"
            onClick={signOut}
            className="mt-6 text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
          >
            Sign out
          </button>
        </div>

        {showRenewal && (
          <div className="mt-8">
            <SubscriptionRenewalPanel compact />
          </div>
        )}
      </div>
    </div>
  );
};

export default SubscriptionExpiredPage;
