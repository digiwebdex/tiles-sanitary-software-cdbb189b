import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ShieldOff, Clock, RefreshCw } from "lucide-react";
import { format, parseISO } from "date-fns";
import SubscriptionRenewalPanel from "@/components/subscription/SubscriptionRenewalPanel";

const SubscriptionBlockedPage = () => {
  const { accessLevel, subscription, profile, signOut, loading, user } = useAuth();

  if (!loading && !user) {
    return <Navigate to="/login" replace />;
  }

  const isGrace = accessLevel === "grace";
  const isBlocked = accessLevel === "blocked";
  const isExpiredRenewal =
    isBlocked && subscription && subscription.end_date;

  const endDateFormatted = subscription?.end_date
    ? format(parseISO(subscription.end_date), "dd MMM yyyy")
    : null;

  let graceRemaining = 0;
  let graceEnd: Date | null = null;
  if (isGrace && subscription?.end_date) {
    graceEnd = new Date(subscription.end_date);
    graceEnd.setDate(graceEnd.getDate() + 3);
    graceRemaining = Math.max(0, Math.ceil((graceEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
  }

  const config = isExpiredRenewal
    ? {
        icon: ShieldOff,
        iconColor: "text-destructive",
        bgColor: "bg-destructive/10",
        borderColor: "border-destructive/30",
        strip: "bg-destructive",
        title: "Subscription Expired",
        subtitle: `Expired on ${endDateFormatted ?? "—"}.`,
        description:
          "Your trial or subscription has ended. Pay below to renew your account. Full ERP access will be restored after Super Admin confirms your payment.",
        badge: { label: "Renewal Required", className: "border-destructive/50 bg-destructive/10 text-destructive" },
      }
    : isGrace
    ? {
        icon: Clock,
        iconColor: "text-yellow-600 dark:text-yellow-400",
        bgColor: "bg-yellow-500/10",
        borderColor: "border-yellow-400/30",
        strip: "bg-yellow-400",
        title: "Grace Period — Renew Now",
        subtitle: `Expired on ${endDateFormatted ?? "—"}.`,
        description:
          "You still have limited-time access. Renew now to avoid losing ERP access when the grace period ends.",
        badge: {
          label: `${graceRemaining} day${graceRemaining !== 1 ? "s" : ""} remaining`,
          className: "border-yellow-500 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400",
        },
      }
    : {
        icon: AlertTriangle,
        iconColor: "text-destructive",
        bgColor: "bg-destructive/10",
        borderColor: "border-destructive/30",
        strip: "bg-destructive",
        title: "Subscription Required",
        subtitle: "No active subscription found.",
        description:
          "Your account does not have an active subscription. Choose a plan and submit payment to activate your account.",
        badge: null,
      };

  const Icon = config.icon;

  return (
    <div className="min-h-screen bg-muted/30 py-8 px-4">
      <div className="w-full max-w-3xl mx-auto space-y-6">
        <div className={`rounded-2xl border ${config.borderColor} bg-card shadow-lg overflow-hidden`}>
          <div className={`h-1.5 w-full ${config.strip}`} />

          <div className="p-6 md:p-8 text-center space-y-4">
            <div className={`mx-auto w-16 h-16 rounded-full ${config.bgColor} flex items-center justify-center`}>
              <Icon className={`h-8 w-8 ${config.iconColor}`} />
            </div>

            <div className="space-y-1">
              <h1 className="text-xl font-bold text-foreground">{config.title}</h1>
              <p className="text-sm text-muted-foreground">{config.subtitle}</p>
            </div>

            {config.badge && (
              <Badge variant="outline" className={`text-xs px-3 py-1 ${config.badge.className}`}>
                {isGrace && <Clock className="mr-1 h-3 w-3" />}
                {config.badge.label}
              </Badge>
            )}

            <p className="text-sm text-muted-foreground leading-relaxed max-w-xl mx-auto">
              {config.description}
            </p>

            {subscription && (
              <div className="rounded-lg bg-muted/50 border border-border p-4 text-left space-y-2 text-sm max-w-md mx-auto">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Account
                </p>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Email</span>
                  <span className="font-medium text-foreground truncate max-w-[200px]">
                    {profile?.email ?? "—"}
                  </span>
                </div>
                {endDateFormatted && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">End Date</span>
                    <span className="font-medium text-foreground">{endDateFormatted}</span>
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-wrap justify-center gap-2 pt-2">
              {isGrace && (
                <Button variant="outline" onClick={() => window.location.replace("/dashboard")}>
                  Continue to Dashboard
                </Button>
              )}
              <Button variant="outline" onClick={() => window.location.reload()}>
                <RefreshCw className="mr-2 h-4 w-4" /> Refresh Status
              </Button>
              <Button variant="ghost" className="text-muted-foreground" onClick={signOut}>
                Sign Out
              </Button>
            </div>
          </div>
        </div>

        <SubscriptionRenewalPanel compact />
      </div>
    </div>
  );
};

export default SubscriptionBlockedPage;
