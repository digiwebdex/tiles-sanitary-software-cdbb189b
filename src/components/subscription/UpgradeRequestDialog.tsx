import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/utils";
import {
  requestPlanUpgrade,
  type PlanOption,
} from "@/services/dealerSubscriptionService";

interface Props {
  plan: PlanOption | null;
  onClose: () => void;
  onSubmitted: () => void;
}

const UpgradeRequestDialog = ({ plan, onClose, onSubmitted }: Props) => {
  const { toast } = useToast();
  const [cycle, setCycle] = useState<"monthly" | "yearly">("monthly");
  const [paymentMethod, setPaymentMethod] = useState<"bank" | "mobile_banking" | "cash">("mobile_banking");
  const [transactionId, setTransactionId] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const open = !!plan;
  const amount =
    plan && cycle === "yearly"
      ? Number(plan.price_yearly)
      : Number(plan?.price_monthly ?? 0);

  const handleSubmit = async () => {
    if (!plan) return;
    setSubmitting(true);
    try {
      await requestPlanUpgrade({
        plan_id: plan.id,
        billing_cycle: cycle,
        payment_method: paymentMethod,
        transaction_id: transactionId.trim() || undefined,
        note,
      });
      toast({
        title: "Payment submitted",
        description: "Super Admin will confirm your payment. You will be notified by SMS and email when your account is active.",
      });
      setNote("");
      setTransactionId("");
      setCycle("monthly");
      setPaymentMethod("mobile_banking");
      onSubmitted();
    } catch (err: any) {
      toast({
        title: "Could not submit request",
        description: err?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Renew — {plan?.name} Plan</DialogTitle>
          <DialogDescription>
            Pay using the methods shown above, then submit your transaction details. Super Admin will confirm and activate your account.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Billing Cycle</Label>
            <Select value={cycle} onValueChange={(v) => setCycle(v as any)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">
                  Monthly — {formatCurrency(Number(plan?.price_monthly ?? 0))}
                </SelectItem>
                <SelectItem value="yearly">
                  Yearly — {formatCurrency(Number(plan?.price_yearly ?? 0))}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-md border bg-muted/40 p-3 text-sm flex items-center justify-between">
            <span className="text-muted-foreground">Amount</span>
            <span className="font-semibold">{formatCurrency(amount)}</span>
          </div>

          <div className="space-y-2">
            <Label>Payment Method</Label>
            <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as typeof paymentMethod)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mobile_banking">Mobile Banking (bKash / Nagad / Rocket)</SelectItem>
                <SelectItem value="bank">Bank Transfer</SelectItem>
                <SelectItem value="cash">Cash</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Transaction ID</Label>
            <Input
              placeholder="e.g. TRX123456789"
              value={transactionId}
              onChange={(e) => setTransactionId(e.target.value.slice(0, 80))}
            />
          </div>

          <div className="space-y-2">
            <Label>Note (optional)</Label>
            <Textarea
              placeholder="Any preferences or questions…"
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 500))}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Submitting…" : "Submit Payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default UpgradeRequestDialog;
