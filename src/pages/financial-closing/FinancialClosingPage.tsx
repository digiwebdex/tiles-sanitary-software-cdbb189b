/**
 * Financial Closing — V2 Sprint 6E.
 * Period Closing reuses fiscalYearService.ts's existing close/reopen
 * (Sprint 6A) — this page just surfaces it alongside the new Fiscal Year
 * Closing action (financialClosingService.ts).
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useDealerId } from "@/hooks/useDealerId";
import { fiscalYearService } from "@/services/fiscalYearService";
import { financialClosingService } from "@/services/financialClosingService";
import { toast } from "@/hooks/use-toast";
import { Lock, Unlock, ShieldCheck, AlertTriangle } from "lucide-react";

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const FinancialClosingPage = () => {
  const dealerId = useDealerId();
  const qc = useQueryClient();
  const [fiscalYearId, setFiscalYearId] = useState("");

  const { data: fiscalYears } = useQuery({
    queryKey: ["fiscal-years", dealerId],
    queryFn: () => fiscalYearService.list(dealerId),
    enabled: !!dealerId,
  });

  const selectedFy = (fiscalYears?.rows ?? []).find((fy) => fy.id === fiscalYearId) ?? (fiscalYears?.rows ?? [])[0];
  const effectiveFyId = fiscalYearId || selectedFy?.id || "";

  const { data: periods } = useQuery({
    queryKey: ["fiscal-year-periods", dealerId, effectiveFyId],
    queryFn: () => fiscalYearService.periods(dealerId, effectiveFyId),
    enabled: !!dealerId && !!effectiveFyId,
  });

  const { data: readiness, isLoading: readinessLoading } = useQuery({
    queryKey: ["fiscal-year-readiness", dealerId, effectiveFyId],
    queryFn: () => financialClosingService.readiness(dealerId, effectiveFyId),
    enabled: !!dealerId && !!effectiveFyId,
  });

  const { data: closingJournal } = useQuery({
    queryKey: ["closing-journal", dealerId, effectiveFyId],
    queryFn: () => financialClosingService.closingJournal(dealerId, effectiveFyId),
    enabled: !!dealerId && !!effectiveFyId && readiness?.fiscal_year.status === "closed",
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["fiscal-years"] });
    qc.invalidateQueries({ queryKey: ["fiscal-year-periods"] });
    qc.invalidateQueries({ queryKey: ["fiscal-year-readiness"] });
    qc.invalidateQueries({ queryKey: ["closing-journal"] });
  };

  const closePeriodMutation = useMutation({
    mutationFn: (periodId: string) => fiscalYearService.closePeriod(dealerId, effectiveFyId, periodId),
    onSuccess: () => { toast({ title: "Period closed" }); invalidateAll(); },
    onError: (e: any) => toast({ title: "Failed to close period", description: e?.message, variant: "destructive" }),
  });
  const reopenPeriodMutation = useMutation({
    mutationFn: (periodId: string) => fiscalYearService.reopenPeriod(dealerId, effectiveFyId, periodId, "Reopened from Financial Closing page"),
    onSuccess: () => { toast({ title: "Period reopened" }); invalidateAll(); },
    onError: (e: any) => toast({ title: "Failed to reopen period", description: e?.message, variant: "destructive" }),
  });

  const [confirmOpen, setConfirmOpen] = useState(false);
  const closeFyMutation = useMutation({
    mutationFn: () => financialClosingService.close(dealerId, effectiveFyId),
    onSuccess: (r) => {
      toast({ title: `Fiscal year closed — net ${r.netIncomeClosedToRetainedEarnings >= 0 ? "income" : "loss"} of ${money(Math.abs(r.netIncomeClosedToRetainedEarnings))} posted to Retained Earnings` });
      setConfirmOpen(false);
      invalidateAll();
    },
    onError: (e: any) => toast({ title: "Failed to close fiscal year", description: e?.message, variant: "destructive" }),
  });

  return (
    <div className="container mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-bold flex items-center gap-2"><Lock className="h-6 w-6" /> Financial Closing</h1>

      <Card>
        <CardContent className="pt-6">
          <Select value={effectiveFyId} onValueChange={setFiscalYearId}>
            <SelectTrigger className="max-w-xs"><SelectValue placeholder="Select fiscal year" /></SelectTrigger>
            <SelectContent>
              {(fiscalYears?.rows ?? []).map((fy) => (
                <SelectItem key={fy.id} value={fy.id}>{fy.name} {fy.is_current ? "(current)" : ""}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {readiness && (
        <>
          <div className="flex items-center gap-2">
            <Badge variant={readiness.fiscal_year.status === "closed" ? "secondary" : "default"} className="capitalize">
              {readiness.fiscal_year.status}
            </Badge>
            <span className="text-sm text-muted-foreground">{readiness.fiscal_year.start_date} – {readiness.fiscal_year.end_date}</span>
          </div>

          <Card>
            <CardHeader><CardTitle>Period Closing Status</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Period</TableHead>
                    <TableHead>Start</TableHead>
                    <TableHead>End</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-32"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(periods?.rows ?? []).map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{p.period_no}</TableCell>
                      <TableCell>{p.start_date}</TableCell>
                      <TableCell>{p.end_date}</TableCell>
                      <TableCell><Badge variant={p.status === "closed" ? "secondary" : "default"} className="capitalize">{p.status}</Badge></TableCell>
                      <TableCell>
                        {p.status === "open" ? (
                          <Button size="sm" variant="outline" onClick={() => closePeriodMutation.mutate(p.id)} disabled={closePeriodMutation.isPending}>
                            <Lock className="h-3 w-3 mr-1" /> Close
                          </Button>
                        ) : readiness.fiscal_year.status === "open" ? (
                          <Button size="sm" variant="ghost" onClick={() => reopenPeriodMutation.mutate(p.id)} disabled={reopenPeriodMutation.isPending}>
                            <Unlock className="h-3 w-3 mr-1" /> Reopen
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!(periods?.rows ?? []).length && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No periods defined for this fiscal year.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {readiness.fiscal_year.status === "open" && (
            <Card>
              <CardHeader><CardTitle>Fiscal Year Closing</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {!readiness.ready && (
                  <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Not ready to close</AlertTitle>
                    <AlertDescription>
                      {readiness.open_periods.length > 0 && <p>Period(s) {readiness.open_periods.map(p => p.period_no).join(", ")} are still open — close them first.</p>}
                      {readiness.blocking_earlier_fiscal_year && <p>Fiscal year "{readiness.blocking_earlier_fiscal_year.name}" starts earlier and is still open — close it first.</p>}
                    </AlertDescription>
                  </Alert>
                )}
                {readiness.ready && (
                  <Alert>
                    <ShieldCheck className="h-4 w-4" />
                    <AlertTitle>Ready to close</AlertTitle>
                    <AlertDescription>
                      Every period is closed. Closing will zero every income/expense account's balance into Retained Earnings and lock this fiscal year permanently.
                    </AlertDescription>
                  </Alert>
                )}
                <Button variant="destructive" disabled={!readiness.ready || readinessLoading} onClick={() => setConfirmOpen(true)}>
                  <Lock className="h-4 w-4 mr-2" /> Close Fiscal Year
                </Button>
              </CardContent>
            </Card>
          )}

          {readiness.fiscal_year.status === "closed" && closingJournal?.journal && (
            <Card>
              <CardHeader><CardTitle>Closing Journal — {closingJournal.journal.voucher_no}</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account</TableHead>
                      <TableHead className="text-right">Debit</TableHead>
                      <TableHead className="text-right">Credit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {closingJournal.lines.map((l, i) => (
                      <TableRow key={i}>
                        <TableCell>{l.account}</TableCell>
                        <TableCell className="text-right font-mono">{l.debit ? money(l.debit) : "—"}</TableCell>
                        <TableCell className="text-right font-mono">{l.credit ? money(l.credit) : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
          {readiness.fiscal_year.status === "closed" && closingJournal && !closingJournal.journal && (
            <p className="text-muted-foreground text-sm">No income/expense activity occurred this fiscal year — closed with no closing journal.</p>
          )}
        </>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Confirm Fiscal Year Closing</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will post a system-generated closing journal entry zeroing every income/expense account into Retained Earnings, and permanently mark "{readiness?.fiscal_year.name}" as closed. This cannot be undone from this page.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={closeFyMutation.isPending}>Cancel</Button>
            <Button variant="destructive" onClick={() => closeFyMutation.mutate()} disabled={closeFyMutation.isPending}>
              {closeFyMutation.isPending ? "Closing…" : "Confirm & Close"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default FinancialClosingPage;
