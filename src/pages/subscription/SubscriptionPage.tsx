import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { differenceInDays, format, parseISO } from "date-fns";
import { Crown, RefreshCw, Sparkles, Zap, Gem, Rocket, Check, Phone, AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { formatCurrency } from "@/lib/utils";
import {
  fetchAvailablePlans,
  fetchCurrentSubscription,
  fetchDealerSubscriptionPayments,
  type PlanOption,
} from "@/services/dealerSubscriptionService";
import UpgradeRequestDialog from "@/components/subscription/UpgradeRequestDialog";
import { PaymentMethodsCard } from "@/components/subscription/PaymentMethodsCard";
import PaymentRequestDialog from "@/components/subscription/PaymentRequestDialog";
import PaymentRequestHistory from "@/components/subscription/PaymentRequestHistory";

const SUPPORT_PHONE = "01674533303";

function planIcon(idx: number) {
  const icons = [Zap, Crown, Rocket, Gem];
  const Icon = icons[idx % icons.length];
  return <Icon className="h-7 w-7 text-primary" />;
}

function getStatusInfo(status: string, endDate: string | null) {
  if (status === "suspended") {
    return { label: "Suspended", className: "bg-red-600 text-white border-0" };
  }
  if (!endDate) {
    return { label: status, className: "" };
  }
  const days = differenceInDays(parseISO(endDate), new Date());
  if (status === "active" && days > 7) {
    return { label: "Active", className: "bg-green-600 text-white border-0" };
  }
  if (status === "active" && days >= 0) {
    return { label: "Expiring Soon", className: "bg-yellow-500 text-white border-0" };
  }
  if (days >= -3) {
    return { label: "Grace Period", className: "bg-orange-500 text-white border-0" };
  }
  return { label: "Expired", className: "bg-red-600 text-white border-0" };
}

function planRibbon(plan: PlanOption, sortedPlans: PlanOption[], isCurrent: boolean) {
  if (isCurrent) {
    return { text: "Current", className: "bg-primary text-primary-foreground" };
  }
  // Most popular = the middle-tier paid plan with sort_order 3 if present, else 2nd
  const paid = sortedPlans.filter((p) => Number(p.price_monthly) > 0);
  const popular = paid[1] ?? paid[0];
  if (popular && popular.id === plan.id) {
    return { text: "Most Popular", className: "bg-blue-600 text-white" };
  }
  const best = paid[paid.length - 1];
  if (best && best.id === plan.id && paid.length > 2) {
    return { text: "Best Value", className: "bg-green-600 text-white" };
  }
  return null;
}

const SubscriptionPage = () => {
  const { isDemo } = useAuth();
  const [selectedPlan, setSelectedPlan] = useState<PlanOption | null>(null);
  const [showPaymentRequest, setShowPaymentRequest] = useState(false);

  const subQuery = useQuery({
    queryKey: ["dealer-subscription-current"],
    queryFn: fetchCurrentSubscription,
  });
  const plansQuery = useQuery({
    queryKey: ["dealer-subscription-plans"],
    queryFn: fetchAvailablePlans,
  });
  const paymentsQuery = useQuery({
    queryKey: ["dealer-subscription-payments"],
    queryFn: fetchDealerSubscriptionPayments,
  });

  const sub = subQuery.data;
  const plans = useMemo(
    () => (plansQuery.data ?? [])
      .slice()
      .filter((p) => {
        const name = (p.name ?? "").toLowerCase().trim();
        if (p.is_trial) return false;
        if (name === "basic" || name === "free trial") return false;
        return true;
      })
      .sort((a, b) =>
        (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
        Number(a.price_monthly) - Number(b.price_monthly),
      ),
    [plansQuery.data],
  );

  const refetchAll = () => {
    subQuery.refetch();
    plansQuery.refetch();
    paymentsQuery.refetch();
  };

  const status = sub
    ? getStatusInfo(sub.status, sub.end_date)
    : { label: "No Plan", className: "" };

  const daysRemaining = sub?.end_date
    ? differenceInDays(parseISO(sub.end_date), new Date())
    : null;

  return (
    <div className="container max-w-7xl mx-auto p-4 md:p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Subscription
          </h1>
          <p className="text-sm text-muted-foreground">
            Choose a plan and manage your subscription
          </p>
        </div>
        <Button variant="outline" onClick={refetchAll} className="gap-2">
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      {daysRemaining === 2 && sub && (
        <Card className="border-yellow-500/50 bg-yellow-500/10">
          <CardContent className="pt-6 flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex items-start gap-3 flex-1">
              <AlertTriangle className="h-6 w-6 text-yellow-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-foreground">২ দিন বাকি / 2 days left on your trial</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Complete at least one purchase → sale → collection before your trial ends.
                  Choose a plan below or call{" "}
                  <span className="font-mono font-semibold text-foreground">{SUPPORT_PHONE}</span> for help.
                </p>
              </div>
            </div>
            <Button variant="outline" className="shrink-0 gap-2" onClick={() => plans[0] && setSelectedPlan(plans[0])}>
              View Plans
            </Button>
          </CardContent>
        </Card>
      )}

      {daysRemaining === 0 && sub && (
        <Card className="border-orange-500/50 bg-orange-500/10">
          <CardContent className="pt-6 flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex items-start gap-3 flex-1">
              <AlertTriangle className="h-6 w-6 text-orange-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-foreground">আজ আপনার trial শেষ / Your trial ends today</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Renew now to keep full access. Pay via bKash/Nagad{" "}
                  <span className="font-mono font-semibold text-foreground">{SUPPORT_PHONE}</span>{" "}
                  and send your Transaction ID below.
                </p>
              </div>
            </div>
            <Button className="shrink-0 gap-2" onClick={() => plans[0] && setSelectedPlan(plans[0])}>
              <Phone className="h-4 w-4" /> Renew Now
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Current Plan */}
      <Card>
        <CardHeader>
          <CardTitle>Current Plan</CardTitle>
        </CardHeader>
        <CardContent>
          {subQuery.isLoading ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : sub ? (
            <div className="flex flex-wrap items-center gap-4">
              <Badge className="bg-primary text-primary-foreground border-0 text-base px-4 py-1.5">
                {sub.plan_name ?? "Plan"}
              </Badge>
              <Badge className={status.className}>{status.label}</Badge>
              {sub.end_date && (
                <span className="text-sm text-muted-foreground">
                  Expires: {format(parseISO(sub.end_date), "M/d/yyyy")}
                  {daysRemaining !== null && daysRemaining >= 0 && (
                    <span className="ml-2 text-foreground font-medium">
                      ({daysRemaining}d left)
                    </span>
                  )}
                </span>
              )}
              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                {sub.billing_cycle}
              </span>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">No active subscription.</p>
          )}
        </CardContent>
      </Card>

      {/* Plan grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {plansQuery.isLoading && (
          <p className="text-muted-foreground text-sm col-span-full">Loading plans…</p>
        )}
        {plansQuery.isError && (
          <p className="text-red-600 text-sm col-span-full">
            Failed to load plans: {(plansQuery.error as Error)?.message || "Unknown error"}
          </p>
        )}
        {!plansQuery.isLoading && !plansQuery.isError && plans.length === 0 && (
          <p className="text-muted-foreground text-sm col-span-full">
            No plans available. Please contact support.
          </p>
        )}
        {plans.map((plan, idx) => {
          const isCurrent = sub?.plan_id === plan.id;
          const ribbon = planRibbon(plan, plans, isCurrent);
          const isCustomTop = plan.name.toLowerCase().includes("custom") ||
            plan.name.toLowerCase().includes("enterprise");
          const featureList: string[] = Array.isArray(plan.features)
            ? plan.features
            : (() => { try { return JSON.parse(plan.features as any) ?? []; } catch { return []; } })();
          const visibleFeatures = featureList.slice(0, 4);
          const moreCount = featureList.length - visibleFeatures.length;

          return (
            <Card
              key={plan.id}
              className={`relative flex flex-col ${
                isCurrent ? "border-primary border-2 shadow-lg shadow-primary/10" : ""
              }`}
            >
              {ribbon && (
                <div
                  className={`absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-semibold ${ribbon.className}`}
                >
                  {ribbon.text}
                </div>
              )}
              <CardHeader className="text-center pb-2">
                <div className="mx-auto mb-2">{planIcon(idx)}</div>
                <CardTitle className="text-lg">{plan.name}</CardTitle>
                <div className="mt-2">
                  {isCustomTop ? (
                    <span className="text-2xl font-bold">Custom</span>
                  ) : (
                    <span className="text-3xl font-bold">
                      {formatCurrency(Number(plan.price_monthly))}
                      <span className="text-sm font-normal text-muted-foreground">
                        /মাস
                      </span>
                    </span>
                  )}
                </div>
              </CardHeader>
              <CardContent className="flex flex-col flex-1 gap-3">
                <ul className="space-y-1.5 text-sm">
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                    <span>Up to {plan.max_users} user{plan.max_users === 1 ? "" : "s"}</span>
                  </li>
                  {plan.email_enabled && (
                    <li className="flex items-start gap-2">
                      <Check className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                      <span>Email notifications</span>
                    </li>
                  )}
                  {plan.sms_enabled && (
                    <li className="flex items-start gap-2">
                      <Check className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                      <span>SMS notifications</span>
                    </li>
                  )}
                  {plan.daily_summary_enabled && (
                    <li className="flex items-start gap-2">
                      <Check className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                      <span>Daily summary reports</span>
                    </li>
                  )}
                  {visibleFeatures.map((f, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <Check className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                      <span>{f}</span>
                    </li>
                  ))}
                  {moreCount > 0 && (
                    <li className="text-xs text-muted-foreground pt-1">+{moreCount} more</li>
                  )}
                </ul>

                <div className="mt-auto pt-3">
                  {isCurrent ? (
                    <Button disabled variant="outline" className="w-full">
                      Current Plan
                    </Button>
                  ) : isCustomTop ? (
                    <Button
                      variant="outline"
                      className="w-full gap-2"
                      onClick={() => window.open(`tel:${SUPPORT_PHONE}`)}
                    >
                      <Phone className="h-4 w-4" /> Contact Sales
                    </Button>
                  ) : (
                    <Button
                      className="w-full gap-2"
                      disabled={isDemo}
                      onClick={() => setSelectedPlan(plan)}
                      title={isDemo ? "Demo account" : undefined}
                    >
                      <Sparkles className="h-4 w-4" /> Select {plan.name}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Payment Requests */}
      <Card>
        <CardHeader>
          <CardTitle>Payment Requests</CardTitle>
        </CardHeader>
        <CardContent>
          {paymentsQuery.isLoading ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : (paymentsQuery.data ?? []).length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No payment activity yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Note</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(paymentsQuery.data ?? []).map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="whitespace-nowrap">
                        {format(parseISO(p.payment_date), "M/d/yyyy")}
                      </TableCell>
                      <TableCell>
                        {p.source === "dealer_request"
                          ? `Upgrade → ${p.requested_plan_name ?? "?"} (${p.requested_billing_cycle ?? "monthly"})`
                          : "Payment"}
                      </TableCell>
                      <TableCell>{formatCurrency(Number(p.amount))}</TableCell>
                      <TableCell className="capitalize">{p.payment_method.replace("_", " ")}</TableCell>
                      <TableCell>
                        <Badge
                          className={
                            p.payment_status === "paid"
                              ? "bg-green-600 text-white border-0"
                              : p.payment_status === "pending"
                              ? "bg-yellow-500 text-white border-0"
                              : "bg-orange-500 text-white border-0"
                          }
                        >
                          {p.payment_status}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-muted-foreground">
                        {p.note ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <PaymentMethodsCard />

      {/* Dealer Payment Request Section */}
      <PaymentRequestHistory onOpenDialog={() => setShowPaymentRequest(true)} />

      <PaymentRequestDialog open={showPaymentRequest} onClose={() => setShowPaymentRequest(false)} />

      <UpgradeRequestDialog
        plan={selectedPlan}
        onClose={() => setSelectedPlan(null)}
        onSubmitted={() => {
          setSelectedPlan(null);
          paymentsQuery.refetch();
        }}
      />
    </div>
  );
};

export default SubscriptionPage;
