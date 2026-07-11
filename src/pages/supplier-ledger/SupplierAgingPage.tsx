/**
 * Supplier Accounts Payable Aging — V2 Sprint 5D.
 * Mirrors the existing customer-side Due Aging report's summary-card +
 * bucket-table layout (ReportsPageContent.tsx's DueAgingReport), backed by
 * the new /api/supplier-aging endpoint. Also hosts the Credit Note / Debit
 * Note / Advance Payment actions, since Accounts Payable is their natural
 * home and neither the frozen Payables page nor Supplier profile page
 * exposes them.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useDealerId } from "@/hooks/useDealerId";
import { supplierAgingService, type SupplierAgingRow } from "@/services/supplierAgingService";
import { supplierLedgerEntryService } from "@/services/supplierLedgerEntryService";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/utils";
import { PlusCircle, MinusCircle, Wallet } from "lucide-react";

type DialogMode = "advance" | "credit_note" | "debit_note" | null;

const SupplierAgingPage = () => {
  const dealerId = useDealerId();
  const queryClient = useQueryClient();
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [activeSupplier, setActiveSupplier] = useState<{ id: string; name: string } | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["supplier-aging", dealerId],
    queryFn: () => supplierAgingService.get(dealerId),
    enabled: !!dealerId,
  });

  const closeDialog = () => { setDialogMode(null); setActiveSupplier(null); setAmount(""); setReason(""); };
  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["supplier-aging"] });
    queryClient.invalidateQueries({ queryKey: ["supplier-ledger-summary"] });
    queryClient.invalidateQueries({ queryKey: ["purchase-invoices"] });
    queryClient.invalidateQueries({ queryKey: ["purchases"] });
  };

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!activeSupplier) throw new Error("No supplier selected");
      const amt = Number(amount);
      if (!(amt > 0)) throw new Error("Enter a valid amount");
      if (dialogMode === "advance") {
        await supplierLedgerEntryService.recordAdvancePayment(dealerId, { supplier_id: activeSupplier.id, amount: amt, note: reason || null });
      } else if (dialogMode === "credit_note") {
        await supplierLedgerEntryService.recordCreditNote(dealerId, { supplier_id: activeSupplier.id, amount: amt, reason });
      } else if (dialogMode === "debit_note") {
        await supplierLedgerEntryService.recordDebitNote(dealerId, { supplier_id: activeSupplier.id, amount: amt, reason });
      }
    },
    onSuccess: () => {
      toast.success(
        dialogMode === "advance" ? "Advance payment recorded" : dialogMode === "credit_note" ? "Credit note recorded" : "Debit note recorded",
      );
      invalidateAll();
      closeDialog();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const summary = data?.summary;
  const suppliers = data?.suppliers ?? [];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-foreground">Accounts Payable — Aging</h1>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {summary && [
          { label: "Total Outstanding", value: summary.total_outstanding },
          { label: "Due Today", value: summary.due_today },
          { label: "Due This Week", value: summary.due_this_week },
          { label: "Due This Month", value: summary.due_this_month },
        ].map((c) => (
          <Card key={c.label}>
            <CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">{c.label}</p>
              <p className="text-lg font-bold">{formatCurrency(c.value)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Supplier</TableHead>
                  <TableHead className="text-right">Current</TableHead>
                  <TableHead className="text-right">1-30 Days</TableHead>
                  <TableHead className="text-right">31-60 Days</TableHead>
                  <TableHead className="text-right">61-90 Days</TableHead>
                  <TableHead className="text-right text-destructive">90+ Days</TableHead>
                  <TableHead className="text-right font-bold">Total Due</TableHead>
                  <TableHead className="w-64">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                ) : suppliers.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No outstanding supplier bills</TableCell></TableRow>
                ) : (
                  suppliers.map((s: SupplierAgingRow) => (
                    <TableRow key={s.supplier_id} className={s.buckets.d90plus > 0 ? "bg-destructive/5" : ""}>
                      <TableCell className="font-medium">{s.supplier_name}</TableCell>
                      <TableCell className="text-right">{s.buckets.current > 0 ? formatCurrency(s.buckets.current) : "—"}</TableCell>
                      <TableCell className="text-right">{s.buckets.d30 > 0 ? formatCurrency(s.buckets.d30) : "—"}</TableCell>
                      <TableCell className="text-right">{s.buckets.d60 > 0 ? formatCurrency(s.buckets.d60) : "—"}</TableCell>
                      <TableCell className="text-right font-medium">{s.buckets.d90 > 0 ? formatCurrency(s.buckets.d90) : "—"}</TableCell>
                      <TableCell className="text-right font-semibold text-destructive">{s.buckets.d90plus > 0 ? formatCurrency(s.buckets.d90plus) : "—"}</TableCell>
                      <TableCell className="text-right font-bold">{formatCurrency(s.buckets.total)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" className="h-8 px-2 text-xs" onClick={() => { setActiveSupplier({ id: s.supplier_id, name: s.supplier_name }); setDialogMode("advance"); }}>
                            <Wallet className="h-3 w-3 mr-1" /> Advance
                          </Button>
                          <Button size="sm" variant="outline" className="h-8 px-2 text-xs" onClick={() => { setActiveSupplier({ id: s.supplier_id, name: s.supplier_name }); setDialogMode("credit_note"); }}>
                            <MinusCircle className="h-3 w-3 mr-1" /> Credit
                          </Button>
                          <Button size="sm" variant="outline" className="h-8 px-2 text-xs" onClick={() => { setActiveSupplier({ id: s.supplier_id, name: s.supplier_name }); setDialogMode("debit_note"); }}>
                            <PlusCircle className="h-3 w-3 mr-1" /> Debit
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
                {summary && suppliers.length > 0 && (
                  <TableRow className="bg-muted/50 font-bold">
                    <TableCell>Totals</TableCell>
                    <TableCell className="text-right">{formatCurrency(summary.buckets.current)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(summary.buckets.d30)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(summary.buckets.d60)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(summary.buckets.d90)}</TableCell>
                    <TableCell className="text-right text-destructive">{formatCurrency(summary.buckets.d90plus)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(summary.buckets.total)}</TableCell>
                    <TableCell />
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogMode !== null} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {dialogMode === "advance" ? "Advance Payment" : dialogMode === "credit_note" ? "Credit Note" : "Debit Note"}
              {activeSupplier ? ` — ${activeSupplier.name}` : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {dialogMode === "advance" && (
              <p className="text-sm text-muted-foreground">
                Records a payment to this supplier ahead of any due bill (does not require an outstanding balance).
              </p>
            )}
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input type="number" min={0.01} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{dialogMode === "advance" ? "Note (optional)" : "Reason"}</Label>
              <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={dialogMode === "advance" ? "Reference, cheque no, etc." : "Why is this being recorded?"} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button
              disabled={submitMutation.isPending || !amount || Number(amount) <= 0 || (dialogMode !== "advance" && !reason.trim())}
              onClick={() => submitMutation.mutate()}
            >
              {submitMutation.isPending ? "Saving…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SupplierAgingPage;
