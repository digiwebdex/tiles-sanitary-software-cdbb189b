import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Users, Check, X } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

async function vpsJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await vpsAuthedFetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as any)?.error || `Request failed (${res.status})`);
  return body as T;
}

// Every feature the Super Admin can enable/disable per package. Keep in sync
// with backend FEATURE_FLAGS. Grouped only for readability in the dialog.
const FEATURE_DEFS: { key: string; label: string }[] = [
  { key: "pos_enabled", label: "POS (Point of Sale)" },
  { key: "quotations_enabled", label: "Quotations" },
  { key: "leads_enabled", label: "Leads / CRM" },
  { key: "projects_enabled", label: "Projects" },
  { key: "backorders_enabled", label: "Backorders" },
  { key: "barcode_enabled", label: "Barcode" },
  { key: "hrm_enabled", label: "HRM / Payroll" },
  { key: "campaigns_enabled", label: "Campaigns (SMS/WhatsApp/Referrals)" },
  { key: "portal_enabled", label: "Customer Portal" },
  { key: "advanced_finance_enabled", label: "Advanced Finance (Journal, EMI, Directors)" },
  { key: "advanced_reports_enabled", label: "Advanced Reports" },
  { key: "email_enabled", label: "Email Notifications" },
  { key: "sms_enabled", label: "SMS Notifications" },
  { key: "whatsapp_enabled", label: "WhatsApp" },
  { key: "daily_summary_enabled", label: "Daily Summary" },
];

// Capacity limits. `def` is the value used for new plans / when missing.
const LIMIT_DEFS: { key: string; label: string; def: number; min: number }[] = [
  { key: "max_users", label: "Max Users", def: 1, min: 1 },
  { key: "max_staff_users", label: "Max Staff Users", def: 0, min: 0 },
  { key: "max_branches", label: "Max Branches", def: 0, min: 0 },
  { key: "max_warehouses", label: "Max Warehouses", def: 0, min: 0 },
];

interface PlanForm {
  name: string;
  monthly_price: string;
  yearly_price: string;
  is_active: boolean;
  flags: Record<string, boolean>;
  limits: Record<string, string>;
}

const emptyForm: PlanForm = {
  name: "",
  monthly_price: "0",
  yearly_price: "0",
  is_active: true,
  flags: Object.fromEntries(FEATURE_DEFS.map((f) => [f.key, false])),
  limits: Object.fromEntries(LIMIT_DEFS.map((l) => [l.key, String(l.def)])),
};

