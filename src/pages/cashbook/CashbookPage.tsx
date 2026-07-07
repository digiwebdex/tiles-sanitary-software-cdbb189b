import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useDealerId } from "@/hooks/useDealerId";
import { cashbookService } from "@/services/cashbookService";
import { bankAccountService } from "@/services/bankAccountService";
import { cashTransactionService } from "@/services/cashTransactionService";
import { transferService, type TransferEndpoint } from "@/services/transferService";
import { formatCurrency } from "@/lib/utils";
import { paymentModeLabel } from "@/lib/paymentModes";
import { exportToExcel } from "@/lib/exportUtils";
import { PaymentModeSelect } from "@/components/PaymentModeSelect";
import { toast } from "sonner";
import { Download, BookOpen, ArrowDownCircle, ArrowUpCircle, ArrowLeftRight } from "lucide-react";

const CashbookPage = () => {
  const dealerId = useDealerId();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<{ from?: string; to?: string; account: "cash" | "bank" | "all"; bankAccountId?: string }>({ account: "all" });

  const { data: banks = [] } = useQuery({
    queryKey: ["bank-accounts", dealerId],
    queryFn: () => bankAccountService.list(dealerId),
    enabled: !!dealerId,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["cashbook", dealerId, filters],
    queryFn: () => cashbookService.fetch(dealerId, filters),
    enabled: !!dealerId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["cashbook"] });
    queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
  };

  // ── Record Receipt / Payment (Cash Ledger) ──────────────────────────────
  const [movementDialog, setMovementDialog] = useState<{ open: boolean; kind: "receipt" | "payment" }>({ open: false, kind: "receipt" });
  const [movementForm, setMovementForm] = useState({ amount: "", description: "", entry_date: new Date().toISOString().slice(0, 10), payment_mode: "cash" });

  const resetMovementForm = () => {
    setMovementDialog({ open: false, kind: "receipt" });
    setMovementForm({ amount: "", description: "", entry_date: new Date().toISOString().slice(0, 10), payment_mode: "cash" });
  };

  const recordMovement = useMutation({
    mutationFn: () => {
      const input = {
        amount: Number(movementForm.amount),
        description: movementForm.description,
        entry_date: movementForm.entry_date,
        payment_mode: movementForm.payment_mode,
      };
      return movementDialog.kind === "receipt"
        ? cashTransactionService.recordReceipt(dealerId, input)
        : cashTransactionService.recordPayment(dealerId, input);
    },
    onSuccess: () => {
      toast.success(movementDialog.kind === "receipt" ? "Cash receipt recorded" : "Cash payment recorded");
      resetMovementForm();
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message || "Failed to record transaction"),
  });

  // ── Transfer (Cash<->Bank / Bank<->Bank) ────────────────────────────────
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferForm, setTransferForm] = useState({
    fromKind: "cash" as "cash" | "bank", fromBankAccountId: "",
    toKind: "bank" as "cash" | "bank", toBankAccountId: "",
    amount: "", description: "", entry_date: new Date().toISOString().slice(0, 10),
  });

  const resetTransferForm = () => {
    setTransferOpen(false);
    setTransferForm({ fromKind: "cash", fromBankAccountId: "", toKind: "bank", toBankAccountId: "", amount: "", description: "", entry_date: new Date().toISOString().slice(0, 10) });
  };

  const recordTransfer = useMutation({
    mutationFn: () => {
      const from: TransferEndpoint = transferForm.fromKind === "cash" ? { kind: "cash" } : { kind: "bank", bank_account_id: transferForm.fromBankAccountId };
      const to: TransferEndpoint = transferForm.toKind === "cash" ? { kind: "cash" } : { kind: "bank", bank_account_id: transferForm.toBankAccountId };
      return transferService.create(dealerId, {
        from, to,
        amount: Number(transferForm.amount),
        description: transferForm.description,
        entry_date: transferForm.entry_date,
      });
    },
    onSuccess: () => {
      toast.success("Transfer recorded");
      resetTransferForm();
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message || "Failed to record transfer"),
  });

  const transferValid =
    Number(transferForm.amount) > 0 &&
    transferForm.description.trim().length > 0 &&
    (transferForm.fromKind !== "bank" || !!transferForm.fromBankAccountId) &&
    (transferForm.toKind !== "bank" || !!transferForm.toBankAccountId) &&
    !(transferForm.fromKind === "cash" && transferForm.toKind === "cash") &&
    !(transferForm.fromKind === "bank" && transferForm.toKind === "bank" && transferForm.fromBankAccountId === transferForm.toBankAccountId && !!transferForm.fromBankAccountId);

  const onExport = () => {
    if (!data?.rows) return;
    exportToExcel(
      data.rows.map(r => ({
        Date: r.entry_date, Account: r.account_kind, Type: r.type,
        Channel: r.payment_mode ? paymentModeLabel(r.payment_mode) : "",
        Description: r.description, In: r.amount > 0 ? r.amount : 0, Out: r.amount < 0 ? Math.abs(r.amount) : 0,
        Balance: r.running_balance,
      })),
      [
        { key: "Date", header: "Date" }, { key: "Account", header: "Account" }, { key: "Type", header: "Type" },
        { key: "Channel", header: "Channel" }, { key: "Description", header: "Description" },
        { key: "In", header: "In", format: "currency" }, { key: "Out", header: "Out", format: "currency" },
        { key: "Balance", header: "Balance", format: "currency" },
      ],
      "Cashbook"
    );
  };

  return (
    <div className="container mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold flex items-center gap-2"><BookOpen className="h-6 w-6 text-primary" /> Cashbook</h1>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={() => setMovementDialog({ open: true, kind: "receipt" })}>
            <ArrowDownCircle className="h-4 w-4 mr-2 text-emerald-500" /> Record Receipt
          </Button>
          <Button variant="outline" onClick={() => setMovementDialog({ open: true, kind: "payment" })}>
            <ArrowUpCircle className="h-4 w-4 mr-2 text-red-500" /> Record Payment
          </Button>
          <Button variant="outline" onClick={() => setTransferOpen(true)}>
            <ArrowLeftRight className="h-4 w-4 mr-2" /> Transfer
          </Button>
          <Button variant="outline" onClick={onExport}><Download className="h-4 w-4 mr-2" /> Excel</Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-5 gap-3">
          <div><Label>From</Label><Input type="date" value={filters.from || ""} onChange={e => setFilters({ ...filters, from: e.target.value || undefined })} /></div>
          <div><Label>To</Label><Input type="date" value={filters.to || ""} onChange={e => setFilters({ ...filters, to: e.target.value || undefined })} /></div>
          <div>
            <Label>Account</Label>
            <Select value={filters.account} onValueChange={(v: any) => setFilters({ ...filters, account: v, bankAccountId: undefined })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All (Cash + Bank)</SelectItem>
                <SelectItem value="cash">Cash only</SelectItem>
                <SelectItem value="bank">Bank only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {filters.account === "bank" && (
            <div className="md:col-span-2">
              <Label>Bank Account</Label>
              <Select value={filters.bankAccountId || "all"} onValueChange={v => setFilters({ ...filters, bankAccountId: v === "all" ? undefined : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All banks</SelectItem>
                  {banks.map(b => <SelectItem key={b.id} value={b.id}>{b.bank_name} — {b.account_number}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Opening Balance</div><div className="text-xl font-bold">{formatCurrency(data?.opening || 0)}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Closing Balance</div><div className="text-xl font-bold text-primary">{formatCurrency(data?.closing || 0)}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Total In</div><div className="text-xl font-bold text-emerald-500">{formatCurrency(Object.values(data?.summary || {}).reduce((s, v) => s + v.in, 0))}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Total Out</div><div className="text-xl font-bold text-red-500">{formatCurrency(Object.values(data?.summary || {}).reduce((s, v) => s + v.out, 0))}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Transactions ({data?.rows.length || 0})</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? <p>Loading…</p> : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Date</TableHead><TableHead>Account</TableHead><TableHead>Type</TableHead>
                <TableHead>Channel</TableHead><TableHead>Description</TableHead><TableHead className="text-right">In</TableHead>
                <TableHead className="text-right">Out</TableHead><TableHead className="text-right">Balance</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {data?.rows.map(r => (
                  <TableRow key={r.id}>
                    <TableCell>{new Date(r.entry_date).toLocaleDateString()}</TableCell>
                    <TableCell><Badge variant={r.account_kind === "cash" ? "default" : "secondary"}>{r.account_kind}</Badge></TableCell>
                    <TableCell className="text-xs">{r.type}</TableCell>
                    <TableCell className="text-xs">{r.payment_mode ? paymentModeLabel(r.payment_mode) : "—"}</TableCell>
                    <TableCell>{r.description || "—"}</TableCell>
                    <TableCell className="text-right text-emerald-500 font-mono">{r.amount > 0 ? formatCurrency(r.amount) : ""}</TableCell>
                    <TableCell className="text-right text-red-500 font-mono">{r.amount < 0 ? formatCurrency(Math.abs(r.amount)) : ""}</TableCell>
                    <TableCell className="text-right font-mono font-medium">{formatCurrency(r.running_balance)}</TableCell>
                  </TableRow>
                ))}
                {!data?.rows.length && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">No transactions</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={movementDialog.open} onOpenChange={(o) => { if (!o) resetMovementForm(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{movementDialog.kind === "receipt" ? "Record Cash Receipt" : "Record Cash Payment"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Amount (৳)</Label><Input type="number" min={1} value={movementForm.amount} onChange={e => setMovementForm({ ...movementForm, amount: e.target.value })} /></div>
            <div><Label>Description</Label><Textarea rows={2} value={movementForm.description} onChange={e => setMovementForm({ ...movementForm, description: e.target.value })} /></div>
            <div><Label>Date</Label><Input type="date" value={movementForm.entry_date} onChange={e => setMovementForm({ ...movementForm, entry_date: e.target.value })} /></div>
            <PaymentModeSelect value={movementForm.payment_mode} onChange={(v) => setMovementForm({ ...movementForm, payment_mode: v })} label="Payment Mode" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetMovementForm} disabled={recordMovement.isPending}>Cancel</Button>
            <Button
              onClick={() => recordMovement.mutate()}
              disabled={recordMovement.isPending || !(Number(movementForm.amount) > 0) || !movementForm.description.trim()}
            >
              {recordMovement.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={transferOpen} onOpenChange={(o) => { if (!o) resetTransferForm(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Cash / Bank Transfer</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>From</Label>
                <Select value={transferForm.fromKind} onValueChange={(v: any) => setTransferForm({ ...transferForm, fromKind: v, fromBankAccountId: "" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="bank">Bank Account</SelectItem>
                  </SelectContent>
                </Select>
                {transferForm.fromKind === "bank" && (
                  <Select value={transferForm.fromBankAccountId} onValueChange={(v) => setTransferForm({ ...transferForm, fromBankAccountId: v })}>
                    <SelectTrigger className="mt-2"><SelectValue placeholder="Select account" /></SelectTrigger>
                    <SelectContent>
                      {banks.map(b => <SelectItem key={b.id} value={b.id}>{b.bank_name} — {b.account_number}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div>
                <Label>To</Label>
                <Select value={transferForm.toKind} onValueChange={(v: any) => setTransferForm({ ...transferForm, toKind: v, toBankAccountId: "" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="bank">Bank Account</SelectItem>
                  </SelectContent>
                </Select>
                {transferForm.toKind === "bank" && (
                  <Select value={transferForm.toBankAccountId} onValueChange={(v) => setTransferForm({ ...transferForm, toBankAccountId: v })}>
                    <SelectTrigger className="mt-2"><SelectValue placeholder="Select account" /></SelectTrigger>
                    <SelectContent>
                      {banks.map(b => <SelectItem key={b.id} value={b.id}>{b.bank_name} — {b.account_number}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
            <div><Label>Amount (৳)</Label><Input type="number" min={1} value={transferForm.amount} onChange={e => setTransferForm({ ...transferForm, amount: e.target.value })} /></div>
            <div><Label>Description</Label><Textarea rows={2} value={transferForm.description} onChange={e => setTransferForm({ ...transferForm, description: e.target.value })} /></div>
            <div><Label>Date</Label><Input type="date" value={transferForm.entry_date} onChange={e => setTransferForm({ ...transferForm, entry_date: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetTransferForm} disabled={recordTransfer.isPending}>Cancel</Button>
            <Button onClick={() => recordTransfer.mutate()} disabled={recordTransfer.isPending || !transferValid}>
              {recordTransfer.isPending ? "Saving…" : "Transfer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CashbookPage;
