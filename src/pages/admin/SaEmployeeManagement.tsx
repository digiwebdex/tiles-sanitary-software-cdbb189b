import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";
import type { SaEmployeePermissions } from "@/lib/vpsAuthClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserPlus, MoreHorizontal, KeyRound, ShieldCheck, ShieldOff, Pencil } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

// ── Types ──────────────────────────────────────────────────────────────────
interface SaEmployee {
  id: string;
  email: string;
  status: "active" | "inactive";
  created_at: string;
  name: string | null;
  phone: string | null;
  designation: string | null;
  notes: string | null;
  can_manage_dealers: boolean;
  can_manage_subscriptions: boolean;
  can_view_financials: boolean;
  can_send_reminders: boolean;
  can_view_audit_log: boolean;
  can_manage_announcements: boolean;
  can_view_dealer_users: boolean;
}

type PermKey = keyof SaEmployeePermissions;

const PERM_LABELS: { key: PermKey; label: string; description: string }[] = [
  { key: "can_manage_dealers",       label: "Manage Dealers",       description: "Create, edit, activate & suspend dealer accounts" },
  { key: "can_manage_subscriptions", label: "Manage Subscriptions", description: "Assign plans, record payments, extend subscriptions" },
  { key: "can_view_financials",      label: "View Financials",       description: "View subscription payment history & revenue data" },
  { key: "can_send_reminders",       label: "Send Reminders",        description: "Manually trigger expiry reminder notifications" },
  { key: "can_view_audit_log",       label: "View Audit Log",        description: "Read the Super Admin audit trail" },
  { key: "can_manage_announcements", label: "Manage Announcements",  description: "Create & broadcast system-wide announcements" },
  { key: "can_view_dealer_users",    label: "View Dealer Users",     description: "View users inside dealer accounts (read-only)" },
];

const DEFAULT_PERMS: Record<PermKey, boolean> = {
  designation: false as any,  // not boolean but typed below
  can_manage_dealers: false,
  can_manage_subscriptions: false,
  can_view_financials: false,
  can_send_reminders: false,
  can_view_audit_log: false,
  can_manage_announcements: false,
  can_view_dealer_users: false,
};

// ── API helpers ────────────────────────────────────────────────────────────
async function fetchEmployees(): Promise<SaEmployee[]> {
  const res = await vpsAuthedFetch("/api/sa/employees");
  if (!res.ok) throw new Error("Failed to load employees");
  const data = await res.json();
  return data.employees;
}

async function createEmployee(body: object): Promise<{ tempPassword: string }> {
  const res = await vpsAuthedFetch("/api/sa/employees", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to create employee");
  return data;
}

async function updateEmployee(id: string, body: object): Promise<void> {
  const res = await vpsAuthedFetch(`/api/sa/employees/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error ?? "Failed to update employee");
  }
}

async function deactivateEmployee(id: string): Promise<void> {
  const res = await vpsAuthedFetch(`/api/sa/employees/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error ?? "Failed to deactivate employee");
  }
}