const PlanManagement = () => {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<PlanForm>(emptyForm);

  const { data: plans = [], isLoading } = useQuery({
    queryKey: ["admin-subscription-plans"],
    queryFn: async () => {
      const body = await vpsJson<{ plans: any[] }>("/api/plans");
      return body.plans ?? [];
    },
  });

  const upsertMutation = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Plan name is required");
      const payload: Record<string, any> = {
        name: form.name,
        monthly_price: Number(form.monthly_price) || 0,
        yearly_price: Number(form.yearly_price) || 0,
        is_active: form.is_active,
      };
      for (const f of FEATURE_DEFS) payload[f.key] = !!form.flags[f.key];
      for (const l of LIMIT_DEFS) payload[l.key] = Number(form.limits[l.key]) || l.def;
      if (editId) {
        await vpsJson(`/api/plans/${editId}`, { method: "PATCH", body: JSON.stringify(payload) });
      } else {
        await vpsJson(`/api/plans`, { method: "POST", body: JSON.stringify(payload) });
      }
    },
    onSuccess: () => {
      toast({ title: editId ? "Plan updated" : "Plan created" });
      qc.invalidateQueries({ queryKey: ["admin-subscription-plans"] });
      closeDialog();
    },
    onError: (e: Error) => {
      toast({ variant: "destructive", title: "Error", description: e.message });
    },
  });

  const closeDialog = () => {
    setDialogOpen(false);
    setEditId(null);
    setForm(emptyForm);
  };

  const openCreate = () => {
    setEditId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (plan: any) => {
    setEditId(plan.id);
    setForm({
      name: plan.name,
      monthly_price: String(plan.monthly_price),
      yearly_price: String(plan.yearly_price),
      is_active: plan.is_active,
      flags: Object.fromEntries(FEATURE_DEFS.map((f) => [f.key, !!plan[f.key]])),
      limits: Object.fromEntries(LIMIT_DEFS.map((l) => [l.key, String(plan[l.key] ?? l.def)])),
    });
    setDialogOpen(true);
  };

  const FeatureIcon = ({ enabled }: { enabled: boolean }) =>
    enabled ? (
      <Check className="h-4 w-4 text-green-500" />
    ) : (
      <X className="h-4 w-4 text-muted-foreground/40" />
    );

  // Count of enabled features shown in the table for a quick overview.
  const enabledCount = (p: any) => FEATURE_DEFS.filter((f) => !!p[f.key]).length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Plan Management</CardTitle>
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-1 h-4 w-4" /> Add Plan
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : (
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Monthly (৳)</TableHead>
                  <TableHead>Yearly (৳)</TableHead>
                  <TableHead className="text-center">
                    <div className="flex items-center justify-center gap-1">
                      <Users className="h-3.5 w-3.5" /> Users
                    </div>
                  </TableHead>
                  <TableHead className="text-center">Quotations</TableHead>
                  <TableHead className="text-center">Features on</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="w-20">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plans.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground">
                      No plans created yet
                    </TableCell>
                  </TableRow>
                ) : (
                  plans.map((p: any) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell>{formatCurrency(p.monthly_price)}</TableCell>
                      <TableCell>{formatCurrency(p.yearly_price)}</TableCell>
                      <TableCell className="text-center">{p.max_users}</TableCell>
                      <TableCell className="text-center">
                        <div className="flex justify-center"><FeatureIcon enabled={!!p.quotations_enabled} /></div>
                      </TableCell>
                      <TableCell className="text-center text-muted-foreground">
                        {enabledCount(p)}/{FEATURE_DEFS.length}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant={p.is_active ? "default" : "secondary"} className="text-xs">
                          {p.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openEdit(p)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? "Edit Plan" : "Create Plan"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Plan Name *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Starter, Pro, Business" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Monthly Price (৳)</Label>
                <Input type="number" value={form.monthly_price} onChange={(e) => setForm({ ...form, monthly_price: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Yearly Price (৳)</Label>
                <Input type="number" value={form.yearly_price} onChange={(e) => setForm({ ...form, yearly_price: e.target.value })} />
              </div>
            </div>

            {/* Capacity limits */}
            <div className="grid grid-cols-2 gap-4 pt-2 border-t">
              {LIMIT_DEFS.map((l) => (
                <div className="space-y-2" key={l.key}>
                  <Label>{l.label}</Label>
                  <Input
                    type="number"
                    min={l.min}
                    value={form.limits[l.key] ?? ""}
                    onChange={(e) => setForm({ ...form, limits: { ...form.limits, [l.key]: e.target.value } })}
                  />
                </div>
              ))}
            </div>

            {/* Feature toggles — enable/disable each per package */}
            <div className="space-y-3 pt-2 border-t">
              <Label className="text-sm font-semibold">Features (enable / disable per package)</Label>
              <div className="grid grid-cols-1 gap-2">
                {FEATURE_DEFS.map((f) => (
                  <div className="flex items-center justify-between" key={f.key}>
                    <Label className="font-normal">{f.label}</Label>
                    <Switch
                      checked={!!form.flags[f.key]}
                      onCheckedChange={(v) => setForm({ ...form, flags: { ...form.flags, [f.key]: v } })}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t">
              <Label className="font-normal">Plan Active</Label>
              <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button onClick={() => upsertMutation.mutate()} disabled={upsertMutation.isPending}>
              {editId ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default PlanManagement;
