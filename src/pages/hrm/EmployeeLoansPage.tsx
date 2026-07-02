import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Plus, Eye, X, CheckCircle2, Wallet, AlertTriangle, Calendar, BadgeDollarSign } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { useDealerId } from "@/hooks/useDealerId";
import { employeeService, Employee } from "@/services/employeeService";
import { bankAccountService } from "@/services/bankAccountService";
import {
  employeeLoanService, EmployeeLoan, LoanDetail, LoanSummary, EmiStatus, PaymentSource,
} from "@/services/employeeLoanService";

function todayISO() { return new Date().toISOString().slice(0, 10); }

function emiBadge(s: EmiStatus) {
  const map: Record<EmiStatus, string> = {
    pending: "bg-amber-500/15 text-amber-400 border-amber-500/40",
    partial: "bg-blue-500/15 text-blue-400 border-blue-500/40",
    paid: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40",
    waived: "bg-slate-500/15 text-slate-400 border-slate-500/40",
  };
  return <Badge variant="outline" className={map[s]}>{s}</Badge>;
}
function loanBadge(s: string) {
  const map: Record<string, string> = {
    active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40",
    closed: "bg-slate-500/15 text-slate-400 border-slate-500/40",
    cancelled: "bg-rose-500/15 text-rose-400 border-rose-500/40",
  };
  return <Badge variant="outline" className={map[s] ?? ""}>{s}</Badge>;
}

const EMPTY_NEW = {
  employee_id: "",
  principal: 0,
  tenure_months: 6,
  issue_date: todayISO(),
  first_emi_date: "",
  payment_method: "cash" as "cash" | "bank",
  bank_account_id: "" as string,
  reason: "",
  notes: "",
};

