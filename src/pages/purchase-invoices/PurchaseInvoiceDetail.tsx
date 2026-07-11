/**
 * Purchase Invoice Detail — V2 Sprint 5D.
 * Reuses `purchaseService.getById()` (the same read path ViewPurchase.tsx
 * uses) since a Purchase Invoice IS a `purchases` row, and reuses
 * `purchaseService.recordPayment()` for payment once posted. Finalize/Cancel/
 * Delete are the invoice-specific write actions this sprint adds — the
 * frozen ViewPurchase.tsx has no draft concept, so those actions live here.
 */
import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useDealerId } from "@/hooks/useDealerId";
import { purchaseService } from "@/services/purchaseService";
import { purchaseInvoiceService } from "@/services/purchaseInvoiceService";
import { bankAccountService } from "@/services/bankAccountService";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Check, Ban, Trash2, CreditCard, Wallet } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-muted text-muted-foreground" },
  pending_approval: { label: "Pending Approval", className: "bg-orange-100 text-orange-700" },
  posted: { label: "Posted", className: "bg-green-100 text-green-700" },
  reversed: { label: "Reversed", className: "bg-red-100 text-red-700" },
  cancelled: { label: "Cancelled", className: "bg-red-100 text-red-700" },
};

const PurchaseInvoiceDetail = () => {
  const { id } = useParams<{ id: string }>();
  const dealerId = useDealerId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [payOpen, setPayOpen] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [paidAccountId, setPaidAccountId] = useState<string | null>(null);
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [finalizePaidNow, setFinalizePaidNow] = useState("0");

  const { data: purchase, isLoading } = useQuery({
    queryKey: ["purchase", id],
    queryFn: () => purchaseService.getById(id!),
    enabled: !!id,
  });

  const { data: bankAccounts = [] } = useQuery({
    queryKey: ["bank-accounts", dealerId],
    queryFn: () => bankAccountService.list(dealerId),
    enabled: !!dealerId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["purchase", id] });
    queryClient.invalidateQueries({ queryKey: ["purchase-invoices"] });
    queryClient.invalidateQueries({ queryKey: ["purchases"] });
    queryClient.invalidateQueries({ queryKey: ["supplier-ledger"] });
    queryClient.invalidateQueries({ queryKey: ["supplier-aging"] });
  };

  const finalizeMutation = useMutation({
    mutationFn: () => purchaseInvoiceService.finalize(id!, dealerId, {
      paid_on_create: Number(finalizePaidNow) || 0,
      paid_account_id: paidAccountId,
    }),
    onSuccess: () => { invalidate(); toast.success("Invoice finalized — VAT and supplier ledger posted."); setFinalizeOpen(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelMutation = useMutation({
    mutationFn: () => purchaseInvoiceService.cancel(id!, dealerId),
    onSuccess: () => { invalidate(); toast.success("Draft invoice cancelled"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => purchaseInvoiceService.remove(id!, dealerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-invoices"] });
      toast.success("Draft invoice deleted");
      navigate("/purchase-invoices");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const paymentMutation = useMutation({
    mutationFn: async () => {
      const amount = Number(payAmount);
      if (!(amount > 0)) throw new Error("Enter a valid payment amount");
      return purchaseService.recordPayment(id!, { amount, paid_account_id: paidAccountId });
    },
    onSuccess: () => {
      toast.success("Supplier payment recorded");
      invalidate();
      setPayOpen(false);
      setPayAmount("");
      setPaidAccountId(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (!purchase) {
    navigate("/purchase-invoices");
    return null;
  }

  const docStatus = (purchase as any).document_status ?? "posted";
  const badge = STATUS_BADGE[docStatus] ?? STATUS_BADGE.posted;
  const items = (purchase as any).purchase_items ?? [];
  const netPayable = Number(purchase.net_payable ?? purchase.total_amount) || 0;
  const paidAmount = Number((purchase as any).paid_amount) || 0;
  const dueAmount = Number((purchase as any).due_amount ?? netPayable - paidAmount);
  const isDraft = docStatus === "draft";
  const isPosted = docStatus === "posted";

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate("/purchase-invoices")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-2xl font-bold text-foreground">
            {purchase.invoice_number ?? "Draft Purchase Invoice"}
          </h1>
          <Badge variant="secondary" className={badge.className}>{badge.label}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          {isDraft && (
            <>
              <Button onClick={() => setFinalizeOpen(true)}>
                <Check className="mr-2 h-4 w-4" /> Finalize Invoice
              </Button>
              <Button variant="outline" onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending}>
                <Ban className="mr-2 h-4 w-4" /> Cancel
              </Button>
              <Button
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => { if (confirm("Delete this draft invoice?")) deleteMutation.mutate(); }}
                disabled={deleteMutation.isPending}
              >
                <Trash2 className="mr-2 h-4 w-4" /> Delete
              </Button>
            </>
          )}
          {isPosted && dueAmount > 0.01 && (
            <Button onClick={() => setPayOpen(true)} className="bg-emerald-600 hover:bg-emerald-700">
              <CreditCard className="mr-2 h-4 w-4" /> Record Payment
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Invoice Info</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
          <div><span className="text-muted-foreground">Invoice #</span><p className="font-medium">{purchase.invoice_number || "—"}</p></div>
          <div><span className="text-muted-foreground">Date</span><p className="font-medium">{purchase.purchase_date}</p></div>
          <div><span className="text-muted-foreground">Supplier</span><p className="font-medium">{(purchase as any).suppliers?.name ?? "—"}</p></div>
          <div><span className="text-muted-foreground">Total Amount</span><p className="font-medium">{formatCurrency(netPayable)}</p></div>
          {isPosted && (
            <>
              <div><span className="text-muted-foreground">Taxable Amount</span><p className="font-medium">{formatCurrency(Number((purchase as any).taxable_amount) || 0)}</p></div>
              <div><span className="text-muted-foreground">VAT</span><p className="font-medium">{formatCurrency(Number((purchase as any).vat_amount) || 0)} ({Number((purchase as any).vat_rate) || 0}%)</p></div>
              <div><span className="text-muted-foreground">SD</span><p className="font-medium">{formatCurrency(Number((purchase as any).sd_amount) || 0)}</p></div>
              <div><span className="text-muted-foreground">Paid</span><p className="font-medium">{formatCurrency(paidAmount)}</p></div>
              <div><span className="text-muted-foreground">Balance Due</span><p className="font-semibold text-destructive">{formatCurrency(dueAmount)}</p></div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Rate</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item: any) => (
              <TableRow key={item.id}>
                <TableCell>{item.products?.name ?? item.product_id}</TableCell>
                <TableCell className="text-right">{item.quantity}</TableCell>
                <TableCell className="text-right">{formatCurrency(item.purchase_rate)}</TableCell>
                <TableCell className="text-right font-medium">{formatCurrency(item.total ?? item.landed_cost)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {isDraft && (
        <p className="text-sm text-muted-foreground">
          This is a draft — no VAT or supplier ledger entry has been posted yet. Finalize to assign an invoice number and post it.
        </p>
      )}

      <Dialog open={finalizeOpen} onOpenChange={setFinalizeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Finalize Purchase Invoice</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2 text-sm">
            <p className="text-muted-foreground">
              This assigns an invoice number, calculates VAT/SD using your dealer VAT settings, and posts a supplier ledger entry. This cannot be undone.
            </p>
            <div className="space-y-2">
              <Label>Pay now (optional)</Label>
              <Input type="number" min={0} step="0.01" value={finalizePaidNow} onChange={(e) => setFinalizePaidNow(e.target.value)} />
            </div>
            {Number(finalizePaidNow) > 0 && (
              <div className="space-y-2">
                <Label className="flex items-center gap-1"><Wallet className="h-3 w-3" /> Pay From</Label>
                <Select value={paidAccountId ?? "__cash__"} onValueChange={(v) => setPaidAccountId(v === "__cash__" ? null : v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__cash__">Cash in Hand</SelectItem>
                    {bankAccounts.map((b) => <SelectItem key={b.id} value={b.id}>{b.bank_name} — {b.account_number}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFinalizeOpen(false)}>Cancel</Button>
            <Button disabled={finalizeMutation.isPending} onClick={() => finalizeMutation.mutate()}>
              {finalizeMutation.isPending ? "Finalizing…" : "Confirm Finalize"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><CreditCard className="h-5 w-5 text-emerald-600" /> Pay Supplier</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-lg border bg-muted/50 p-3 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Balance Due</span><span className="font-semibold text-destructive">{formatCurrency(dueAmount)}</span></div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pay-amount">Amount</Label>
              <Input id="pay-amount" type="number" min={0.01} max={dueAmount} value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder={`Max ${formatCurrency(dueAmount)}`} />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1"><Wallet className="h-3 w-3" /> Pay From</Label>
              <Select value={paidAccountId ?? "__cash__"} onValueChange={(v) => setPaidAccountId(v === "__cash__" ? null : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__cash__">Cash in Hand</SelectItem>
                  {bankAccounts.map((b) => <SelectItem key={b.id} value={b.id}>{b.bank_name} — {b.account_number}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>Cancel</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" disabled={paymentMutation.isPending || !payAmount || Number(payAmount) <= 0} onClick={() => paymentMutation.mutate()}>
              {paymentMutation.isPending ? "Processing…" : "Confirm Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PurchaseInvoiceDetail;
