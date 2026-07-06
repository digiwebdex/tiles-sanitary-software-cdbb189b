import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Wallet } from "lucide-react";
import { collectionsService } from "@/services/collectionsService";
import { bankAccountService } from "@/services/bankAccountService";
import { PaymentModeSelect } from "@/components/PaymentModeSelect";
import { paymentModeRequiresBankAccount } from "@/lib/paymentModes";

/**
 * V2 Sprint 4C — "Advance Payment": record a payment with no invoice
 * attached yet (recordCustomerPayment rejects that case — see
 * advancePaymentService.ts on the backend). Reuses the same payment-mode /
 * bank-account picker pattern as the normal Collect Payment dialog.
 */
const AdvancePaymentDialog = ({
  dealerId,
  customer,
  open,
  onOpenChange,
}: {
  dealerId: string;
  customer: { id: string; name: string } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const qc = useQueryClient();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [paymentMode, setPaymentMode] = useState("cash");
  const [paidAccountId, setPaidAccountId] = useState<string | null>(null);

  const { data: bankAccounts = [] } = useQuery({
    queryKey: ["bank-accounts", dealerId],
    queryFn: () => bankAccountService.list(dealerId),
    enabled: !!dealerId && open,
  });

  const mutation = useMutation({
    mutationFn: () =>
      collectionsService.recordAdvance(dealerId, {
        customer_id: customer!.id,
        amount: Number(amount),
        note,
        payment_mode: paymentMode,
        paid_account_id: paidAccountId,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["collections-outstanding"] });
      qc.invalidateQueries({ queryKey: ["customer-outstanding"] });
      qc.invalidateQueries({ queryKey: ["advance-balance", customer?.id] });
      toast.success("Advance payment recorded");
      onOpenChange(false);
      setAmount(""); setNote(""); setPaymentMode("cash"); setPaidAccountId(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Record Advance — {customer?.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            For payment received before (or beyond) any invoice — e.g. a deposit. Apply it to a specific invoice later from that invoice's page.
          </p>
          <div>
            <Label>Amount (৳)</Label>
            <Input type="number" min={0.01} step="0.01" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <PaymentModeSelect value={paymentMode} onChange={(v) => { setPaymentMode(v); if (v === "cash") setPaidAccountId(null); }} label="Payment Mode" />
          {paymentMode !== "cash" && (
            <div className="space-y-2">
              <Label className="flex items-center gap-1">
                <Wallet className="h-3 w-3" />{" "}
                {paymentModeRequiresBankAccount(paymentMode) ? "Received Into (required)" : "Settlement Account (optional)"}
              </Label>
              <Select value={paidAccountId ?? "__cash__"} onValueChange={(v) => setPaidAccountId(v === "__cash__" ? null : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {!paymentModeRequiresBankAccount(paymentMode) && <SelectItem value="__cash__">MFS / Cash Wallet</SelectItem>}
                  {bankAccounts.map((b: any) => (
                    <SelectItem key={b.id} value={b.id}>{b.bank_name} — {b.account_number}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label>Note (optional)</Label>
            <Textarea rows={2} placeholder="e.g. Deposit for upcoming order" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!amount || Number(amount) <= 0 || (paymentModeRequiresBankAccount(paymentMode) && !paidAccountId) || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Saving…" : "Record Advance"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AdvancePaymentDialog;
