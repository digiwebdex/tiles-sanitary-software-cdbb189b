import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { collectionsService } from "@/services/collectionsService";

/**
 * V2 Sprint 4A — "Collection Adjustment": a manual, signed ledger entry
 * outside the normal FIFO payment flow (e.g. correcting a data-entry error
 * or writing off a small balance). A positive amount increases the
 * customer's due balance; a negative amount decreases it.
 */
const AdjustmentDialog = ({
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
  const [direction, setDirection] = useState<"increase" | "decrease">("decrease");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  const mutation = useMutation({
    mutationFn: () => {
      const signed = direction === "decrease" ? -Math.abs(Number(amount)) : Math.abs(Number(amount));
      return collectionsService.recordAdjustment(dealerId, {
        customer_id: customer!.id,
        amount: signed,
        reason,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["collections-outstanding"] });
      qc.invalidateQueries({ queryKey: ["customer-outstanding"] });
      toast.success("Adjustment recorded");
      onOpenChange(false);
      setAmount(""); setReason(""); setDirection("decrease");
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Adjust Balance — {customer?.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Direction</Label>
            <div className="flex gap-2 mt-1">
              <Button type="button" size="sm" variant={direction === "decrease" ? "default" : "outline"} onClick={() => setDirection("decrease")}>
                Decrease Due (write-off)
              </Button>
              <Button type="button" size="sm" variant={direction === "increase" ? "default" : "outline"} onClick={() => setDirection("increase")}>
                Increase Due (correction)
              </Button>
            </div>
          </div>
          <div>
            <Label>Amount (৳)</Label>
            <Input type="number" min={0.01} step="0.01" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div>
            <Label>Reason <span className="text-destructive">*</span></Label>
            <Textarea rows={2} placeholder="Why is this adjustment needed?" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!amount || Number(amount) <= 0 || !reason.trim() || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Saving…" : "Record Adjustment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AdjustmentDialog;
