import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Crown, RefreshCw, Zap, Rocket, Gem } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/utils";
import {
  fetchAvailablePlans,
  fetchDealerSubscriptionPayments,
  type PlanOption,
} from "@/services/dealerSubscriptionService";
import UpgradeRequestDialog from "@/components/subscription/UpgradeRequestDialog";
import { PaymentMethodsCard } from "@/components/subscription/PaymentMethodsCard";

function planIcon(idx: number) {
  const icons = [Zap, Crown, Rocket, Gem];
  const Icon = icons[idx % icons.length];
  return <Icon className="h-6 w-6 text-primary" />;
}

interface Props {
  compact?: boolean;
}

const SubscriptionRenewalPanel = ({ compact = false }: Props) => {
  const [selectedPlan, setSelectedPlan] = useState<PlanOption | null>(null);

  const plansQuery = useQuery({
    queryKey: ["dealer-subscription-plans"],
    queryFn: fetchAvailablePlans,
  });
  const paymentsQuery = useQuery({
    queryKey: ["dealer-subscription-payments"],
    queryFn: fetchDealerSubscriptionPayments,
  });

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

  const pendingPayment = (paymentsQuery.data ?? []).find((p) => p.payment_status === "pending");

  const refetchAll = () => {
    plansQuery.refetch();
    paymentsQuery.refetch();
  };

  return (
    <div className={compact ? "space-y-4" : "space-y-6"}>
      {pendingPayment && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="pt-6">
            <p className="text-sm font-medium text-foreground">Payment pending confirmation</p>
            <p className="text-sm text-muted-foreground mt-1">
              Your renewal request for{" "}
              <span className="font-medium">{pendingPayment.requested_plan_name ?? "subscription"}</span>{" "}
              ({formatCurrency(Number(pendingPayment.amount))}) is awaiting Super Admin approval.
              You will be notified by SMS and email once your account is activated.
            </p>
          </CardContent>
        </Card>
      )}

      <PaymentMethodsCard />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">Choose a plan to renew</CardTitle>
          <Button variant="outline" size="sm" onClick={refetchAll} className="gap-2">
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {plansQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading plans…</p>
          ) : plans.length === 0 ? (
            <p className="text-sm text-muted-foreground">No plans available. Contact support.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {plans.map((plan, idx) => (
                <div
                  key={plan.id}
                  className="rounded-xl border border-border p-4 flex flex-col gap-3"
                >
                  <div className="flex items-center gap-2">
                    {planIcon(idx)}
                    <span className="font-semibold">{plan.name}</span>
                  </div>
                  <div className="text-sm text-muted-foreground space-y-1">
                    <div>Monthly: {formatCurrency(Number(plan.price_monthly))}</div>
                    <div>Yearly: {formatCurrency(Number(plan.price_yearly))}</div>
                  </div>
                  <Button
                    className="mt-auto"
                    disabled={!!pendingPayment}
                    onClick={() => setSelectedPlan(plan)}
                  >
                    Pay &amp; Renew
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {!compact && (paymentsQuery.data ?? []).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Payment history</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(paymentsQuery.data ?? []).slice(0, 5).map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="text-xs">
                        {p.payment_date ? format(parseISO(String(p.payment_date).slice(0, 10)), "dd MMM yyyy") : "—"}
                      </TableCell>
                      <TableCell>{p.requested_plan_name ?? "—"}</TableCell>
                      <TableCell>{formatCurrency(Number(p.amount))}</TableCell>
                      <TableCell>
                        <Badge variant={p.payment_status === "paid" ? "default" : "secondary"}>
                          {p.payment_status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <UpgradeRequestDialog
        plan={selectedPlan}
        onClose={() => setSelectedPlan(null)}
        onSubmitted={() => {
          setSelectedPlan(null);
          refetchAll();
        }}
      />
    </div>
  );
};

export default SubscriptionRenewalPanel;