export default function EmployeeLoansPage() {
  const dealerId = useDealerId();
  const [summary, setSummary] = useState<LoanSummary | null>(null);
  const [rows, setRows] = useState<EmployeeLoan[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [banks, setBanks] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [empFilter, setEmpFilter] = useState<string>("all");

  const [newOpen, setNewOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newForm, setNewForm] = useState({ ...EMPTY_NEW });

  const [detail, setDetail] = useState<LoanDetail | null>(null);
  const [payOpen, setPayOpen] = useState<{ emiId: string; remaining: number } | null>(null);
  const [payForm, setPayForm] = useState({
    amount: 0,
    paid_date: todayISO(),
    payment_source: "manual" as PaymentSource,
    reference: "",
    notes: "",
  });

  async function reload() {
    try {
      const [s, list, emps, bks] = await Promise.all([
        employeeLoanService.summary(),
        employeeLoanService.list({
          employee_id: empFilter === "all" ? undefined : empFilter,
          status: statusFilter === "all" ? undefined : (statusFilter as any),
        }),
        employees.length ? Promise.resolve(employees) : employeeService.list(dealerId),
        banks.length ? Promise.resolve(banks) : bankAccountService.list(dealerId).catch(() => []),
      ]);
      setSummary(s);
      setRows(list);
      if (!employees.length) setEmployees(emps as Employee[]);
      if (!banks.length) setBanks(bks as any[]);
    } catch (e: any) {
      toast({ title: "Load failed", description: String(e.message ?? e), variant: "destructive" });
    }
  }
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [statusFilter, empFilter]);

  const empName = (id?: string | null) => employees.find(e => e.id === id)?.name ?? "—";

  const computedEmi = useMemo(() => {
    if (!newForm.principal || !newForm.tenure_months) return 0;
    return Number((Number(newForm.principal) / Number(newForm.tenure_months)).toFixed(2));
  }, [newForm.principal, newForm.tenure_months]);

  async function createLoan() {
    if (!newForm.employee_id) return toast({ title: "Pick an employee", variant: "destructive" });
    if (newForm.principal <= 0) return toast({ title: "Principal must be > 0", variant: "destructive" });
    if (newForm.payment_method === "bank" && !newForm.bank_account_id) {
      return toast({ title: "Select a bank account", variant: "destructive" });
    }
    if (saving) return; // guard against double-submit (duplicate loan + schedule)
    setSaving(true);
    try {
      await employeeLoanService.create({
        employee_id: newForm.employee_id,
        principal: Number(newForm.principal),
        tenure_months: Number(newForm.tenure_months),
        issue_date: newForm.issue_date,
        first_emi_date: newForm.first_emi_date || undefined,
        payment_method: newForm.payment_method,
        bank_account_id: newForm.payment_method === "bank" ? newForm.bank_account_id : null,
        reason: newForm.reason || null,
        notes: newForm.notes || null,
      });
      toast({ title: "Loan issued" });
      setNewOpen(false);
      setNewForm({ ...EMPTY_NEW });
      reload();
    } catch (e: any) {
      toast({ title: "Failed", description: String(e.message ?? e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function viewDetail(id: string) {
    try { setDetail(await employeeLoanService.get(id)); }
    catch (e: any) { toast({ title: "Failed", description: String(e.message ?? e), variant: "destructive" }); }
  }

  async function cancelLoan(id: string) {
    if (!confirm("Cancel this loan? Only allowed if no EMI has been paid.")) return;
    try { await employeeLoanService.cancel(id); toast({ title: "Cancelled" }); setDetail(null); reload(); }
    catch (e: any) { toast({ title: "Failed", description: String(e.message ?? e), variant: "destructive" }); }
  }
  async function closeLoan(id: string) {
    if (!confirm("Close loan now? All remaining EMIs will be waived.")) return;
    try { await employeeLoanService.close(id); toast({ title: "Closed" }); setDetail(null); reload(); }
    catch (e: any) { toast({ title: "Failed", description: String(e.message ?? e), variant: "destructive" }); }
  }

  function openPay(emi: { id: string; amount_due: number; amount_paid: number }) {
    const remaining = Number(emi.amount_due) - Number(emi.amount_paid);
    setPayOpen({ emiId: emi.id, remaining });
    setPayForm({ amount: remaining, paid_date: todayISO(), payment_source: "manual", reference: "", notes: "" });
  }
  async function recordPayment() {
    if (!payOpen) return;
    if (payForm.amount <= 0) return toast({ title: "Amount required", variant: "destructive" });
    if (saving) return; // guard against double-submit (duplicate EMI payment)
    setSaving(true);
    try {
      await employeeLoanService.payEmi(payOpen.emiId, {
        amount: Number(payForm.amount),
        paid_date: payForm.paid_date,
        payment_source: payForm.payment_source,
        reference: payForm.reference || null,
        notes: payForm.notes || null,
      });
      toast({ title: "Payment recorded" });
      setPayOpen(null);
      if (detail) viewDetail(detail.id);
      reload();
    } catch (e: any) {
      toast({ title: "Failed", description: String(e.message ?? e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }
  async function waiveEmi(emiId: string) {
    if (!confirm("Waive this EMI? It will be marked as written off.")) return;
    try {
      await employeeLoanService.waiveEmi(emiId);
      toast({ title: "EMI waived" });
      if (detail) viewDetail(detail.id);
      reload();
    } catch (e: any) {
      toast({ title: "Failed", description: String(e.message ?? e), variant: "destructive" });
    }
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <BadgeDollarSign className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Employee Loans & EMI</h1>
        </div>
        <Button onClick={() => setNewOpen(true)}><Plus className="h-4 w-4 mr-1" /> New Loan</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground flex items-center gap-1"><Wallet className="h-3 w-3" /> Outstanding</div><div className="text-2xl font-bold">{formatCurrency(summary?.outstanding ?? 0)}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="h-3 w-3" /> Due This Month</div><div className="text-2xl font-bold text-amber-400">{formatCurrency(summary?.due_this_month ?? 0)}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Overdue</div><div className="text-2xl font-bold text-rose-400">{formatCurrency(summary?.overdue_amount ?? 0)}</div><div className="text-xs text-muted-foreground">{summary?.overdue_count ?? 0} installments</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Active Loans</div><div className="text-2xl font-bold">{summary?.active_loans ?? 0}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Employees</div><div className="text-2xl font-bold">{employees.filter(e => e.status === "active").length}</div></CardContent></Card>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <Select value={empFilter} onValueChange={setEmpFilter}>
          <SelectTrigger className="w-64"><SelectValue placeholder="Employee" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All employees</SelectItem>
            {employees.map(e => <SelectItem key={e.id} value={e.id}>{e.name} {e.employee_code ? `(${e.employee_code})` : ""}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Employee</TableHead>
                <TableHead className="text-right">Principal</TableHead>
                <TableHead>Tenure</TableHead>
                <TableHead className="text-right">EMI</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead>Issue</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (<TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-6">No loans</TableCell></TableRow>)}
              {rows.map(l => (
                <TableRow key={l.id}>
                  <TableCell className="font-mono text-xs">{l.loan_code}</TableCell>
                  <TableCell>{l.employee_name ?? empName(l.employee_id)} <span className="text-xs text-muted-foreground">({l.employee_code})</span></TableCell>
                  <TableCell className="text-right">{formatCurrency(Number(l.principal))}</TableCell>
                  <TableCell>{l.tenure_months} mo</TableCell>
                  <TableCell className="text-right">{formatCurrency(Number(l.emi_amount))}</TableCell>
                  <TableCell className="text-right text-emerald-400">{formatCurrency(Number(l.paid_total ?? 0))}</TableCell>
                  <TableCell className="text-right font-medium">{formatCurrency(Number(l.balance ?? 0))}</TableCell>
                  <TableCell className="text-xs">{l.issue_date?.slice(0, 10)}</TableCell>
                  <TableCell>{loanBadge(l.status)}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => viewDetail(l.id)}><Eye className="h-3.5 w-3.5" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* New Loan dialog */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Issue New Loan</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Employee *</Label>
              <Select value={newForm.employee_id} onValueChange={(v) => setNewForm({ ...newForm, employee_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                <SelectContent>
                  {employees.filter(e => e.status === "active").map(e => (
                    <SelectItem key={e.id} value={e.id}>{e.name} {e.employee_code ? `(${e.employee_code})` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Principal *</Label><Input type="number" min="0" step="0.01" value={newForm.principal} onChange={e => setNewForm({ ...newForm, principal: Number(e.target.value) })} /></div>
            <div><Label>Tenure (months) *</Label><Input type="number" min="1" max="120" value={newForm.tenure_months} onChange={e => setNewForm({ ...newForm, tenure_months: Number(e.target.value) })} /></div>
            <div className="col-span-2 text-sm text-muted-foreground bg-muted/30 rounded p-2">
              Calculated EMI: <span className="font-bold text-foreground">{formatCurrency(computedEmi)}</span> /month
              <span className="text-xs ml-2">(final installment absorbs rounding)</span>
            </div>
            <div><Label>Issue Date *</Label><Input type="date" value={newForm.issue_date} onChange={e => setNewForm({ ...newForm, issue_date: e.target.value })} /></div>
            <div><Label>First EMI Date</Label><Input type="date" value={newForm.first_emi_date} onChange={e => setNewForm({ ...newForm, first_emi_date: e.target.value })} placeholder="Auto = issue + 1mo" /></div>
            <div>
              <Label>Disbursement Method</Label>
              <Select value={newForm.payment_method} onValueChange={(v) => setNewForm({ ...newForm, payment_method: v as any })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="bank">Bank Transfer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {newForm.payment_method === "bank" && (
              <div>
                <Label>Bank Account *</Label>
                <Select value={newForm.bank_account_id} onValueChange={(v) => setNewForm({ ...newForm, bank_account_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {banks.map(b => <SelectItem key={b.id} value={b.id}>{b.bank_name} — {b.account_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="col-span-2"><Label>Reason</Label><Input value={newForm.reason} onChange={e => setNewForm({ ...newForm, reason: e.target.value })} placeholder="e.g. Medical emergency, Vehicle purchase" /></div>
            <div className="col-span-2"><Label>Notes</Label><Textarea rows={2} value={newForm.notes} onChange={e => setNewForm({ ...newForm, notes: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>Cancel</Button>
            <Button onClick={createLoan} disabled={saving}>{saving ? "Issuing…" : "Issue Loan & Generate Schedule"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail dialog */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          {detail && (<>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <span className="font-mono text-base">{detail.loan_code}</span>
                <span>·</span>
                <span>{detail.employee_name}</span>
                {loanBadge(detail.status)}
              </DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div><div className="text-xs text-muted-foreground">Principal</div><div className="font-semibold">{formatCurrency(Number(detail.principal))}</div></div>
              <div><div className="text-xs text-muted-foreground">Tenure</div><div className="font-semibold">{detail.tenure_months} months</div></div>
              <div><div className="text-xs text-muted-foreground">EMI</div><div className="font-semibold">{formatCurrency(Number(detail.emi_amount))}</div></div>
              <div><div className="text-xs text-muted-foreground">Issued</div><div className="font-semibold">{detail.issue_date?.slice(0, 10)}</div></div>
              <div><div className="text-xs text-muted-foreground">Disbursed Via</div><div className="font-semibold capitalize">{detail.payment_method}{detail.bank_account_name ? ` — ${detail.bank_account_name}` : ""}</div></div>
              {detail.reason && <div className="col-span-3"><div className="text-xs text-muted-foreground">Reason</div><div>{detail.reason}</div></div>}
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead className="text-right">Due</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead>Paid On</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.emis.map(e => {
                  const overdue = e.status !== "paid" && e.status !== "waived" && e.due_date < todayISO();
                  return (
                    <TableRow key={e.id} className={overdue ? "bg-rose-500/5" : ""}>
                      <TableCell>{e.installment_no}</TableCell>
                      <TableCell className="text-xs">{e.due_date?.slice(0, 10)}{overdue && <AlertTriangle className="inline h-3 w-3 ml-1 text-rose-400" />}</TableCell>
                      <TableCell className="text-right">{formatCurrency(Number(e.amount_due))}</TableCell>
                      <TableCell className="text-right text-emerald-400">{formatCurrency(Number(e.amount_paid))}</TableCell>
                      <TableCell className="text-xs">{e.paid_date?.slice(0, 10) ?? "—"}</TableCell>
                      <TableCell className="text-xs capitalize">{e.payment_source?.replace("_", " ") ?? "—"}</TableCell>
                      <TableCell>{emiBadge(e.status)}</TableCell>
                      <TableCell className="text-right">
                        {(e.status === "pending" || e.status === "partial") && (
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="outline" onClick={() => openPay(e)}><CheckCircle2 className="h-3.5 w-3.5 mr-1" />Pay</Button>
                            <Button size="sm" variant="ghost" onClick={() => waiveEmi(e.id)} title="Waive"><X className="h-3.5 w-3.5 text-rose-400" /></Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            <DialogFooter className="gap-2">
              {detail.status === "active" && (
                <>
                  <Button variant="outline" onClick={() => cancelLoan(detail.id)}>Cancel Loan</Button>
                  <Button variant="outline" onClick={() => closeLoan(detail.id)}>Close (Waive Remaining)</Button>
                </>
              )}
              <Button variant="outline" onClick={() => setDetail(null)}>Close</Button>
            </DialogFooter>
          </>)}
        </DialogContent>
      </Dialog>

      {/* Pay dialog */}
      <Dialog open={!!payOpen} onOpenChange={(o) => !o && setPayOpen(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record Payment</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              Remaining: <span className="text-foreground font-semibold">{formatCurrency(payOpen?.remaining ?? 0)}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Amount *</Label><Input type="number" min="0" step="0.01" max={payOpen?.remaining} value={payForm.amount} onChange={e => setPayForm({ ...payForm, amount: Number(e.target.value) })} /></div>
              <div><Label>Paid Date *</Label><Input type="date" value={payForm.paid_date} onChange={e => setPayForm({ ...payForm, paid_date: e.target.value })} /></div>
            </div>
            <div>
              <Label>Source *</Label>
              <Select value={payForm.payment_source} onValueChange={(v) => setPayForm({ ...payForm, payment_source: v as PaymentSource })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="salary_deduction">Salary Deduction</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="bank">Bank Transfer</SelectItem>
                  <SelectItem value="manual">Other / Manual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Reference</Label><Input value={payForm.reference} onChange={e => setPayForm({ ...payForm, reference: e.target.value })} placeholder="Salary period YYYY-MM or txn ref" /></div>
            <div><Label>Notes</Label><Textarea rows={2} value={payForm.notes} onChange={e => setPayForm({ ...payForm, notes: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(null)}>Cancel</Button>
            <Button onClick={recordPayment} disabled={saving}>{saving ? "Recording…" : "Record"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
