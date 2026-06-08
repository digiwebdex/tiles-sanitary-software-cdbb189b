import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { payablesService, type PayablePurchaseRow } from "@/services/payablesService";
import { bankAccountService } from "@/services/bankAccountService";
import { useDealerId } from "@/hooks/useDealerId";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/utils";
import { CreditCard, Truck, Wallet } from "lucide-react";
import { toast } from "sonner";

type SupplierGroup = {
  supplierId: string;
  supplierName: string;
  totalDue: number;
  bills: PayablePurchaseRow[];
};

const SupplierPayablesPage = () => {
  const dealerId = useDealerId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [payDialog, setPayDialog] = useState<{
    open: boolean;
    supplierId?: string;
    supplierName?: string;
    maxAmount?: number;
  }>({ open: false });
  const [payAmount, setPayAmount] = useState("");
  const [payNote, setPayNote] = useState("");
  const [paidAccountId, setPaidAccountId] = useState<string | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["payables-outstanding", dealerId],
    queryFn: () => payablesService.listOutstanding(dealerId),
    enabled: !!dealerId,
  });

  const { data: bankAccounts = [] } = useQuery({
    queryKey: ["bank-accounts", dealerId],
    queryFn: () => bankAccountService.list(dealerId),
    enabled: !!dealerId,
  });

  const supplierGroups = useMemo(() => {
    const map = new Map<string, SupplierGroup>();
    for (const row of rows) {
      const sid = row.supplier_id;
      if (!sid) continue;
      const existing = map.get(sid) ?? {
        supplierId: sid,
        supplierName: row.suppliers?.name ?? "—",
        totalDue: 0,
        bills: [],
      };
      existing.totalDue += Number(row.due_amount) || 0;
      existing.bills.push(row);
      map.set(sid, existing);
    }
    return Array.from(map.values()).sort((a, b) => b.totalDue - a.totalDue);
  }, [rows]);

  const totalDue = rows.reduce((sum, p) => sum + (Number(p.due_amount) || 0), 0);

  const paymentMutation = useMutation({
    mutationFn: async () => {
      if (!payDialog.supplierId) throw new Error("No supplier selected");
      return payablesService.recordPayment(dealerId, {
        supplier_id: payDialog.supplierId,
        amount: Number(payAmount),
        note: payNote || undefined,
        paid_account_id: paidAccountId,
      });
    },
    onSuccess: (result) => {
      toast.success(
        `Payment recorded — ৳${result.totalApplied.toLocaleString()} applied across ${result.allocations.length} bill(s)`,
      );
      queryClient.invalidateQueries({ queryKey: ["payables-outstanding"] });
      queryClient.invalidateQueries({ queryKey: ["purchases"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setPayDialog({ open: false });
      setPayAmount("");
      setPayNote("");
      setPaidAccountId(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const openPayDialog = (group: SupplierGroup) => {
    setPayDialog({
      open: true,
      supplierId: group.supplierId,
      supplierName: group.supplierName,
      maxAmount: group.totalDue,
    });
    setPayAmount(String(Math.round(group.totalDue * 100) / 100));
    setPayNote("");
    setPaidAccountId(null);
  };

  return (
    <div className="container mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Truck className="h-6 w-6 text-primary" /> Supplier Payables
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Unpaid purchase bills — pay a supplier in one click (oldest bills first) or open a bill to pay partially.
          </p>
        </div>
        <Button onClick={() => navigate("/purchases/new")}>New Purchase</Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Total Outstanding to Suppliers</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold text-destructive">{formatCurrency(totalDue)}</p>
        </CardContent>
      </Card>

      {!isLoading && supplierGroups.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {supplierGroups.map((group) => (
            <Card key={group.supplierId}>
              <CardContent className="flex items-center justify-between gap-4 p-4">
                <div>
                  <p className="font-semibold">{group.supplierName}</p>
                  <p className="text-sm text-muted-foreground">
                    {group.bills.length} unpaid bill{group.bills.length === 1 ? "" : "s"}
                  </p>
                  <p className="text-lg font-bold text-destructive mt-1">
                    {formatCurrency(group.totalDue)}
                  </p>
                </div>
                <Button onClick={() => openPayDialog(group)}>
                  <CreditCard className="mr-1 h-4 w-4" /> Pay Supplier
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            No unpaid purchase bills. All supplier balances are settled.
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">Due</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{p.purchase_date}</TableCell>
                  <TableCell className="font-mono text-sm">{p.invoice_number || "—"}</TableCell>
                  <TableCell>{p.suppliers?.name ?? "—"}</TableCell>
                  <TableCell className="text-right">{formatCurrency(p.net_payable ?? p.total_amount)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(p.paid_amount ?? 0)}</TableCell>
                  <TableCell className="text-right font-semibold text-destructive">{formatCurrency(p.due_amount)}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="bg-orange-100 text-orange-700 text-xs">
                      {p.payment_status === "partial" ? "Partial" : "Pending"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" onClick={() => navigate(`/purchases/${p.id}?pay=1`)}>
                      Bill
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={payDialog.open} onOpenChange={(open) => setPayDialog((d) => ({ ...d, open }))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pay Supplier — {payDialog.supplierName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Payment applies to the <strong>oldest unpaid bills first</strong> (FIFO), like Collections for customers.
            </p>
            <div className="rounded-lg border bg-muted/50 p-3 text-sm flex justify-between">
              <span className="text-muted-foreground">Total outstanding</span>
              <span className="font-bold text-destructive">
                {formatCurrency(payDialog.maxAmount ?? 0)}
              </span>
            </div>
            <div className="space-y-2">
              <Label htmlFor="supplier-pay-amount">Amount (৳)</Label>
              <Input
                id="supplier-pay-amount"
                type="number"
                min={0.01}
                max={payDialog.maxAmount}
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
              />
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
              <Label htmlFor="supplier-pay-note">Note (optional)</Label>
              <Textarea
                id="supplier-pay-note"
                rows={2}
                value={payNote}
                onChange={(e) => setPayNote(e.target.value)}
                placeholder="Cheque no, reference, etc."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayDialog({ open: false })}>Cancel</Button>
            <Button
              disabled={
                paymentMutation.isPending ||
                !payAmount ||
                Number(payAmount) <= 0 ||
                (payDialog.maxAmount != null && Number(payAmount) > payDialog.maxAmount + 0.01)
              }
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

export default SupplierPayablesPage;
