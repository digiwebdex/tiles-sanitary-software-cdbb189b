import { useEffect, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { purchaseService } from "@/services/purchaseService";
import { bankAccountService } from "@/services/bankAccountService";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, CreditCard, Wallet } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { LinkedShortagesPanel } from "@/components/LinkedShortagesPanel";
import { useDealerId } from "@/hooks/useDealerId";
import { toast } from "sonner";

const TEMP_SHOW_OFFER = true;

const ViewPurchasePage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const dealerId = useDealerId();

  const [payOpen, setPayOpen] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payNote, setPayNote] = useState("");
  const [paidAccountId, setPaidAccountId] = useState<string | null>(null);

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

  useEffect(() => {
    if (searchParams.get("pay") === "1") {
      setPayOpen(true);
    }
  }, [searchParams]);

  const paymentMutation = useMutation({
    mutationFn: async () => {
      const amount = Number(payAmount);
      if (!(amount > 0)) throw new Error("Enter a valid payment amount");
      return purchaseService.recordPayment(id!, {
        amount,
        note: payNote.trim() || undefined,
        paid_account_id: paidAccountId,
      });
    },
    onSuccess: () => {
      toast.success("Supplier payment recorded");
      queryClient.invalidateQueries({ queryKey: ["purchase", id] });
      queryClient.invalidateQueries({ queryKey: ["purchases"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-ledger"] });
      queryClient.invalidateQueries({ queryKey: ["cashbook"] });
      setPayOpen(false);
      setPayAmount("");
      setPayNote("");
      setPaidAccountId(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <p className="p-6 text-muted-foreground">Loading…</p>;
  if (!purchase) return <p className="p-6 text-destructive">Purchase not found</p>;

  const items = (purchase as any).purchase_items ?? [];
  const netPayable = Number(purchase.net_payable ?? purchase.total_amount) || 0;
  const paidAmount = Number(purchase.paid_amount) || 0;
  const dueAmount = Number(purchase.due_amount ?? netPayable - paidAmount);
  const paymentHistory = (purchase as any).payment_history ?? [];
  const status = purchase.payment_status ?? (dueAmount <= 0.01 ? "paid" : paidAmount > 0 ? "partial" : "pending");

  return (
    <div className="container mx-auto max-w-7xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate("/purchases")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-2xl font-bold text-foreground">Purchase Details</h1>
        </div>
        {dueAmount > 0.01 && (
          <Button onClick={() => setPayOpen(true)} className="bg-emerald-600 hover:bg-emerald-700">
            <CreditCard className="mr-2 h-4 w-4" /> Record Payment
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Purchase Info</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
          <div>
            <span className="text-muted-foreground">Invoice #</span>
            <p className="font-medium">{purchase.invoice_number || "—"}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Date</span>
            <p className="font-medium">{purchase.purchase_date}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Supplier</span>
            <p className="font-medium">{(purchase as any).suppliers?.name ?? "—"}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Payment Status</span>
            <p>
              <Badge
                variant="secondary"
                className={
                  status === "paid"
                    ? "bg-green-100 text-green-700"
                    : status === "partial"
                      ? "bg-blue-100 text-blue-700"
                      : "bg-orange-100 text-orange-700"
                }
              >
                {status === "paid" ? "Paid" : status === "partial" ? "Partially Paid" : "Pending"}
              </Badge>
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">Net Payable</span>
            <p className="font-medium">{formatCurrency(netPayable)}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Paid</span>
            <p className="font-medium">{formatCurrency(paidAmount)}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Balance Due</span>
            <p className="font-semibold text-destructive">{formatCurrency(dueAmount)}</p>
          </div>
        </CardContent>
      </Card>

      {paymentHistory.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Payment History</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paymentHistory.map((row: any) => (
                  <TableRow key={row.id}>
                    <TableCell>{row.entry_date}</TableCell>
                    <TableCell>{row.description || "—"}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(row.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>Qty</TableHead>
              <TableHead>Rate</TableHead>
              {TEMP_SHOW_OFFER && <TableHead>Offer</TableHead>}
              <TableHead>Transport</TableHead>
              <TableHead>Labor</TableHead>
              <TableHead>Other</TableHead>
              <TableHead>SFT</TableHead>
              <TableHead className="text-right">Landed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item: any) => (
              <TableRow key={item.id}>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-medium">{item.products?.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{item.products?.sku}</span>
                  </div>
                </TableCell>
                <TableCell>
                  {item.quantity}
                  <Badge variant="secondary" className="ml-1 text-xs">
                    {item.products?.unit_type === "box_sft" ? "box" : "pc"}
                  </Badge>
                </TableCell>
                <TableCell>{formatCurrency(item.purchase_rate)}</TableCell>
                {TEMP_SHOW_OFFER && <TableCell>{formatCurrency(item.offer_price)}</TableCell>}
                <TableCell>{formatCurrency(item.transport_cost)}</TableCell>
                <TableCell>{formatCurrency(item.labor_cost)}</TableCell>
                <TableCell>{formatCurrency(item.other_cost)}</TableCell>
                <TableCell>{item.total_sft ? Number(item.total_sft).toFixed(2) : "—"}</TableCell>
                <TableCell className="text-right font-semibold">{formatCurrency(item.landed_cost)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {dealerId && id && <LinkedShortagesPanel dealerId={dealerId} purchaseId={id} />}

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-emerald-600" />
              Pay Supplier
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-lg border bg-muted/50 p-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Supplier</span>
                <span className="font-medium">{(purchase as any).suppliers?.name ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Purchase</span>
                <span className="font-medium">{purchase.invoice_number || "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Net Payable</span>
                <span>{formatCurrency(netPayable)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Already Paid</span>
                <span>{formatCurrency(paidAmount)}</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span className="text-destructive">Balance Due</span>
                <span className="text-destructive">{formatCurrency(dueAmount)}</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pay-amount">Amount (৳)</Label>
              <Input
                id="pay-amount"
                type="number"
                min={0.01}
                max={dueAmount}
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                placeholder={`Max ${formatCurrency(dueAmount)}`}
              />
              <div className="flex flex-wrap gap-2">
                {[dueAmount, Math.round(dueAmount / 2)].filter((v, i, a) => v > 0 && a.indexOf(v) === i).map((amt) => (
                  <Button key={amt} type="button" variant="outline" size="sm" onClick={() => setPayAmount(String(amt))}>
                    {formatCurrency(amt)}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-1">
                <Wallet className="h-3 w-3" /> Pay From
              </Label>
              <Select
                value={paidAccountId ?? "__cash__"}
                onValueChange={(v) => setPaidAccountId(v === "__cash__" ? null : v)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__cash__">Cash in Hand</SelectItem>
                  {bankAccounts.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.bank_name} — {b.account_number}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pay-note">Note (optional)</Label>
              <Textarea
                id="pay-note"
                rows={2}
                value={payNote}
                onChange={(e) => setPayNote(e.target.value)}
                placeholder="Cheque no, reference, etc."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>Cancel</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={paymentMutation.isPending || !payAmount || Number(payAmount) <= 0}
              onClick={() => paymentMutation.mutate()}
            >
              {paymentMutation.isPending ? "Processing…" : "Confirm Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ViewPurchasePage;
