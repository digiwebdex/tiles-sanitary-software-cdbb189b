import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDealerId } from "@/hooks/useDealerId";
import { bankAccountService } from "@/services/bankAccountService";
import { formatCurrency } from "@/lib/utils";
import { ArrowLeft, Plus, ArrowDownCircle, ArrowUpCircle } from "lucide-react";
import { toast } from "sonner";

const BankAccountDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const dealerId = useDealerId();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [entry, setEntry] = useState({ type: "deposit", amount: 0, description: "", entry_date: new Date().toISOString().slice(0, 10) });

  const { data: accounts = [] } = useQuery({
    queryKey: ["bank-accounts", dealerId],
    queryFn: () => bankAccountService.list(dealerId),
    enabled: !!dealerId,
  });
  const account = accounts.find(a => a.id === id);

  const { data: ledger } = useQuery({
    queryKey: ["bank-ledger", id, dealerId],
    queryFn: () => bankAccountService.ledger(id!, dealerId),
    enabled: !!id && !!dealerId,
  });

  const entryMut = useMutation({
    mutationFn: () => bankAccountService.addEntry(id!, dealerId, entry),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bank-ledger", id] });
      qc.invalidateQueries({ queryKey: ["bank-accounts"] });
      setOpen(false);
      setEntry({ type: "deposit", amount: 0, description: "", entry_date: new Date().toISOString().slice(0, 10) });
      toast.success("Entry recorded");
    },
    onError: (e: any) => toast.error(e.message),
  });

  // V2 Sprint 6C — GL-wired Deposit/Withdrawal (see bankAccountService.deposit/withdrawal).
  const [movementDialog, setMovementDialog] = useState<{ open: boolean; kind: "deposit" | "withdrawal" }>({ open: false, kind: "deposit" });
  const [movementForm, setMovementForm] = useState({ amount: "", description: "", entry_date: new Date().toISOString().slice(0, 10), payment_mode: "bank", cheque_no: "" });

  const resetMovementForm = () => {
    setMovementDialog({ open: false, kind: "deposit" });
    setMovementForm({ amount: "", description: "", entry_date: new Date().toISOString().slice(0, 10), payment_mode: "bank", cheque_no: "" });
  };

  const recordMovement = useMutation({
    mutationFn: () => {
      const input = {
        amount: Number(movementForm.amount),
        description: movementForm.description,
        entry_date: movementForm.entry_date,
        payment_mode: movementForm.payment_mode,
        cheque_no: movementForm.payment_mode === "cheque" ? (movementForm.cheque_no.trim() || null) : null,
      };
      return movementDialog.kind === "deposit"
        ? bankAccountService.deposit(id!, dealerId, input)
        : bankAccountService.withdrawal(id!, dealerId, input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bank-ledger", id] });
      qc.invalidateQueries({ queryKey: ["bank-accounts"] });
      toast.success(movementDialog.kind === "deposit" ? "Deposit recorded" : "Withdrawal recorded");
      resetMovementForm();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="container mx-auto p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate("/bank-accounts")}><ArrowLeft className="h-4 w-4" /></Button>
        <h1 className="text-2xl font-bold">{account?.bank_name || "Bank Account"}</h1>
      </div>

      {account && (
        <Card>
          <CardContent className="pt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
            <div><div className="text-xs text-muted-foreground">Account No</div><div className="font-mono">{account.account_number}</div></div>
            <div><div className="text-xs text-muted-foreground">Branch</div><div>{account.branch || "—"}</div></div>
            <div><div className="text-xs text-muted-foreground">Type</div><Badge variant="outline">{account.account_type}</Badge></div>
            <div><div className="text-xs text-muted-foreground">Current Balance</div><div className="text-xl font-bold text-primary">{formatCurrency(account.balance)}</div></div>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end gap-2 flex-wrap">
        <Button variant="outline" onClick={() => setMovementDialog({ open: true, kind: "deposit" })}>
          <ArrowDownCircle className="h-4 w-4 mr-2 text-emerald-500" /> Deposit
        </Button>
        <Button variant="outline" onClick={() => setMovementDialog({ open: true, kind: "withdrawal" })}>
          <ArrowUpCircle className="h-4 w-4 mr-2 text-red-500" /> Withdrawal
        </Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button variant="ghost"><Plus className="h-4 w-4 mr-2" /> Add Entry (legacy)</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Bank Entry</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Type</Label>
                <Select value={entry.type} onValueChange={v => setEntry({ ...entry, type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="deposit">Deposit (in)</SelectItem>
                    <SelectItem value="withdrawal">Withdrawal (out)</SelectItem>
                    <SelectItem value="payment">Payment to supplier (out)</SelectItem>
                    <SelectItem value="expense">Expense (out)</SelectItem>
                    <SelectItem value="transfer">Transfer</SelectItem>
                    <SelectItem value="adjustment">Adjustment</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Amount (positive number)</Label><Input type="number" value={entry.amount} onChange={e => setEntry({ ...entry, amount: Number(e.target.value) })} /></div>
              <div><Label>Date</Label><Input type="date" value={entry.entry_date} onChange={e => setEntry({ ...entry, entry_date: e.target.value })} /></div>
              <div><Label>Description</Label><Input value={entry.description} onChange={e => setEntry({ ...entry, description: e.target.value })} /></div>
              <Button className="w-full" onClick={() => entryMut.mutate()} disabled={entryMut.isPending}>Save</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Dialog open={movementDialog.open} onOpenChange={(o) => { if (!o) resetMovementForm(); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{movementDialog.kind === "deposit" ? "Record Deposit" : "Record Withdrawal"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Amount (৳)</Label><Input type="number" min={1} value={movementForm.amount} onChange={e => setMovementForm({ ...movementForm, amount: e.target.value })} /></div>
            <div><Label>Description</Label><Input value={movementForm.description} onChange={e => setMovementForm({ ...movementForm, description: e.target.value })} /></div>
            <div><Label>Date</Label><Input type="date" value={movementForm.entry_date} onChange={e => setMovementForm({ ...movementForm, entry_date: e.target.value })} /></div>
            <div>
              <Label>Payment Mode</Label>
              <Select value={movementForm.payment_mode} onValueChange={v => setMovementForm({ ...movementForm, payment_mode: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="bank">Bank Transfer</SelectItem>
                  <SelectItem value="cheque">Cheque</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="bkash">bKash</SelectItem>
                  <SelectItem value="nagad">Nagad</SelectItem>
                  <SelectItem value="rocket">Rocket</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {movementForm.payment_mode === "cheque" && (
              <div><Label>Cheque No.</Label><Input value={movementForm.cheque_no} onChange={e => setMovementForm({ ...movementForm, cheque_no: e.target.value })} placeholder="e.g. 0012345" /></div>
            )}
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

      <Card>
        <CardHeader><CardTitle>Transactions</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead>Description</TableHead><TableHead className="text-right">Amount</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {ledger?.rows.map(r => (
                <TableRow key={r.id}>
                  <TableCell>{new Date(r.entry_date).toLocaleDateString()}</TableCell>
                  <TableCell><Badge variant="outline">{r.type}</Badge></TableCell>
                  <TableCell>
                    {r.description || "—"}
                    {r.cheque_no && <span className="ml-2 text-xs text-muted-foreground">Cheque #{r.cheque_no} ({r.cheque_status})</span>}
                    {r.is_cleared && <Badge variant="secondary" className="ml-2 text-xs">Cleared</Badge>}
                  </TableCell>
                  <TableCell className={`text-right font-mono ${Number(r.amount) >= 0 ? "text-emerald-500" : "text-red-500"}`}>{formatCurrency(Math.abs(Number(r.amount)))}</TableCell>
                </TableRow>
              ))}
              {!ledger?.rows?.length && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No transactions</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default BankAccountDetailPage;
