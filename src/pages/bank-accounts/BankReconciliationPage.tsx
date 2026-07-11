import { useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useDealerId } from "@/hooks/useDealerId";
import { bankAccountService } from "@/services/bankAccountService";
import { bankReconciliationService } from "@/services/bankReconciliationService";
import { formatCurrency, cn } from "@/lib/utils";
import { toast } from "sonner";
import { ArrowLeft, Upload, Plus, Link2, Unlink } from "lucide-react";

const BankReconciliationPage = () => {
  const dealerId = useDealerId();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const bankAccountId = sp.get("bankAccountId") || "";
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedStatementLine, setSelectedStatementLine] = useState<string | null>(null);
  const [selectedLedgerRow, setSelectedLedgerRow] = useState<string | null>(null);
  const [manualDialogOpen, setManualDialogOpen] = useState(false);
  const [manualForm, setManualForm] = useState({ entry_date: new Date().toISOString().slice(0, 10), description: "", amount: "", reference: "" });

  const { data: banks = [] } = useQuery({
    queryKey: ["bank-accounts", dealerId],
    queryFn: () => bankAccountService.list(dealerId),
    enabled: !!dealerId,
  });

  const { data: matching, isLoading } = useQuery({
    queryKey: ["bank-reconciliation", dealerId, bankAccountId],
    queryFn: () => bankReconciliationService.getMatching(dealerId, bankAccountId),
    enabled: !!dealerId && !!bankAccountId,
  });

  const { data: summary } = useQuery({
    queryKey: ["bank-reconciliation-summary", dealerId, bankAccountId],
    queryFn: () => bankReconciliationService.summary(dealerId, bankAccountId),
    enabled: !!dealerId && !!bankAccountId,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["bank-reconciliation"] });
    qc.invalidateQueries({ queryKey: ["bank-reconciliation-summary"] });
    qc.invalidateQueries({ queryKey: ["bank-ledger"] });
  };

  const importCsv = useMutation({
    mutationFn: (csvText: string) => bankReconciliationService.importCsv(dealerId, bankAccountId, csvText),
    onSuccess: (res) => {
      toast.success(`Imported ${res.imported} line(s)${res.skipped ? `, skipped ${res.skipped}` : ""}`);
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message || "Import failed"),
  });

  const addManualLine = useMutation({
    mutationFn: () => bankReconciliationService.addManualLine(dealerId, bankAccountId, {
      entry_date: manualForm.entry_date,
      description: manualForm.description,
      amount: Number(manualForm.amount),
      reference: manualForm.reference || undefined,
    }),
    onSuccess: () => {
      toast.success("Statement line added");
      setManualDialogOpen(false);
      setManualForm({ entry_date: new Date().toISOString().slice(0, 10), description: "", amount: "", reference: "" });
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message || "Failed to add line"),
  });

  const matchMutation = useMutation({
    mutationFn: () => bankReconciliationService.match(dealerId, selectedStatementLine!, selectedLedgerRow!),
    onSuccess: () => {
      toast.success("Matched");
      setSelectedStatementLine(null);
      setSelectedLedgerRow(null);
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message || "Match failed"),
  });

  const unmatchMutation = useMutation({
    mutationFn: (statementLineId: string) => bankReconciliationService.unmatch(dealerId, statementLineId),
    onSuccess: () => { toast.success("Unmatched"); invalidate(); },
    onError: (e: any) => toast.error(e?.message || "Unmatch failed"),
  });

  const onFileSelected = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      if (text.trim()) importCsv.mutate(text);
    };
    reader.readAsText(file);
  };

  if (!bankAccountId) {
    return (
      <div className="container mx-auto p-6 max-w-xl space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate("/bank-accounts")}><ArrowLeft className="h-4 w-4" /></Button>
          <h1 className="text-2xl font-bold">Bank Reconciliation</h1>
        </div>
        <Card>
          <CardHeader><CardTitle>Select a Bank Account</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {banks.map((b) => (
              <button
                key={b.id}
                type="button"
                className="block w-full text-left rounded-md border px-3 py-2 text-sm hover:bg-accent"
                onClick={() => setSp({ bankAccountId: b.id })}
              >
                {b.bank_name} — {b.account_number}
              </button>
            ))}
            {!banks.length && <p className="text-muted-foreground text-sm">No bank accounts yet.</p>}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => setSp({})}><ArrowLeft className="h-4 w-4" /></Button>
          <h1 className="text-2xl font-bold">Bank Reconciliation</h1>
        </div>
        <div className="flex gap-2">
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFileSelected(f); e.target.value = ""; }} />
          <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={importCsv.isPending}>
            <Upload className="h-4 w-4 mr-2" /> {importCsv.isPending ? "Importing…" : "Import CSV"}
          </Button>
          <Button variant="outline" onClick={() => setManualDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" /> Add Statement Line
          </Button>
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Book Balance</div><div className="text-lg font-bold">{formatCurrency(summary.book_balance)}</div></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Cleared Balance</div><div className="text-lg font-bold text-emerald-600">{formatCurrency(summary.cleared_balance)}</div></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Outstanding Deposits</div><div className="text-lg font-bold">{formatCurrency(summary.outstanding_deposits)}</div></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Outstanding Cheques</div><div className="text-lg font-bold">{formatCurrency(summary.outstanding_cheques)}</div></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Difference</div><div className={cn("text-lg font-bold", Math.abs(summary.difference) > 0.01 ? "text-destructive" : "text-emerald-600")}>{formatCurrency(summary.difference)}</div></CardContent></Card>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle>Bank Statement (Unmatched)</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? <p>Loading…</p> : (
              <Table>
                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Description</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(matching?.unmatched_statement_lines ?? []).map((line) => (
                    <TableRow
                      key={line.id}
                      className={cn("cursor-pointer", selectedStatementLine === line.id && "bg-primary/10")}
                      onClick={() => setSelectedStatementLine(line.id === selectedStatementLine ? null : line.id)}
                    >
                      <TableCell>{new Date(line.entry_date).toLocaleDateString()}</TableCell>
                      <TableCell className="max-w-[200px] truncate">{line.description || "—"}{line.reference && <span className="text-xs text-muted-foreground ml-1">({line.reference})</span>}</TableCell>
                      <TableCell className={cn("text-right font-mono", line.amount >= 0 ? "text-emerald-600" : "text-red-600")}>{formatCurrency(line.amount)}</TableCell>
                    </TableRow>
                  ))}
                  {!matching?.unmatched_statement_lines?.length && (
                    <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">No unmatched statement lines</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Book Ledger (Unmatched)</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? <p>Loading…</p> : (
              <Table>
                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Description</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(matching?.unmatched_ledger_rows ?? []).map((row) => (
                    <TableRow
                      key={row.id}
                      className={cn("cursor-pointer", selectedLedgerRow === row.id && "bg-primary/10")}
                      onClick={() => setSelectedLedgerRow(row.id === selectedLedgerRow ? null : row.id)}
                    >
                      <TableCell>{new Date(row.entry_date).toLocaleDateString()}</TableCell>
                      <TableCell className="max-w-[200px] truncate">{row.description || "—"}{row.cheque_no && <span className="text-xs text-muted-foreground ml-1">(Chq #{row.cheque_no})</span>}</TableCell>
                      <TableCell className={cn("text-right font-mono", row.amount >= 0 ? "text-emerald-600" : "text-red-600")}>{formatCurrency(row.amount)}</TableCell>
                    </TableRow>
                  ))}
                  {!matching?.unmatched_ledger_rows?.length && (
                    <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">No unmatched book entries</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-center">
        <Button
          disabled={!selectedStatementLine || !selectedLedgerRow || matchMutation.isPending}
          onClick={() => matchMutation.mutate()}
        >
          <Link2 className="h-4 w-4 mr-2" /> {matchMutation.isPending ? "Matching…" : "Match Selected"}
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle>Cleared Transactions ({matching?.matched?.length ?? 0})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Statement Date</TableHead><TableHead>Description</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="w-10"></TableHead></TableRow></TableHeader>
            <TableBody>
              {(matching?.matched ?? []).map((m: any) => (
                <TableRow key={m.id}>
                  <TableCell>{new Date(m.entry_date).toLocaleDateString()}</TableCell>
                  <TableCell>{m.description || "—"}</TableCell>
                  <TableCell className="text-right font-mono">{formatCurrency(m.amount)}</TableCell>
                  <TableCell>
                    <Button size="icon" variant="ghost" onClick={() => unmatchMutation.mutate(m.id)} title="Unmatch">
                      <Unlink className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!matching?.matched?.length && (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No cleared transactions yet</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={manualDialogOpen} onOpenChange={setManualDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Statement Line</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Date</Label><Input type="date" value={manualForm.entry_date} onChange={e => setManualForm({ ...manualForm, entry_date: e.target.value })} /></div>
            <div><Label>Description</Label><Input value={manualForm.description} onChange={e => setManualForm({ ...manualForm, description: e.target.value })} /></div>
            <div><Label>Amount (positive = credit, negative = debit)</Label><Input type="number" value={manualForm.amount} onChange={e => setManualForm({ ...manualForm, amount: e.target.value })} /></div>
            <div><Label>Reference (optional)</Label><Input value={manualForm.reference} onChange={e => setManualForm({ ...manualForm, reference: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManualDialogOpen(false)} disabled={addManualLine.isPending}>Cancel</Button>
            <Button
              onClick={() => addManualLine.mutate()}
              disabled={addManualLine.isPending || !manualForm.description.trim() || !Number(manualForm.amount)}
            >
              {addManualLine.isPending ? "Saving…" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default BankReconciliationPage;
