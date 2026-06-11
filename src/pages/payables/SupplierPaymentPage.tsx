import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { payablesService } from "@/services/payablesService";
import { bankAccountService } from "@/services/bankAccountService";
import { useDealerId } from "@/hooks/useDealerId";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/utils";
import { ArrowLeft, CreditCard, Wallet } from "lucide-react";
import { toast } from "sonner";

/**
 * Phase 7 — dedicated supplier payment form (FIFO allocation, not generic ledger).
 */
const SupplierPaymentPage = () => {
  const dealerId = useDealerId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();

  const [supplierId, setSupplierId] = useState(searchParams.get("supplier_id") ?? "");
  const [purchaseId, setPurchaseId] = useState(searchParams.get("purchase_id") ?? "");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [paidAccountId, setPaidAccountId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["payables-outstanding", dealerId],
    queryFn: () => payablesService.listOutstanding(dealerId),
    enabled: !!dealerId,
  });

  const rows = data?.rows ?? [];
  const summary = data?.summary;

  const { data: bankAccounts = [] } = useQuery({
    queryKey: ["bank-accounts", dealerId],
    queryFn: () => bankAccountService.list(dealerId),
    enabled: !!dealerId,
  });

  const suppliers = useMemo(() => {
    const fromSummary = (summary?.suppliers ?? []).map((s) => ({
      id: s.supplierId,
      name: s.name,
      totalDue: s.outstanding,
    }));
    if (fromSummary.length > 0) {
      return fromSummary.sort((a, b) => a.name.localeCompare(b.name));
    }
    const map = new Map<string, { id: string; name: string; totalDue: number }>();
    for (const row of rows) {
      if (!row.supplier_id) continue;
      const cur = map.get(row.supplier_id) ?? {
        id: row.supplier_id,
        name: row.suppliers?.name ?? "—",
        totalDue: 0,
      };
      cur.totalDue += Number(row.due_amount) || 0;
      map.set(row.supplier_id, cur);
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, summary]);

  const supplierBills = useMemo(
    () => rows.filter((r) => r.supplier_id === supplierId),
    [rows, supplierId],
  );

  const selectedSupplier = suppliers.find((s) => s.id === supplierId);
  const selectedBill = supplierBills.find((b) => b.id === purchaseId);
  const maxPay = selectedBill
    ? Number(selectedBill.due_amount)
    : selectedSupplier?.totalDue ?? 0;

  const paymentMutation = useMutation({
    mutationFn: async () => {
      const amt = Number(amount);
      if (!(amt > 0)) throw new Error("Enter a valid payment amount");
      return payablesService.recordPayment(dealerId, {
        supplier_id: supplierId,
        amount: amt,
        note: note.trim() || undefined,
        paid_account_id: paidAccountId,
        purchase_id: purchaseId || undefined,
      });
    },
    onSuccess: (result) => {
      toast.success(
        `Payment recorded — ৳${result.totalApplied.toLocaleString()} applied across ${result.allocations.length} bill(s)`,
      );
      queryClient.invalidateQueries({ queryKey: ["payables-outstanding"] });
      queryClient.invalidateQueries({ queryKey: ["purchases"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-ledger"] });
      queryClient.invalidateQueries({ queryKey: ["onboarding-counts"] });
      navigate("/payables");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="container mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate("/payables")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-2xl font-bold">Pay Supplier</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-emerald-600" />
            Supplier payment (FIFO bill allocation)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <p className="text-muted-foreground">Loading outstanding bills…</p>
          ) : suppliers.length === 0 ? (
            <p className="text-muted-foreground">No supplier bills with balance due.</p>
          ) : (
            <>
              <div className="space-y-2">
                <Label>Supplier *</Label>
                <Select
                  value={supplierId}
                  onValueChange={(v) => {
                    setSupplierId(v);
                    setPurchaseId("");
                    setAmount("");
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                  <SelectContent>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name} — due {formatCurrency(s.totalDue)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {supplierId && (
                <div className="space-y-2">
                  <Label>Apply to bill (optional — leave blank for FIFO across oldest bills)</Label>
                  <Select
                    value={purchaseId || "__fifo__"}
                    onValueChange={(v) => {
                      const pid = v === "__fifo__" ? "" : v;
                      setPurchaseId(pid);
                      const bill = supplierBills.find((b) => b.id === pid);
                      if (bill) setAmount(String(Number(bill.due_amount)));
                    }}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__fifo__">FIFO — oldest bills first</SelectItem>
                      {supplierBills.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.invoice_number ?? b.id.slice(0, 8)} — due {formatCurrency(b.due_amount)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {supplierId && supplierBills.length > 0 && (
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Bill</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead className="text-right">Due</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {supplierBills.map((b) => (
                        <TableRow key={b.id}>
                          <TableCell className="font-mono text-sm">{b.invoice_number ?? "—"}</TableCell>
                          <TableCell>{b.purchase_date}</TableCell>
                          <TableCell className="text-right font-semibold">{formatCurrency(b.due_amount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Amount (৳) *</Label>
                  <Input
                    type="number"
                    min={0.01}
                    max={maxPay}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder={maxPay > 0 ? `Max ${formatCurrency(maxPay)}` : "0"}
                  />
                  {maxPay > 0 && (
                    <Button type="button" variant="link" className="h-auto p-0 text-xs" onClick={() => setAmount(String(maxPay))}>
                      Pay full balance ({formatCurrency(maxPay)})
                    </Button>
                  )}
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-1"><Wallet className="h-3 w-3" /> Pay from</Label>
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
              </div>

              <div className="space-y-2">
                <Label>Note (optional)</Label>
                <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Cheque no, reference…" />
              </div>

              <Button
                className="w-full bg-emerald-600 hover:bg-emerald-700"
                disabled={!supplierId || !amount || Number(amount) <= 0 || paymentMutation.isPending}
                onClick={() => paymentMutation.mutate()}
              >
                {paymentMutation.isPending ? "Processing…" : "Confirm Supplier Payment"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default SupplierPaymentPage;
