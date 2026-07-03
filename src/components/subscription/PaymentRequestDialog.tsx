/**
 * Dealer → Submit Subscription Payment Request
 * Appears on the Subscription page; sends to /api/payment-requests
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { SendHorizonal, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

interface Props {
  open: boolean;
  onClose: () => void;
}

const METHODS = [
  { value: "bkash",  label: "bKash" },
  { value: "nagad",  label: "Nagad" },
  { value: "bank",   label: "Bank Transfer" },
  { value: "ssl",    label: "SSLCommerz / Card" },
  { value: "cash",   label: "Cash" },
];

export default function PaymentRequestDialog({ open, onClose }: Props) {
  const qc = useQueryClient();
  const [amount, setAmount]     = useState("");
  const [method, setMethod]     = useState("bkash");
  const [txnId, setTxnId]       = useState("");
  const [screenshotUrl, setScreenshotUrl] = useState("");
  const [note, setNote]         = useState("");

  const submit = useMutation({
    mutationFn: async () => {
      const res = await vpsAuthedFetch("/api/payment-requests", {
        method: "POST",
        body: JSON.stringify({
          amount:         parseFloat(amount),
          payment_method: method,
          transaction_id: txnId.trim() || null,
          screenshot_url: screenshotUrl.trim() || null,
          note:           note.trim() || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as any)?.error ?? "Submit failed");
      return body;
    },
    onSuccess: () => {
      toast.success("Payment request submitted! Super Admin will review it shortly.");
      qc.invalidateQueries({ queryKey: ["my-payment-requests"] });
      setAmount(""); setMethod("bkash"); setTxnId(""); setScreenshotUrl(""); setNote("");
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Submit Payment Request</DialogTitle>
          <DialogDescription>
            Notify the Super Admin that you've made a subscription payment.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Amount (৳) *</Label>
            <Input
              type="number"
              placeholder="2000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min="1"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Payment Method *</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {METHODS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Transaction ID / Reference</Label>
            <Input
              placeholder="bKash TxnID, bank ref, etc."
              value={txnId}
              onChange={(e) => setTxnId(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Screenshot URL <span className="text-xs text-muted-foreground">(optional)</span></Label>
            <Input
              placeholder="https://..."
              value={screenshotUrl}
              onChange={(e) => setScreenshotUrl(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Upload your payment screenshot to Google Drive / Dropbox and paste the link.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Note <span className="text-xs text-muted-foreground">(optional)</span></Label>
            <Textarea
              placeholder="e.g. Paid for June renewal, Pro plan…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submit.isPending}>Cancel</Button>
          <Button
            onClick={() => submit.mutate()}
            disabled={!amount || parseFloat(amount) <= 0 || submit.isPending}
          >
            {submit.isPending
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Submitting…</>
              : <><SendHorizonal className="h-4 w-4 mr-2" /> Submit Request</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
