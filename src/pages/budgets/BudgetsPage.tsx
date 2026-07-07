/**
 * Budget Management — V2 Sprint 6D.
 * Allocation, Revision, Budget vs Actual, and Variance Analysis over the
 * shared `budgets` table (department/cost_center/project/account scopes).
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useDealerId } from "@/hooks/useDealerId";
import { budgetService, type Budget, type BudgetScopeType } from "@/services/budgetService";
import { fiscalYearService } from "@/services/fiscalYearService";
import { departmentService } from "@/services/departmentService";
import { costCenterService } from "@/services/costCenterService";
import { projectService } from "@/services/projectService";
import { toast } from "@/hooks/use-toast";
import { Plus, Wallet, History, BarChart3 } from "lucide-react";

const money = (n: number) => Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);

const emptyForm = () => ({
  fiscal_year_id: "", scope_type: "cost_center" as BudgetScopeType,
  department_id: "", cost_center_id: "", project_id: "", account_code: "",
  period_type: "annual" as "annual" | "monthly",
  period_start: today(), period_end: today(),
  amount: "", notes: "",
});

const BudgetsPage = () => {
  const dealerId = useDealerId();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"budgets" | "variance">("budgets");

  const { data: fiscalYears } = useQuery({
    queryKey: ["fiscal-years", dealerId],
    queryFn: () => fiscalYearService.list(dealerId!),
    enabled: !!dealerId,
  });
  const { data: departments } = useQuery({
    queryKey: ["departments", dealerId],
    queryFn: () => departmentService.list(dealerId!),
    enabled: !!dealerId,
  });
  const { data: costCenters } = useQuery({
    queryKey: ["cost-centers", dealerId],
    queryFn: () => costCenterService.list(dealerId!),
    enabled: !!dealerId,
  });
  const { data: projects } = useQuery({
    queryKey: ["projects-picker", dealerId],
    queryFn: () => projectService.listForPicker(dealerId!),
    enabled: !!dealerId,
  });

  const { data: budgetsData, isLoading } = useQuery({
    queryKey: ["budgets", dealerId],
    queryFn: () => budgetService.list(dealerId!),
    enabled: !!dealerId,
  });
  const budgets = budgetsData?.rows ?? [];

  const { data: varianceData, isLoading: varianceLoading } = useQuery({
    queryKey: ["budget-variance-report", dealerId],
    queryFn: () => budgetService.varianceReport(dealerId!),
    enabled: !!dealerId && tab === "variance",
  });

  const scopeLabel = (b: Budget) => {
    if (b.scope_type === "department") return b.department_name || "—";
    if (b.scope_type === "cost_center") return b.cost_center_name || "—";
    if (b.scope_type === "project") return b.project_name || "—";
    return b.account_code || "—";
  };

  // ── Create dialog ──
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const reset = () => { setOpen(false); setForm(emptyForm()); };

  const createMutation = useMutation({
    mutationFn: () => budgetService.create(dealerId!, {
      fiscal_year_id: form.fiscal_year_id,
      scope_type: form.scope_type,
      department_id: form.scope_type === "department" ? form.department_id || null : null,
      cost_center_id: form.scope_type === "cost_center" ? form.cost_center_id || null : null,
      project_id: form.scope_type === "project" ? form.project_id || null : null,
      account_code: form.scope_type === "account" ? form.account_code.trim() || null : null,
      period_type: form.period_type,
      period_start: form.period_start,
      period_end: form.period_end,
      amount: Number(form.amount),
      notes: form.notes.trim() || null,
    }),
    onSuccess: () => { toast({ title: "Budget allocated" }); reset(); qc.invalidateQueries({ queryKey: ["budgets"] }); },
    onError: (e: any) => toast({ title: "Failed to allocate budget", description: e?.message, variant: "destructive" }),
  });

  const handleSave = () => {
    if (!form.fiscal_year_id) { toast({ title: "Fiscal year is required", variant: "destructive" }); return; }
    if (!(Number(form.amount) > 0)) { toast({ title: "Amount must be positive", variant: "destructive" }); return; }
    const scopeOk = (
      (form.scope_type === "department" && form.department_id) ||
      (form.scope_type === "cost_center" && form.cost_center_id) ||
      (form.scope_type === "project" && form.project_id) ||
      (form.scope_type === "account" && form.account_code.trim())
    );
    if (!scopeOk) { toast({ title: "Select a target for this scope type", variant: "destructive" }); return; }
    createMutation.mutate();
  };

  // ── Revise dialog ──
  const [reviseTarget, setReviseTarget] = useState<Budget | null>(null);
  const [reviseForm, setReviseForm] = useState({ amount: "", period_start: "", period_end: "", notes: "" });
  const reviseMutation = useMutation({
    mutationFn: () => budgetService.revise(dealerId!, reviseTarget!.id, {
      amount: Number(reviseForm.amount),
      period_start: reviseForm.period_start || undefined,
      period_end: reviseForm.period_end || undefined,
      notes: reviseForm.notes.trim() || null,
    }),
    onSuccess: () => { toast({ title: "Budget revised" }); setReviseTarget(null); qc.invalidateQueries({ queryKey: ["budgets"] }); },
    onError: (e: any) => toast({ title: "Failed to revise budget", description: e?.message, variant: "destructive" }),
  });
  const openRevise = (b: Budget) => {
    setReviseTarget(b);
    setReviseForm({ amount: String(b.amount), period_start: b.period_start, period_end: b.period_end, notes: b.notes ?? "" });
  };

  // ── Variance dialog (single budget) ──
  const [varianceTarget, setVarianceTarget] = useState<Budget | null>(null);
  const varianceMutation = useMutation({
    mutationFn: (id: string) => budgetService.variance(dealerId!, id),
  });
  const openVariance = (b: Budget) => { setVarianceTarget(b); varianceMutation.mutate(b.id); };

  return (
    <div className="container mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Wallet className="h-6 w-6" /> Budget Management</h1>
        {tab === "budgets" && <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-2" /> Allocate Budget</Button>}
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="budgets">Budgets</TabsTrigger>
          <TabsTrigger value="variance">Variance Report</TabsTrigger>
        </TabsList>

        <TabsContent value="budgets" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Active Budgets ({budgets.length})</CardTitle></CardHeader>
            <CardContent>
              {isLoading ? <p>Loading…</p> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Scope</TableHead>
                      <TableHead>Target</TableHead>
                      <TableHead>Period</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Rev.</TableHead>
                      <TableHead className="w-32"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {budgets.map((b) => (
                      <TableRow key={b.id}>
                        <TableCell className="capitalize">{b.scope_type.replace("_", " ")}</TableCell>
                        <TableCell>{scopeLabel(b)}</TableCell>
                        <TableCell className="text-muted-foreground">{b.period_start} – {b.period_end}</TableCell>
                        <TableCell className="text-right">{money(b.amount)}</TableCell>
                        <TableCell><Badge variant="outline">v{b.revision_no}</Badge></TableCell>
                        <TableCell className="space-x-1">
                          <Button size="icon" variant="ghost" onClick={() => openVariance(b)} title="View variance"><BarChart3 className="h-4 w-4" /></Button>
                          <Button size="icon" variant="ghost" onClick={() => openRevise(b)} title="Revise"><History className="h-4 w-4" /></Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!budgets.length && (
                      <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No budgets allocated yet.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="variance" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Variance Analysis</CardTitle></CardHeader>
            <CardContent>
              {varianceLoading ? <p>Loading…</p> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Scope</TableHead>
                      <TableHead>Period</TableHead>
                      <TableHead className="text-right">Allocated</TableHead>
                      <TableHead className="text-right">Actual</TableHead>
                      <TableHead className="text-right">Variance</TableHead>
                      <TableHead className="text-right">%</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(varianceData?.rows ?? []).map((r) => (
                      <TableRow key={r.budget_id}>
                        <TableCell className="capitalize">{r.scope_type.replace("_", " ")}</TableCell>
                        <TableCell className="text-muted-foreground">{r.period_start} – {r.period_end}</TableCell>
                        <TableCell className="text-right">{money(r.allocated)}</TableCell>
                        <TableCell className="text-right">{money(r.actual)}</TableCell>
                        <TableCell className={`text-right ${r.variance < 0 ? "text-destructive" : ""}`}>{money(r.variance)}</TableCell>
                        <TableCell className="text-right">{r.variance_percent != null ? `${r.variance_percent}%` : "—"}</TableCell>
                      </TableRow>
                    ))}
                    {!(varianceData?.rows ?? []).length && (
                      <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No active budgets to analyze.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Allocate budget dialog */}
      <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); else setOpen(true); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Allocate Budget</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Fiscal Year</Label>
              <Select value={form.fiscal_year_id} onValueChange={(v) => setForm({ ...form, fiscal_year_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select fiscal year" /></SelectTrigger>
                <SelectContent>
                  {(fiscalYears?.rows ?? []).map(fy => <SelectItem key={fy.id} value={fy.id}>{fy.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Scope Type</Label>
              <Select value={form.scope_type} onValueChange={(v: any) => setForm({ ...form, scope_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="department">Department</SelectItem>
                  <SelectItem value="cost_center">Cost Center</SelectItem>
                  <SelectItem value="project">Project</SelectItem>
                  <SelectItem value="account">GL Account</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.scope_type === "department" && (
              <div>
                <Label>Department</Label>
                <Select value={form.department_id} onValueChange={(v) => setForm({ ...form, department_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                  <SelectContent>{(departments?.rows ?? []).map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            {form.scope_type === "cost_center" && (
              <div>
                <Label>Cost Center</Label>
                <Select value={form.cost_center_id} onValueChange={(v) => setForm({ ...form, cost_center_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select cost center" /></SelectTrigger>
                  <SelectContent>{(costCenters?.rows ?? []).map(c => <SelectItem key={c.id} value={c.id}>{c.code} — {c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            {form.scope_type === "project" && (
              <div>
                <Label>Project</Label>
                <Select value={form.project_id} onValueChange={(v) => setForm({ ...form, project_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger>
                  <SelectContent>{(projects ?? []).map(p => <SelectItem key={p.id} value={p.id}>{p.project_code} — {p.project_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            {form.scope_type === "account" && (
              <div><Label>GL Account Code</Label><Input value={form.account_code} onChange={e => setForm({ ...form, account_code: e.target.value })} placeholder="e.g. 6000" /></div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Period Start</Label><Input type="date" value={form.period_start} onChange={e => setForm({ ...form, period_start: e.target.value })} /></div>
              <div><Label>Period End</Label><Input type="date" value={form.period_end} onChange={e => setForm({ ...form, period_end: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Period Type</Label>
                <Select value={form.period_type} onValueChange={(v: any) => setForm({ ...form, period_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="annual">Annual</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Amount</Label><Input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="0.00" /></div>
            </div>
            <div><Label>Notes (optional)</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={reset} disabled={createMutation.isPending}>Cancel</Button>
            <Button onClick={handleSave} disabled={createMutation.isPending}>{createMutation.isPending ? "Saving…" : "Allocate"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revise dialog */}
      <Dialog open={!!reviseTarget} onOpenChange={(v) => { if (!v) setReviseTarget(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Revise Budget</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Current: {reviseTarget && money(reviseTarget.amount)} (v{reviseTarget?.revision_no})</p>
            <div><Label>New Amount</Label><Input type="number" value={reviseForm.amount} onChange={e => setReviseForm({ ...reviseForm, amount: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Period Start</Label><Input type="date" value={reviseForm.period_start} onChange={e => setReviseForm({ ...reviseForm, period_start: e.target.value })} /></div>
              <div><Label>Period End</Label><Input type="date" value={reviseForm.period_end} onChange={e => setReviseForm({ ...reviseForm, period_end: e.target.value })} /></div>
            </div>
            <div><Label>Notes (optional)</Label><Textarea value={reviseForm.notes} onChange={e => setReviseForm({ ...reviseForm, notes: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviseTarget(null)} disabled={reviseMutation.isPending}>Cancel</Button>
            <Button onClick={() => reviseMutation.mutate()} disabled={reviseMutation.isPending}>{reviseMutation.isPending ? "Saving…" : "Revise"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Variance dialog */}
      <Dialog open={!!varianceTarget} onOpenChange={(v) => { if (!v) setVarianceTarget(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Budget vs Actual — {varianceTarget && scopeLabel(varianceTarget)}</DialogTitle></DialogHeader>
          {varianceMutation.isPending && <p>Loading…</p>}
          {varianceMutation.data && (
            <div className="grid grid-cols-3 gap-4 text-center">
              <div><p className="text-sm text-muted-foreground">Allocated</p><p className="text-xl font-bold">{money(varianceTarget!.amount)}</p></div>
              <div><p className="text-sm text-muted-foreground">Actual</p><p className="text-xl font-bold">{money(varianceMutation.data.actual)}</p></div>
              <div><p className="text-sm text-muted-foreground">Variance</p><p className={`text-xl font-bold ${varianceMutation.data.variance < 0 ? "text-destructive" : ""}`}>{money(varianceMutation.data.variance)}</p></div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default BudgetsPage;
