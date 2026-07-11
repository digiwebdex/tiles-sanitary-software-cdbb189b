/**
 * Cost Centers & Departments — V2 Sprint 6D.
 * Two tabs over the two new org-structure entities. Reuses the existing
 * Branches list (Phase 8) for cost-center branch mapping — no new branch UI.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useDealerId } from "@/hooks/useDealerId";
import { costCenterService, type CostCenter, type CostCenterReport } from "@/services/costCenterService";
import { departmentService, type Department } from "@/services/departmentService";
import { toast } from "@/hooks/use-toast";
import { Plus, Building2, Pencil, Trash2, BarChart3 } from "lucide-react";

const emptyCcForm = () => ({ code: "", name: "", parent_id: "", department_id: "", branch_id: "", notes: "" });
const emptyDeptForm = () => ({ code: "", name: "" });

const CostCentersPage = () => {
  const dealerId = useDealerId();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"cost-centers" | "departments">("cost-centers");

  const { data: ccData, isLoading: ccLoading } = useQuery({
    queryKey: ["cost-centers", dealerId],
    queryFn: () => costCenterService.list(dealerId!),
    enabled: !!dealerId,
  });
  const { data: deptData, isLoading: deptLoading } = useQuery({
    queryKey: ["departments", dealerId],
    queryFn: () => departmentService.list(dealerId!),
    enabled: !!dealerId,
  });

  const costCenters = ccData?.rows ?? [];
  const departments = deptData?.rows ?? [];

  // ── Cost Center dialog ──
  const [ccOpen, setCcOpen] = useState(false);
  const [ccEditing, setCcEditing] = useState<CostCenter | null>(null);
  const [ccForm, setCcForm] = useState(emptyCcForm());

  const resetCcForm = () => { setCcOpen(false); setCcEditing(null); setCcForm(emptyCcForm()); };
  const openCcCreate = () => { setCcEditing(null); setCcForm(emptyCcForm()); setCcOpen(true); };
  const openCcEdit = (c: CostCenter) => {
    setCcEditing(c);
    setCcForm({
      code: c.code, name: c.name, parent_id: c.parent_id ?? "",
      department_id: c.department_id ?? "", branch_id: c.branch_id ?? "", notes: c.notes ?? "",
    });
    setCcOpen(true);
  };

  const ccCreateMutation = useMutation({
    mutationFn: () => costCenterService.create(dealerId!, {
      code: ccForm.code.trim(), name: ccForm.name.trim(),
      parent_id: ccForm.parent_id || null, department_id: ccForm.department_id || null,
      branch_id: ccForm.branch_id || null, notes: ccForm.notes.trim() || null,
    }),
    onSuccess: () => { toast({ title: "Cost center created" }); resetCcForm(); qc.invalidateQueries({ queryKey: ["cost-centers"] }); },
    onError: (e: any) => toast({ title: "Create failed", description: e?.message, variant: "destructive" }),
  });
  const ccUpdateMutation = useMutation({
    mutationFn: () => costCenterService.update(dealerId!, ccEditing!.id, {
      name: ccForm.name.trim(), department_id: ccForm.department_id || null,
      branch_id: ccForm.branch_id || null, notes: ccForm.notes.trim() || null,
    }),
    onSuccess: () => { toast({ title: "Cost center updated" }); resetCcForm(); qc.invalidateQueries({ queryKey: ["cost-centers"] }); },
    onError: (e: any) => toast({ title: "Update failed", description: e?.message, variant: "destructive" }),
  });
  const ccDeleteMutation = useMutation({
    mutationFn: (id: string) => costCenterService.remove(dealerId!, id),
    onSuccess: () => { toast({ title: "Cost center deactivated" }); qc.invalidateQueries({ queryKey: ["cost-centers"] }); },
    onError: (e: any) => toast({ title: "Delete failed", description: e?.message, variant: "destructive" }),
  });

  const handleCcSave = () => {
    if (!ccForm.name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    if (ccEditing) ccUpdateMutation.mutate();
    else {
      if (!ccForm.code.trim()) { toast({ title: "Code is required", variant: "destructive" }); return; }
      ccCreateMutation.mutate();
    }
  };
  const ccSaving = ccCreateMutation.isPending || ccUpdateMutation.isPending;

  // ── Report dialog ──
  const [reportOpen, setReportOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState<CostCenter | null>(null);
  const [report, setReport] = useState<CostCenterReport | null>(null);
  const reportMutation = useMutation({
    mutationFn: (id: string) => costCenterService.report(dealerId!, id),
    onSuccess: (r) => setReport(r),
    onError: (e: any) => toast({ title: "Failed to load report", description: e?.message, variant: "destructive" }),
  });
  const openReport = (c: CostCenter) => {
    setReportTarget(c);
    setReport(null);
    setReportOpen(true);
    reportMutation.mutate(c.id);
  };

  // ── Department dialog ──
  const [deptOpen, setDeptOpen] = useState(false);
  const [deptEditing, setDeptEditing] = useState<Department | null>(null);
  const [deptForm, setDeptForm] = useState(emptyDeptForm());

  const resetDeptForm = () => { setDeptOpen(false); setDeptEditing(null); setDeptForm(emptyDeptForm()); };
  const openDeptCreate = () => { setDeptEditing(null); setDeptForm(emptyDeptForm()); setDeptOpen(true); };
  const openDeptEdit = (d: Department) => { setDeptEditing(d); setDeptForm({ code: d.code, name: d.name }); setDeptOpen(true); };

  const deptCreateMutation = useMutation({
    mutationFn: () => departmentService.create(dealerId!, { code: deptForm.code.trim(), name: deptForm.name.trim() }),
    onSuccess: () => { toast({ title: "Department created" }); resetDeptForm(); qc.invalidateQueries({ queryKey: ["departments"] }); },
    onError: (e: any) => toast({ title: "Create failed", description: e?.message, variant: "destructive" }),
  });
  const deptUpdateMutation = useMutation({
    mutationFn: () => departmentService.update(dealerId!, deptEditing!.id, { name: deptForm.name.trim() }),
    onSuccess: () => { toast({ title: "Department updated" }); resetDeptForm(); qc.invalidateQueries({ queryKey: ["departments"] }); },
    onError: (e: any) => toast({ title: "Update failed", description: e?.message, variant: "destructive" }),
  });
  const deptDeleteMutation = useMutation({
    mutationFn: (id: string) => departmentService.remove(dealerId!, id),
    onSuccess: () => { toast({ title: "Department deactivated" }); qc.invalidateQueries({ queryKey: ["departments"] }); },
    onError: (e: any) => toast({ title: "Delete failed", description: e?.message, variant: "destructive" }),
  });

  const handleDeptSave = () => {
    if (!deptForm.name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    if (deptEditing) deptUpdateMutation.mutate();
    else {
      if (!deptForm.code.trim()) { toast({ title: "Code is required", variant: "destructive" }); return; }
      deptCreateMutation.mutate();
    }
  };
  const deptSaving = deptCreateMutation.isPending || deptUpdateMutation.isPending;

  return (
    <div className="container mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Building2 className="h-6 w-6" /> Cost Centers &amp; Departments</h1>
        {tab === "cost-centers" ? (
          <Button onClick={openCcCreate}><Plus className="h-4 w-4 mr-2" /> New Cost Center</Button>
        ) : (
          <Button onClick={openDeptCreate}><Plus className="h-4 w-4 mr-2" /> New Department</Button>
        )}
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="cost-centers">Cost Centers</TabsTrigger>
          <TabsTrigger value="departments">Departments</TabsTrigger>
        </TabsList>

        <TabsContent value="cost-centers" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Cost Centers ({costCenters.length})</CardTitle></CardHeader>
            <CardContent>
              {ccLoading ? <p>Loading…</p> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Department</TableHead>
                      <TableHead>Branch</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-28"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {costCenters.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-mono">{c.code}</TableCell>
                        <TableCell>{c.name}</TableCell>
                        <TableCell className="text-muted-foreground">{c.department_name || "—"}</TableCell>
                        <TableCell className="text-muted-foreground">{c.branch_name || "—"}</TableCell>
                        <TableCell><Badge variant={c.is_active ? "default" : "secondary"}>{c.is_active ? "Active" : "Inactive"}</Badge></TableCell>
                        <TableCell className="space-x-1">
                          <Button size="icon" variant="ghost" onClick={() => openReport(c)} title="View report"><BarChart3 className="h-4 w-4" /></Button>
                          <Button size="icon" variant="ghost" onClick={() => openCcEdit(c)}><Pencil className="h-4 w-4" /></Button>
                          <Button size="icon" variant="ghost" onClick={() => ccDeleteMutation.mutate(c.id)}><Trash2 className="h-4 w-4" /></Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!costCenters.length && (
                      <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No cost centers yet.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="departments" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Departments ({departments.length})</CardTitle></CardHeader>
            <CardContent>
              {deptLoading ? <p>Loading…</p> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-20"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {departments.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell className="font-mono">{d.code}</TableCell>
                        <TableCell>{d.name}</TableCell>
                        <TableCell><Badge variant={d.is_active ? "default" : "secondary"}>{d.is_active ? "Active" : "Inactive"}</Badge></TableCell>
                        <TableCell className="space-x-1">
                          <Button size="icon" variant="ghost" onClick={() => openDeptEdit(d)}><Pencil className="h-4 w-4" /></Button>
                          <Button size="icon" variant="ghost" onClick={() => deptDeleteMutation.mutate(d.id)}><Trash2 className="h-4 w-4" /></Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!departments.length && (
                      <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No departments yet.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Cost Center dialog */}
      <Dialog open={ccOpen} onOpenChange={(v) => { if (!v) resetCcForm(); else setCcOpen(true); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{ccEditing ? "Edit Cost Center" : "New Cost Center"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Code</Label><Input value={ccForm.code} disabled={!!ccEditing} onChange={e => setCcForm({ ...ccForm, code: e.target.value })} placeholder="e.g. CC-SALES" /></div>
              <div><Label>Name</Label><Input value={ccForm.name} onChange={e => setCcForm({ ...ccForm, name: e.target.value })} placeholder="e.g. Sales Department" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Parent Cost Center (optional)</Label>
                <Select value={ccForm.parent_id || "none"} onValueChange={(v) => setCcForm({ ...ccForm, parent_id: v === "none" ? "" : v })} disabled={!!ccEditing}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {costCenters.filter(c => c.id !== ccEditing?.id).map(c => <SelectItem key={c.id} value={c.id}>{c.code} — {c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Department (optional)</Label>
                <Select value={ccForm.department_id || "none"} onValueChange={(v) => setCcForm({ ...ccForm, department_id: v === "none" ? "" : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Notes (optional)</Label><Textarea value={ccForm.notes} onChange={e => setCcForm({ ...ccForm, notes: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetCcForm} disabled={ccSaving}>Cancel</Button>
            <Button onClick={handleCcSave} disabled={ccSaving}>{ccSaving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Department dialog */}
      <Dialog open={deptOpen} onOpenChange={(v) => { if (!v) resetDeptForm(); else setDeptOpen(true); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{deptEditing ? "Edit Department" : "New Department"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Code</Label><Input value={deptForm.code} disabled={!!deptEditing} onChange={e => setDeptForm({ ...deptForm, code: e.target.value })} placeholder="e.g. DEPT-SALES" /></div>
            <div><Label>Name</Label><Input value={deptForm.name} onChange={e => setDeptForm({ ...deptForm, name: e.target.value })} placeholder="e.g. Sales" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetDeptForm} disabled={deptSaving}>Cancel</Button>
            <Button onClick={handleDeptSave} disabled={deptSaving}>{deptSaving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Report dialog */}
      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Report — {reportTarget?.name}</DialogTitle></DialogHeader>
          {reportMutation.isPending && <p>Loading…</p>}
          {report && (
            <div className="space-y-2">
              <p className="text-2xl font-bold">{report.total.toLocaleString()}</p>
              <p className="text-sm text-muted-foreground">{report.line_count} posted lines</p>
              <div className="space-y-1">
                {Object.entries(report.by_domain).map(([domain, amt]) => (
                  <div key={domain} className="flex justify-between text-sm border-b py-1">
                    <span className="capitalize">{domain}</span>
                    <span className={amt < 0 ? "text-destructive" : ""}>{amt.toLocaleString()}</span>
                  </div>
                ))}
                {!Object.keys(report.by_domain).length && <p className="text-muted-foreground text-sm">No activity yet.</p>}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CostCentersPage;
