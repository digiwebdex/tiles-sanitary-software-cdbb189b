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
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import {
  Plus, Pencil, X, CheckCircle2, Circle, MinusCircle, LogOut, ClipboardList,
  Wallet, AlertTriangle, Calculator, Trash2,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { useDealerId } from "@/hooks/useDealerId";
import { employeeService, Employee } from "@/services/employeeService";
import { bankAccountService, BankAccount } from "@/services/bankAccountService";
import {
  employeeExitService, EmployeeExit, ExitStatus, ExitType,
  ExitClearance, ClearanceStatus, ExitSummary, SettlementPreview,
} from "@/services/employeeExitService";

const EXIT_TYPES: ExitType[] = ["resignation", "termination", "retirement", "absconding", "end_of_contract"];

function todayISO() { return new Date().toISOString().slice(0, 10); }
function num(v: any) { return Number(v) || 0; }

function statusBadge(s: ExitStatus) {
  const map: Record<ExitStatus, string> = {
    initiated: "bg-sky-500/15 text-sky-400 border-sky-500/40",
    clearance: "bg-amber-500/15 text-amber-400 border-amber-500/40",
    settled: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40",
    cancelled: "bg-slate-500/15 text-slate-400 border-slate-500/40",
  };
  return <Badge variant="outline" className={map[s]}>{s}</Badge>;
}

function clearanceIcon(s: ClearanceStatus) {
  if (s === "done") return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
  if (s === "na") return <MinusCircle className="h-4 w-4 text-slate-400" />;
  return <Circle className="h-4 w-4 text-amber-400" />;
}

const EMPTY_NEW: any = {
  employee_id: "",
  exit_type: "resignation",
  resignation_date: todayISO(),
  last_working_date: todayISO(),
  notice_period_days: 30,
  reason: "",
  unpaid_salary: 0,
  leave_encashment: 0,
  bonus: 0,
  gratuity: 0,
  other_additions: 0,
  other_deductions: 0,
  rehire_eligible: true,
  rehire_eligible_notes: "",
  exit_interview_notes: "",
  payment_method: "cash",
  bank_account_id: null,
};

export default function EmployeeExitsPage() {
  const dealerId = useDealerId();
  const [rows, setRows] = useState<EmployeeExit[]>([]);
  const [summary, setSummary] = useState<ExitSummary | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [statusFilter, setStatusFilter] = useState<ExitStatus | "all">("all");
  const [q, setQ] = useState("");

  const [newOpen, setNewOpen] = useState(false);
  const [form, setForm] = useState<any>(EMPTY_NEW);

  const [detail, setDetail] = useState<EmployeeExit | null>(null);
  const [preview, setPreview] = useState<SettlementPreview | null>(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<EmployeeExit>>({});

  const [addItemOpen, setAddItemOpen] = useState(false);
  const [newItem, setNewItem] = useState({ department: "HR", item: "", remarks: "" });

  const [settleOpen, setSettleOpen] = useState(false);
  const [settleForm, setSettleForm] = useState<any>({ settled_date: todayISO(), payment_method: "cash", bank_account_id: null });

  async function reload() {
    try {
      const [list, sum] = await Promise.all([
        employeeExitService.list({ status: statusFilter === "all" ? undefined : statusFilter, q: q || undefined }),
        employeeExitService.summary(),
      ]);
      setRows(list);
      setSummary(sum);
    } catch (e: any) {
      toast({ title: "Load failed", description: String(e.message ?? e), variant: "destructive" });
    }
  }

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [statusFilter]);

  useEffect(() => {
    employeeService.list(dealerId).then(setEmployees).catch(() => {});
    bankAccountService.list(dealerId).then(setBanks).catch(() => {});
  }, [dealerId]);

  const activeEmployees = useMemo(() => employees.filter(e => e.status === "active"), [employees]);

  async function openDetail(row: EmployeeExit) {
    try {
      const full = await employeeExitService.get(row.id);
      setDetail(full);
      setEditing(false);
      if (full.status !== "settled" && full.status !== "cancelled") {
        const p = await employeeExitService.settlementPreview(row.id);
        setPreview(p);
      } else {
        setPreview(null);
      }
    } catch (e: any) {
      toast({ title: "Load failed", description: String(e.message ?? e), variant: "destructive" });
    }
  }

  async function refreshDetail() {
    if (!detail) return;
    await openDetail(detail);
  }

  async function handleCreate() {
    if (!form.employee_id) {
      toast({ title: "Pick an employee", variant: "destructive" });
      return;
    }
    try {
      const created = await employeeExitService.create(form);
      toast({ title: `Exit ${created.exit_code} initiated` });
      setNewOpen(false);
      setForm(EMPTY_NEW);
      await reload();
      await openDetail(created);
    } catch (e: any) {
      toast({ title: "Create failed", description: String(e.message ?? e), variant: "destructive" });
    }
  }

  async function handleSaveEdit() {
    if (!detail) return;
    try {
      await employeeExitService.update(detail.id, editForm);
      toast({ title: "Updated" });
      setEditing(false);
      await reload();
      await refreshDetail();
    } catch (e: any) {
      toast({ title: "Update failed", description: String(e.message ?? e), variant: "destructive" });
    }
  }

  async function handleCancel(row: EmployeeExit) {
    if (!confirm(`Cancel exit ${row.exit_code}?`)) return;
    try {
      await employeeExitService.cancel(row.id);
      toast({ title: "Cancelled" });
      setDetail(null);
      await reload();
    } catch (e: any) {
      toast({ title: "Cancel failed", description: String(e.message ?? e), variant: "destructive" });
    }
  }

  async function toggleClearance(c: ExitClearance, next: ClearanceStatus) {
    try {
      await employeeExitService.updateClearance(c.id, { status: next });
      await refreshDetail();
    } catch (e: any) {
      toast({ title: "Update failed", description: String(e.message ?? e), variant: "destructive" });
    }
  }

  async function removeClearance(c: ExitClearance) {
    if (!confirm(`Remove "${c.item}"?`)) return;
    try {
      await employeeExitService.removeClearance(c.id);
      await refreshDetail();
    } catch (e: any) {
      toast({ title: "Remove failed", description: String(e.message ?? e), variant: "destructive" });
    }
  }

  async function addClearanceItem() {
    if (!detail || !newItem.item.trim()) return;
    try {
      await employeeExitService.addClearance(detail.id, newItem);
      setNewItem({ department: "HR", item: "", remarks: "" });
      setAddItemOpen(false);
      await refreshDetail();
    } catch (e: any) {
      toast({ title: "Add failed", description: String(e.message ?? e), variant: "destructive" });
    }
  }

  async function handleSettle() {
    if (!detail) return;
    try {
      await employeeExitService.settle(detail.id, settleForm);
      toast({ title: "Settled. Employee marked inactive." });
      setSettleOpen(false);
      await reload();
      await refreshDetail();
    } catch (e: any) {
      toast({ title: "Settle failed", description: String(e.message ?? e), variant: "destructive" });
    }
  }

  return (
    <div className="container mx-auto max-w-7xl p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <LogOut className="h-6 w-6 text-primary" />
            Exit / Offboarding
          </h1>
          <p className="text-sm text-muted-foreground">Manage resignations, clearance and final settlements.</p>
        </div>
        <Button onClick={() => setNewOpen(true)}>
          <Plus className="h-4 w-4 mr-2" /> Initiate Exit
        </Button>
      </div>

      {/* Summary */}
      {summary && (
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <KpiCard label="In Clearance" count={summary.clearance.count} amount={summary.clearance.net} tone="amber" />
          <KpiCard label="Settled" count={summary.settled.count} amount={summary.settled.net} tone="emerald" />
          <KpiCard label="Initiated" count={summary.initiated.count} amount={summary.initiated.net} tone="sky" />
          <KpiCard label="Cancelled" count={summary.cancelled.count} amount={summary.cancelled.net} tone="slate" />
        </div>
      )}

      {/* Filters + table */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Exit Records</CardTitle>
          <div className="flex items-center gap-2">
            <Input
              placeholder="Search code or name…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && reload()}
              className="w-56"
            />
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="initiated">Initiated</SelectItem>
                <SelectItem value="clearance">In Clearance</SelectItem>
                <SelectItem value="settled">Settled</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={reload}>Apply</Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Employee</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Resigned</TableHead>
                <TableHead>Last Day</TableHead>
                <TableHead className="text-right">Net Payable</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => openDetail(r)}>
                  <TableCell className="font-mono text-xs">{r.exit_code}</TableCell>
                  <TableCell>
                    <div className="font-medium">{r.employee_name}</div>
                    <div className="text-xs text-muted-foreground">{r.employee_code} · {r.designation || "—"}</div>
                  </TableCell>
                  <TableCell className="capitalize text-xs">{r.exit_type.replace(/_/g, " ")}</TableCell>
                  <TableCell className="text-xs">{r.resignation_date}</TableCell>
                  <TableCell className="text-xs">{r.last_working_date}</TableCell>
                  <TableCell className="text-right font-medium">{formatCurrency(num(r.net_payable))}</TableCell>
                  <TableCell>{statusBadge(r.status)}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); openDetail(r); }}>Open</Button>
                  </TableCell>
                </TableRow>
              ))}
              {!rows.length && (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No exit records.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* New Exit Dialog */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Initiate Employee Exit</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Employee</Label>
              <Select value={form.employee_id} onValueChange={(v) => setForm({ ...form, employee_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select employee…" /></SelectTrigger>
                <SelectContent>
                  {activeEmployees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name} ({e.employee_code || "—"}) · {e.designation || ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Exit Type</Label>
              <Select value={form.exit_type} onValueChange={(v) => setForm({ ...form, exit_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EXIT_TYPES.map((t) => <SelectItem key={t} value={t} className="capitalize">{t.replace(/_/g, " ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notice Period (days)</Label>
              <Input type="number" value={form.notice_period_days} onChange={(e) => setForm({ ...form, notice_period_days: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Resignation Date</Label>
              <Input type="date" value={form.resignation_date} onChange={(e) => setForm({ ...form, resignation_date: e.target.value })} />
            </div>
            <div>
              <Label>Last Working Date</Label>
              <Input type="date" value={form.last_working_date} onChange={(e) => setForm({ ...form, last_working_date: e.target.value })} />
            </div>
            <div>
              <Label>Unpaid Salary</Label>
              <Input type="number" step="0.01" value={form.unpaid_salary} onChange={(e) => setForm({ ...form, unpaid_salary: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Leave Encashment</Label>
              <Input type="number" step="0.01" value={form.leave_encashment} onChange={(e) => setForm({ ...form, leave_encashment: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Bonus</Label>
              <Input type="number" step="0.01" value={form.bonus} onChange={(e) => setForm({ ...form, bonus: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Gratuity</Label>
              <Input type="number" step="0.01" value={form.gratuity} onChange={(e) => setForm({ ...form, gratuity: Number(e.target.value) })} />
            </div>
            <div className="col-span-2">
              <Label>Reason</Label>
              <Textarea rows={2} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            </div>
            <div className="col-span-2 flex items-center gap-2">
              <Switch checked={form.rehire_eligible} onCheckedChange={(v) => setForm({ ...form, rehire_eligible: v })} />
              <Label>Eligible for rehire</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate}>Initiate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={!!detail} onOpenChange={(o) => { if (!o) setDetail(null); }}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <LogOut className="h-5 w-5" />
                  {detail.exit_code} — {detail.employee_name}
                  {statusBadge(detail.status)}
                </DialogTitle>
              </DialogHeader>

              {/* Summary header strip */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <Mini label="Type" value={<span className="capitalize">{detail.exit_type.replace(/_/g, " ")}</span>} />
                <Mini label="Resigned" value={detail.resignation_date} />
                <Mini label="Last Day" value={detail.last_working_date} />
                <Mini label="Notice (days)" value={detail.notice_period_days} />
              </div>

              {/* Settlement panel */}
              <Card className="border-primary/30">
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Calculator className="h-4 w-4" /> Final Settlement
                  </CardTitle>
                  {detail.status !== "settled" && detail.status !== "cancelled" && (
                    <div className="flex gap-2">
                      {!editing ? (
                        <Button size="sm" variant="outline" onClick={() => { setEditForm({}); setEditing(true); }}>
                          <Pencil className="h-3 w-3 mr-1" /> Edit
                        </Button>
                      ) : (
                        <>
                          <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
                          <Button size="sm" onClick={handleSaveEdit}>Save</Button>
                        </>
                      )}
                    </div>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                    <SettleField label="Unpaid Salary" field="unpaid_salary" detail={detail} editing={editing} editForm={editForm} setEditForm={setEditForm} sign="+" />
                    <SettleField label="Leave Encashment" field="leave_encashment" detail={detail} editing={editing} editForm={editForm} setEditForm={setEditForm} sign="+" />
                    <SettleField label="Bonus" field="bonus" detail={detail} editing={editing} editForm={editForm} setEditForm={setEditForm} sign="+" />
                    <SettleField label="Gratuity" field="gratuity" detail={detail} editing={editing} editForm={editForm} setEditForm={setEditForm} sign="+" />
                    <SettleField label="Other Additions" field="other_additions" detail={detail} editing={editing} editForm={editForm} setEditForm={setEditForm} sign="+" />
                    <SettleField label="Other Deductions" field="other_deductions" detail={detail} editing={editing} editForm={editForm} setEditForm={setEditForm} sign="-" />
                    <div className="col-span-2 md:col-span-3 border-t border-border pt-2 grid grid-cols-2 md:grid-cols-3 gap-3">
                      <Mini label="Outstanding Loans" value={<span className="text-rose-400">- {formatCurrency(num(detail.outstanding_loans))}</span>} />
                      <Mini label="Outstanding Advances" value={<span className="text-rose-400">- {formatCurrency(num(detail.outstanding_advances))}</span>} />
                      <Mini label="NET PAYABLE" value={
                        <span className={`text-lg font-bold ${num(detail.net_payable) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                          {formatCurrency(num(detail.net_payable))}
                        </span>
                      } />
                    </div>
                    {preview && preview.suggested_net !== num(detail.net_payable) && (
                      <div className="col-span-full flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded p-2">
                        <AlertTriangle className="h-3 w-3" />
                        Suggested net based on live outstandings: <strong>{formatCurrency(preview.suggested_net)}</strong>. Save edits to recompute.
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Clearance Checklist */}
              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-base flex items-center gap-2">
                    <ClipboardList className="h-4 w-4" /> Clearance Checklist
                  </CardTitle>
                  {detail.status !== "settled" && detail.status !== "cancelled" && (
                    <Button size="sm" variant="outline" onClick={() => setAddItemOpen(true)}>
                      <Plus className="h-3 w-3 mr-1" /> Add Item
                    </Button>
                  )}
                </CardHeader>
                <CardContent className="space-y-1">
                  {Object.entries(groupBy(detail.clearances || [], (c) => c.department)).map(([dept, items]) => (
                    <div key={dept} className="border border-border rounded-lg p-3 mb-2">
                      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{dept}</div>
                      <div className="space-y-1">
                        {items.map((c) => (
                          <div key={c.id} className="flex items-center gap-2 py-1 border-b border-border/30 last:border-0">
                            <button onClick={() => toggleClearance(c, c.status === "done" ? "pending" : "done")} disabled={detail.status === "settled" || detail.status === "cancelled"}>
                              {clearanceIcon(c.status)}
                            </button>
                            <span className={`flex-1 text-sm ${c.status === "done" ? "line-through text-muted-foreground" : ""}`}>{c.item}</span>
                            {detail.status !== "settled" && detail.status !== "cancelled" && (
                              <>
                                <Select value={c.status} onValueChange={(v) => toggleClearance(c, v as ClearanceStatus)}>
                                  <SelectTrigger className="h-7 w-24 text-xs"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="pending">Pending</SelectItem>
                                    <SelectItem value="done">Done</SelectItem>
                                    <SelectItem value="na">N/A</SelectItem>
                                  </SelectContent>
                                </Select>
                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeClearance(c)}>
                                  <Trash2 className="h-3 w-3 text-muted-foreground" />
                                </Button>
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Exit interview */}
              <Card>
                <CardHeader><CardTitle className="text-base">Exit Interview Notes</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {editing ? (
                    <Textarea
                      rows={3}
                      defaultValue={detail.exit_interview_notes || ""}
                      onChange={(e) => setEditForm({ ...editForm, exit_interview_notes: e.target.value })}
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{detail.exit_interview_notes || "—"}</p>
                  )}
                  <div className="flex items-center gap-2 pt-2">
                    {detail.rehire_eligible ? (
                      <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/40">Rehire Eligible</Badge>
                    ) : (
                      <Badge variant="outline" className="bg-rose-500/10 text-rose-400 border-rose-500/40">Not Eligible for Rehire</Badge>
                    )}
                    {detail.rehire_eligible_notes && <span className="text-xs text-muted-foreground">{detail.rehire_eligible_notes}</span>}
                  </div>
                </CardContent>
              </Card>

              <DialogFooter className="gap-2 flex-wrap">
                {detail.status !== "settled" && detail.status !== "cancelled" && (
                  <>
                    <Button variant="outline" onClick={() => handleCancel(detail)}>
                      <X className="h-4 w-4 mr-1" /> Cancel Exit
                    </Button>
                    <Button onClick={() => { setSettleForm({ settled_date: todayISO(), payment_method: detail.payment_method || "cash", bank_account_id: detail.bank_account_id || null }); setSettleOpen(true); }}>
                      <Wallet className="h-4 w-4 mr-1" /> Settle & Close
                    </Button>
                  </>
                )}
                {detail.status === "settled" && (
                  <div className="text-sm text-muted-foreground">
                    Settled on <strong>{detail.settled_date}</strong> via {detail.payment_method}
                    {detail.bank_account_name ? ` (${detail.bank_account_name})` : ""}
                  </div>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Add Clearance Item Dialog */}
      <Dialog open={addItemOpen} onOpenChange={setAddItemOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Clearance Item</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Department</Label>
              <Select value={newItem.department} onValueChange={(v) => setNewItem({ ...newItem, department: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["HR", "IT", "Accounts", "Admin", "Sales", "Warehouse", "Other"].map((d) => (
                    <SelectItem key={d} value={d}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Item</Label>
              <Input value={newItem.item} onChange={(e) => setNewItem({ ...newItem, item: e.target.value })} placeholder="e.g. Return company vehicle" />
            </div>
            <div>
              <Label>Remarks</Label>
              <Textarea rows={2} value={newItem.remarks} onChange={(e) => setNewItem({ ...newItem, remarks: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddItemOpen(false)}>Cancel</Button>
            <Button onClick={addClearanceItem}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Settle Dialog */}
      <Dialog open={settleOpen} onOpenChange={setSettleOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Settle Final Payment</DialogTitle></DialogHeader>
          {detail && (
            <div className="space-y-3">
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded p-3 text-center">
                <div className="text-xs text-muted-foreground">Net Payable</div>
                <div className="text-2xl font-bold text-emerald-400">{formatCurrency(num(detail.net_payable))}</div>
              </div>
              <div>
                <Label>Settlement Date</Label>
                <Input type="date" value={settleForm.settled_date} onChange={(e) => setSettleForm({ ...settleForm, settled_date: e.target.value })} />
              </div>
              <div>
                <Label>Payment Method</Label>
                <Select value={settleForm.payment_method} onValueChange={(v) => setSettleForm({ ...settleForm, payment_method: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="bank">Bank Transfer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {settleForm.payment_method === "bank" && (
                <div>
                  <Label>Bank Account</Label>
                  <Select value={settleForm.bank_account_id || ""} onValueChange={(v) => setSettleForm({ ...settleForm, bank_account_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Select bank…" /></SelectTrigger>
                    <SelectContent>
                      {banks.map((b) => <SelectItem key={b.id} value={b.id}>{b.account_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                The employee will be marked <strong>{detail.exit_type === "termination" ? "terminated" : "inactive"}</strong> upon settlement.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettleOpen(false)}>Cancel</Button>
            <Button onClick={handleSettle}>Confirm Settlement</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ============================ small components ============================ */

function KpiCard({ label, count, amount, tone }: { label: string; count: number; amount: number; tone: "amber" | "emerald" | "sky" | "slate" }) {
  const toneMap = {
    amber: "border-amber-500/30 bg-amber-500/5",
    emerald: "border-emerald-500/30 bg-emerald-500/5",
    sky: "border-sky-500/30 bg-sky-500/5",
    slate: "border-slate-500/30 bg-slate-500/5",
  };
  return (
    <Card className={toneMap[tone]}>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="flex items-baseline justify-between mt-1">
          <div className="text-2xl font-bold">{count}</div>
          <div className="text-sm font-medium text-foreground">{formatCurrency(amount)}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function Mini({ label, value }: { label: string; value: any }) {
  return (
    <div className="border border-border/50 rounded px-3 py-2 bg-muted/20">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-medium mt-0.5">{value}</div>
    </div>
  );
}

function SettleField({
  label, field, detail, editing, editForm, setEditForm, sign,
}: {
  label: string; field: keyof EmployeeExit; detail: EmployeeExit; editing: boolean;
  editForm: Partial<EmployeeExit>; setEditForm: (v: Partial<EmployeeExit>) => void; sign: "+" | "-";
}) {
  const cur = (editForm as any)[field] ?? (detail as any)[field] ?? 0;
  return (
    <div className="border border-border/50 rounded px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      {editing ? (
        <Input
          type="number"
          step="0.01"
          className="h-7 mt-1 text-sm"
          value={cur}
          onChange={(e) => setEditForm({ ...editForm, [field]: Number(e.target.value) as any })}
        />
      ) : (
        <div className={`text-sm font-medium mt-0.5 ${sign === "+" ? "text-foreground" : "text-rose-400"}`}>
          {sign} {formatCurrency(num((detail as any)[field]))}
        </div>
      )}
    </div>
  );
}

function groupBy<T>(arr: T[], fn: (x: T) => string): Record<string, T[]> {
  return arr.reduce((acc, x) => {
    const k = fn(x);
    (acc[k] = acc[k] || []).push(x);
    return acc;
  }, {} as Record<string, T[]>);
}