async function resetPassword(id: string): Promise<{ tempPassword: string }> {
  const res = await vpsAuthedFetch(`/api/sa/employees/${id}/reset-password`, { method: "POST" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to reset password");
  return data;
}

// ── Component ──────────────────────────────────────────────────────────────
export default function SaEmployeeManagement() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<SaEmployee | null>(null);

  const { data: employees = [], isLoading } = useQuery({
    queryKey: ["sa-employees"],
    queryFn: fetchEmployees,
  });

  const createMut = useMutation({
    mutationFn: createEmployee,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["sa-employees"] });
      setShowCreate(false);
      toast.success(`Employee created! Temp password: ${data.tempPassword}`, { duration: 15000 });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) => updateEmployee(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sa-employees"] });
      setEditTarget(null);
      toast.success("Employee updated");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deactivateMut = useMutation({
    mutationFn: deactivateEmployee,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sa-employees"] });
      toast.success("Employee deactivated");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const resetMut = useMutation({
    mutationFn: resetPassword,
    onSuccess: (data) => {
      toast.success(`New temp password: ${data.tempPassword}`, { duration: 15000 });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const activateMut = useMutation({
    mutationFn: (id: string) => updateEmployee(id, { status: "active" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sa-employees"] });
      toast.success("Employee activated");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="space-y-4 pt-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            Create accounts for your sales, support, and finance staff to manage dealers.
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)} size="sm">
          <UserPlus className="h-4 w-4 mr-1.5" /> Add Employee
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground text-center py-8">Loading…</p>
      ) : employees.length === 0 ? (
        <div className="border rounded-lg p-10 text-center">
          <ShieldCheck className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No employee accounts yet.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Add your first team member to help manage dealers and subscriptions.
          </p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name / Email</TableHead>
                <TableHead>Designation</TableHead>
                <TableHead>Permissions</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {employees.map((emp) => (
                <TableRow key={emp.id}>
                  <TableCell>
                    <p className="font-medium text-sm">{emp.name ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">{emp.email}</p>
                    {emp.phone && <p className="text-xs text-muted-foreground">{emp.phone}</p>}
                  </TableCell>
                  <TableCell className="text-sm">{emp.designation ?? "—"}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {PERM_LABELS.filter((p) => emp[p.key as keyof SaEmployee]).map((p) => (
                        <Badge key={p.key} variant="secondary" className="text-xs py-0">
                          {p.label}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={emp.status === "active" ? "default" : "outline"} className="text-xs">
                      {emp.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {format(new Date(emp.created_at), "dd MMM yyyy")}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setEditTarget(emp)}>
                          <Pencil className="h-3.5 w-3.5 mr-2" /> Edit & Permissions
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => resetMut.mutate(emp.id)}>
                          <KeyRound className="h-3.5 w-3.5 mr-2" /> Reset Password
                        </DropdownMenuItem>
                        {emp.status === "active" ? (
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => {
                              if (confirm(`Deactivate ${emp.email}?`)) deactivateMut.mutate(emp.id);
                            }}
                          >
                            <ShieldOff className="h-3.5 w-3.5 mr-2" /> Deactivate
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onClick={() => activateMut.mutate(emp.id)}>
                            <ShieldCheck className="h-3.5 w-3.5 mr-2" /> Reactivate
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create Employee Dialog */}
      <CreateEmployeeDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSubmit={(data) => createMut.mutate(data)}
        loading={createMut.isPending}
      />

      {/* Edit Employee Dialog */}
      {editTarget && (
        <EditEmployeeDialog
          employee={editTarget}
          onClose={() => setEditTarget(null)}
          onSubmit={(data) => updateMut.mutate({ id: editTarget.id, body: data })}
          loading={updateMut.isPending}
        />
      )}
    </div>
  );
}

// ── Create Dialog ──────────────────────────────────────────────────────────
function CreateEmployeeDialog({
  open, onClose, onSubmit, loading,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: object) => void;
  loading: boolean;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [designation, setDesignation] = useState("");
  const [perms, setPerms] = useState<Record<string, boolean>>({
    can_manage_dealers: false,
    can_manage_subscriptions: false,
    can_view_financials: false,
    can_send_reminders: false,
    can_view_audit_log: false,
    can_manage_announcements: false,
    can_view_dealer_users: false,
  });

  const toggle = (k: string) => setPerms((p) => ({ ...p, [k]: !p[k] }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      name, email, phone: phone || null,
      designation: designation || null,
      permissions: perms,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add SA Employee</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1">
              <Label>Full Name *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="col-span-2 space-y-1">
              <Label>Email *</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label>Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+880..." />
            </div>
            <div className="space-y-1">
              <Label>Designation</Label>
              <Input value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="Sales Manager" />
            </div>
          </div>

          <div className="border rounded-lg p-3 space-y-3 bg-muted/30">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Access Permissions</p>
            {PERM_LABELS.map((p) => (
              <div key={p.key} className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{p.label}</p>
                  <p className="text-xs text-muted-foreground">{p.description}</p>
                </div>
                <Switch
                  checked={!!perms[p.key]}
                  onCheckedChange={() => toggle(p.key)}
                />
              </div>
            ))}
          </div>

          <p className="text-xs text-muted-foreground bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded p-2">
            A temporary password will be generated and emailed to the new employee.
          </p>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={loading}>{loading ? "Creating…" : "Create Employee"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit Dialog ────────────────────────────────────────────────────────────
function EditEmployeeDialog({
  employee, onClose, onSubmit, loading,
}: {
  employee: SaEmployee;
  onClose: () => void;
  onSubmit: (data: object) => void;
  loading: boolean;
}) {
  const [name, setName] = useState(employee.name ?? "");
  const [phone, setPhone] = useState(employee.phone ?? "");
  const [designation, setDesignation] = useState(employee.designation ?? "");
  const [notes, setNotes] = useState(employee.notes ?? "");
  const [perms, setPerms] = useState<Record<string, boolean>>({
    can_manage_dealers: employee.can_manage_dealers,
    can_manage_subscriptions: employee.can_manage_subscriptions,
    can_view_financials: employee.can_view_financials,
    can_send_reminders: employee.can_send_reminders,
    can_view_audit_log: employee.can_view_audit_log,
    can_manage_announcements: employee.can_manage_announcements,
    can_view_dealer_users: employee.can_view_dealer_users,
  });

  const toggle = (k: string) => setPerms((p) => ({ ...p, [k]: !p[k] }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      name: name || undefined,
      phone: phone || null,
      designation: designation || null,
      notes: notes || null,
      permissions: perms,
    });
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Employee — {employee.email}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1">
              <Label>Full Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Designation</Label>
              <Input value={designation} onChange={(e) => setDesignation(e.target.value)} />
            </div>
            <div className="col-span-2 space-y-1">
              <Label>Internal Notes</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes about this employee…" />
            </div>
          </div>

          <div className="border rounded-lg p-3 space-y-3 bg-muted/30">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Access Permissions</p>
            {PERM_LABELS.map((p) => (
              <div key={p.key} className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{p.label}</p>
                  <p className="text-xs text-muted-foreground">{p.description}</p>
                </div>
                <Switch
                  checked={!!perms[p.key]}
                  onCheckedChange={() => toggle(p.key)}
                />
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={loading}>{loading ? "Saving…" : "Save Changes"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
