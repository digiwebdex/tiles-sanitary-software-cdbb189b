import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { PAYMENT_MODES, isMobileOrGatewayMode, paymentModeRequiresBankAccount } from "@/lib/paymentModes";
import {
  listPortalSales,
  submitPortalPaymentRequest,
  type PortalSale,
} from "@/services/portalService";
import { usePortalAuth } from "@/contexts/PortalAuthContext";

const fmtBDT = (n: number) =>
  `৳${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultSaleId?: string | null;
  suggestedAmount?: number | null;
}

export default function PortalPaymentRequestDialog({
  open,
  onOpenChange,
  defaultSaleId,
  suggestedAmount,
}: Props) {
  const { context } = usePortalAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const customerId = context?.customer_id ?? "";

  const [amount, setAmount] = useState("");
  const [paymentMode, setPaymentMode] = useState("bkash");
  const [referenceNo, setReferenceNo] = useState("");
  const [saleId, setSaleId] = useState<string>("none");
  const [message, setMessage] = useState("");

  const salesQ = useQuery({
    queryKey: ["portal", "sales", customerId, "payment-pick"],
    queryFn: () => listPortalSales(customerId),
    enabled: open && !!customerId,
  });

  const openInvoices = (salesQ.data ?? []).filter(
    (s: PortalSale) => Number(s.due_amount ?? 0) > 0,
  );

  const submitM = useMutation({
    mutationFn: () =>
      submitPortalPaymentRequest({
        amount: Number(amount),
        payment_mode: paymentMode,
        reference_no: referenceNo.trim() || null,
        sale_id: saleId === "none" ? null : saleId,
        message: message.trim() || null,
      }),
    onSuccess: () => {
      toast({
        title: "Payment notification sent",
        description: "Your dealer will review and apply this to your account.",
      });
      qc.invalidateQueries({ queryKey: ["portal", "payment-requests"] });
      onOpenChange(false);
      resetForm();
    },
    onError: (e) =>
      toast({ variant: "destructive", title: "Could not submit", description: (e as Error).message }),
  });

  const resetForm = () => {
    setAmount("");
    setReferenceNo("");
    setMessage("");
    setSaleId(defaultSaleId ?? "none");
    setPaymentMode("bkash");
  };

  const needsRef =
    isMobileOrGatewayMode(paymentMode) ||
    paymentModeRequiresBankAccount(paymentMode);

  const handleOpenChange = (next: boolean) => {
    if (next) {
      if (suggestedAmount != null && suggestedAmount > 0) {
        setAmount(String(suggestedAmount));
      }
      if (defaultSaleId) setSaleId(defaultSaleId);
    }
    onOpenChange(next);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast({ variant: "destructive", title: "Enter a valid amount" });
      return;
    }
    if (needsRef && !referenceNo.trim()) {
      toast({ variant: "destructive", title: "Transaction reference is required" });
      return;
    }
    submitM.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Notify payment</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Tell your dealer you have paid via bKash, Nagad, or bank transfer. They will verify and
            update your statement.
          </p>

          <div>
            <Label htmlFor="pay-amount">Amount paid</Label>
            <Input
              id="pay-amount"
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>

          <div>
            <Label>Payment method</Label>
            <Select value={paymentMode} onValueChange={setPaymentMode}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_MODES.filter((m) => m.id !== "sslcommerz").map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {needsRef && (
            <div>
              <Label htmlFor="pay-ref">Transaction / reference no.</Label>
              <Input
                id="pay-ref"
                value={referenceNo}
                onChange={(e) => setReferenceNo(e.target.value)}
                placeholder="e.g. bKash TrxID"
                required
              />
            </div>
          )}

          <div>
            <Label>Against invoice (optional)</Label>
            <Select value={saleId} onValueChange={setSaleId}>
              <SelectTrigger>
                <SelectValue placeholder="General payment" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">General / account payment</SelectItem>
                {openInvoices.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.invoice_number} — due {fmtBDT(Number(s.due_amount ?? 0))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="pay-msg">Note (optional)</Label>
            <Textarea
              id="pay-msg"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={2}
              placeholder="Any extra detail for your dealer"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitM.isPending}>
              {submitM.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
