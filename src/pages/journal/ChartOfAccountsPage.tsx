import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDealerId } from "@/hooks/useDealerId";
import {
  glAccountService, type GlAccount, type GlAccountType, type NormalBalance,
} from "@/services/glAccountService";
import { toast } from "@/hooks/use-toast";
import { Plus, Landmark, Sprout, Pencil } from "lucide-react";

const ACCOUNT_TYPES: GlAccountType[] = ["asset", "liability", "equity", "income", "expense"];

const emptyForm = () => ({
  code: "", name: "", account_type: "asset" as GlAccountType,
  parent_code: "", normal_balance: "" as "" | NormalBalance,
  is_contra: false, is_group: false, category: "",
});

const ChartOfAccountsPage = () => {
  const dealerId = useDealerId();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<GlAccount | null>(null);
  const [form, setForm] = useState(emptyForm());

  const { data, isLoading } = useQuery({
    queryKey: ["gl-accounts", dealerId],
    queryFn: () => glAccountService.list(dealerId!),
    enabled: !!dealerId,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["gl-accounts"] });

  const seedMutation = useMutation({
    mutationFn: () => glAccountService.seedDefaults(dealerId!),
    onSuccess: (res) => { toast({ title: `Default chart seeded (${res.count} accounts)` }); invalidate(); },
    onError: (e: any) => toast({ title: "Seed failed", description: e?.message, variant: "destructive" }),
  });

  const resetForm = () => { setOpen(false); setEditing(null); setForm(emptyForm()); };

  const openCreate = () => { setEditing(null); setForm(emptyForm()); setOpen(true); };

  const openEdit = (a: GlAccount) => {
    setEditing(a);
    setForm({
      code: a.code, name: a.name, account_type: a.account_type,
      parent_code: a.parent_code ?? "", normal_balance: a.normal_balance,
      is_contra: a.is_contra, is_group: a.is_group, category: a.category ?? "",
    });
    setOpen(true);
  };

  const createMutation = useMutation({
    mutationFn: () => glAccountService.create(dealerId!, {
      code: form.code.trim(),
      name: form.name.trim(),
      account_type: form.account_type,
      parent_code: form.parent_code.trim() || null,
      normal_balance: form.normal_balance || undefined,
      is_contra: form.is_contra,
      is_group: form.is_group,
      category: form.category.trim() || null,
    }),
    onSuccess: () => { toast({ title: "Account created" }); resetForm(); invalidate(); },
    onError: (e: any) => toast({ title: "Create failed", description: e?.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: () => glAccountService.update(dealerId!, editing!.id, {
      name: form.name.trim(),
      parent_code: form.parent_code.trim() || null,
      category: form.category.trim() || null,
      normal_balance: form.normal_balance || undefined,
      is_contra: form.is_contra,
      is_group: form.is_group,
    }),
    onSuccess: () => { toast({ title: "Account updated" }); resetForm(); invalidate(); },
    onError: (e: any) => toast({ title: "Update failed", description: e?.message, variant: "destructive" }),
  });

  const handleSave = () => {
    if (!form.name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    if (editing) updateMutation.mutate();
    else {
      if (!form.code.trim()) { toast({ title: "Code is required", variant: "destructive" }); return; }
      createMutation.mutate();
    }
  };

  const rows = data?.rows ?? [];
  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="container mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Landmark className="h-6 w-6" /> Chart of Accounts</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending}>
            <Sprout className="h-4 w-4 mr-2" /> {seedMutation.isPending ? "Seeding…" : "Seed Default Chart"}
          </Button>
          <Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" /> New Account</Button>
        </div>
      </div>

      {data && (
        <div className="flex gap-2 text-sm text-muted-foreground">
          <Badge variant={data.gl_spine_enabled ? "default" : "secondary"}>GL Spine: {data.gl_spine_enabled ? "Active" : "Off"}</Badge>
          <Badge variant={data.posting_engine_enabled ? "default" : "secondary"}>Posting Engine: {data.posting_engine_enabled ? "Active" : "Off"}</Badge>
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>Accounts ({rows.length})</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? <p>Loading…</p> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Parent</TableHead>
                  <TableHead>Normal Bal.</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Flags</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono">{a.code}</TableCell>
                    <TableCell className={a.is_group ? "font-semibold" : ""}>{a.name}</TableCell>
                    <TableCell className="capitalize">{a.account_type}</TableCell>
                    <TableCell className="font-mono text-muted-foreground">{a.parent_code || "—"}</TableCell>
                    <TableCell className="capitalize">{a.normal_balance}</TableCell>
                    <TableCell className="text-muted-foreground">{a.category || "—"}</TableCell>
                    <TableCell className="space-x-1">
                      {a.is_system && <Badge variant="secondary">System</Badge>}
                      {a.is_group && <Badge variant="outline">Group</Badge>}
                      {a.is_contra && <Badge variant="outline">Contra</Badge>}
                    </TableCell>
                    <TableCell>
                      <Button size="icon" variant="ghost" onClick={() => openEdit(a)}><Pencil className="h-4 w-4" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!rows.length && (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">No accounts yet — seed the default chart to get started.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={(v) => { if (!v) resetForm(); else setOpen(true); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Account" : "New Account"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Code</Label>
                <Input value={form.code} disabled={!!editing} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="e.g. 1320" />
              </div>
              <div>
                <Label>Account Type</Label>
                <Select value={form.account_type} onValueChange={(v: any) => setForm({ ...form, account_type: v })} disabled={!!editing}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ACCOUNT_TYPES.map(t => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Office Equipment" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Parent Code (optional)</Label><Input value={form.parent_code} onChange={e => setForm({ ...form, parent_code: e.target.value })} placeholder="e.g. 1300" /></div>
              <div><Label>Category (optional)</Label><Input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="e.g. Fixed Assets" /></div>
            </div>
            <div>
              <Label>Normal Balance (optional override)</Label>
              <Select value={form.normal_balance || "auto"} onValueChange={(v: any) => setForm({ ...form, normal_balance: v === "auto" ? "" : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto (based on type)</SelectItem>
                  <SelectItem value="debit">Debit</SelectItem>
                  <SelectItem value="credit">Credit</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="is_group">Group account (non-postable header)</Label>
              <Switch id="is_group" checked={form.is_group} onCheckedChange={(v) => setForm({ ...form, is_group: v })} />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="is_contra">Contra account</Label>
              <Switch id="is_contra" checked={form.is_contra} onCheckedChange={(v) => setForm({ ...form, is_contra: v })} />
            </div>
            {editing?.is_system && (
              <p className="text-xs text-muted-foreground">System account: only name, parent, category are editable.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetForm} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ChartOfAccountsPage;
