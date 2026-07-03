/**
 * Super Admin → Dealers (VPS-backed).
 *
 * Lists every dealer from the self-hosted backend with their primary admin
 * user, plan, and subscription expiry. Pending sign-ups float to the top
 * with Approve / Reject actions; active dealers can be Suspended/Reactivated.
 *
 * All requests go through vpsAuthedFetch so the super_admin JWT travels
 * automatically and gets re-issued on 401 (the same single-flight refresh
 * used by the rest of the VPS data layer).
 */
import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2, XCircle, Ban, RefreshCw, Loader2, ExternalLink,
  KeyRound, Pencil, Trash2, Search, Store, Clock, ShieldOff, Users,
  Phone, Mail, MapPin, Globe, FileText, CreditCard, Building2, X,
} from "lucide-react";
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";
import { env } from "@/lib/env";
import { saImpersonation } from "@/lib/saImpersonation";
import EditDealerDialog from "./EditDealerDialog";
import CreateDealerDialog from "./CreateDealerDialog";
import { format } from "date-fns";

interface VpsDealer {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  email: string | null;
  owner_name: string | null;
  business_type: string | null;
  city: string | null;
  district: string | null;
  country: string | null;
  postal_code: string | null;
  tax_id: string | null;
  trade_license_no: string | null;
  website: string | null;
  logo_url: string | null;
  notes: string | null;
  status: string;
  created_at: string;
  admin_email: string | null;
  admin_name: string | null;
  admin_user_id: string | null;
  admin_status: string | null;
  subscription_status: string | null;
  subscription_end: string | null;
  plan_name: string | null;
}

async function vpsJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await vpsAuthedFetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
  return body as T;
}

const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "secondary",
  active: "default",
  suspended: "destructive",
  rejected: "outline",
};

// ── Stat card ────────────────────────────────────────────────────────────────
function StatCard({
  label, value, icon: Icon, color,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4 flex items-center gap-4">
      <div className={`h-10 w-10 rounded-full flex items-center justify-center ${color}`}>
        <Icon className="h-5 w-5 text-white" />
      </div>
      <div>
        <p className="text-2xl font-bold leading-none">{value}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
      </div>
    </div>
  );
}

// ── Dealer detail side-sheet ─────────────────────────────────────────────────
function DealerDetailSheet({
  dealer,
  onClose,
  onEdit,
  onOpenErp,
}: {
  dealer: VpsDealer | null;
  onClose: () => void;
  onEdit: (d: VpsDealer) => void;
  onOpenErp: (d: VpsDealer) => void;
}) {
  if (!dealer) return null;

  const infoRow = (icon: React.ElementType, label: string, value: string | null | undefined) => {
    if (!value) return null;
    const Icon = icon;
    return (
      <div className="flex items-start gap-2 text-sm">
        <Icon className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
        <span className="text-muted-foreground min-w-[90px] shrink-0">{label}</span>
        <span className="text-foreground break-all">{value}</span>
      </div>
    );
  };

  const sub_end = dealer.subscription_end
    ? (() => {
        try { return format(new Date(dealer.subscription_end), "dd MMM yyyy"); }
        catch { return dealer.subscription_end; }
      })()
    : null;

  const joined = (() => {
    try { return format(new Date(dealer.created_at), "dd MMM yyyy"); }
    catch { return dealer.created_at; }
  })();

  return (
    <Sheet open={!!dealer} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Building2 className="h-5 w-5 text-primary" />
              </div>
              <div>
                <SheetTitle className="text-base leading-tight">{dealer.name}</SheetTitle>
                <div className="mt-0.5">
                  <Badge variant={statusVariant[dealer.status] || "outline"} className="text-xs">
                    {dealer.status}
                  </Badge>
                </div>
              </div>
            </div>
          </div>
          <SheetDescription className="sr-only">Dealer account details</SheetDescription>
        </SheetHeader>

        <div className="space-y-5">
          {/* Quick actions */}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => onEdit(dealer)}>
              <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
            </Button>
            {(dealer.status === "active" || dealer.status === "suspended") && (
              <Button size="sm" variant="secondary" onClick={() => onOpenErp(dealer)}>
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Open ERP
              </Button>
            )}
          </div>

          <Separator />

          {/* Business info */}
          <section className="space-y-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Business</p>
            <div className="space-y-2">
              {infoRow(Store, "Type", dealer.business_type)}
              {infoRow(Phone, "Phone", dealer.phone)}
              {infoRow(Mail, "Email", dealer.email)}
              {infoRow(Globe, "Website", dealer.website)}
              {infoRow(FileText, "Tax / BIN", dealer.tax_id)}
              {infoRow(FileText, "Trade Lic.", dealer.trade_license_no)}
              {infoRow(MapPin, "Address", [dealer.address, dealer.city, dealer.district, dealer.country].filter(Boolean).join(", "))}
            </div>
          </section>

          <Separator />

          {/* Admin user */}
          <section className="space-y-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Primary Admin</p>
            <div className="space-y-2">
              {infoRow(Users, "Name", dealer.admin_name)}
              {infoRow(Mail, "Email", dealer.admin_email)}
              <div className="flex items-center gap-2 text-sm">
                <div className="h-3.5 w-3.5 shrink-0" />
                <span className="text-muted-foreground min-w-[90px]">Status</span>
                <Badge variant={dealer.admin_status === "active" ? "default" : "secondary"} className="text-xs">
                  {dealer.admin_status || "—"}
                </Badge>
              </div>
            </div>
          </section>

          <Separator />

          {/* Subscription */}
          <section className="space-y-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Subscription</p>
            <div className="space-y-2">
              {infoRow(CreditCard, "Plan", dealer.plan_name)}
              <div className="flex items-center gap-2 text-sm">
                <div className="h-3.5 w-3.5 shrink-0" />
                <span className="text-muted-foreground min-w-[90px]">Status</span>
                <Badge
                  variant={
                    dealer.subscription_status === "active" ? "default"
                    : dealer.subscription_status === "expired" ? "destructive"
                    : "secondary"
                  }
                  className="text-xs"
                >
                  {dealer.subscription_status || "No subscription"}
                </Badge>
              </div>
              {sub_end && infoRow(Clock, "Expires", sub_end)}
            </div>
          </section>

          <Separator />

          {/* Meta */}
          <section className="space-y-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Account</p>
            <div className="space-y-2">
              {infoRow(Clock, "Joined", joined)}
              <div className="flex items-start gap-2 text-sm font-mono">
                <div className="h-3.5 w-3.5 shrink-0" />
                <span className="text-muted-foreground min-w-[90px] shrink-0">ID</span>
                <span className="text-xs text-muted-foreground break-all">{dealer.id}</span>
              </div>
            </div>
          </section>

          {dealer.notes && (
            <>
              <Separator />
              <section className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Internal Notes</p>
                <p className="text-sm text-foreground whitespace-pre-wrap">{dealer.notes}</p>
              </section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
const VpsDealerManagement = () => {
  const { toast } = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState<{ action: string; dealer: VpsDealer } | null>(null);
  const [editing, setEditing] = useState<VpsDealer | null>(null);
  const [viewing, setViewing] = useState<VpsDealer | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VpsDealer | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [search, setSearch] = useState("");

  const openErp = (d: VpsDealer) => {
    saImpersonation.start(d.id, d.name, false);
    toast({ title: `Opening ERP as ${d.name}`, description: "Read-only by default. Toggle Edit mode in the banner to make changes." });
    navigate("/dashboard");
  };

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["vps-dealers"],
    queryFn: () => vpsJson<{ dealers: VpsDealer[] }>("/api/dealers"),
  });

  const allDealers = data?.dealers ?? [];

  // Stats
  const stats = useMemo(() => ({
    total:     allDealers.length,
    active:    allDealers.filter((d) => d.status === "active").length,
    pending:   allDealers.filter((d) => d.status === "pending").length,
    suspended: allDealers.filter((d) => d.status === "suspended").length,
  }), [allDealers]);

  // Search filter + sort (pending first)
  const dealers = useMemo(() => {
    const q = search.toLowerCase().trim();
    return allDealers
      .filter((d) =>
        !q ||
        d.name.toLowerCase().includes(q) ||
        (d.admin_email ?? "").toLowerCase().includes(q) ||
        (d.admin_name ?? "").toLowerCase().includes(q) ||
        (d.phone ?? "").includes(q) ||
        (d.district ?? "").toLowerCase().includes(q),
      )
      .slice()
      .sort((a, b) => {
        if (a.status === "pending" && b.status !== "pending") return -1;
        if (a.status !== "pending" && b.status === "pending") return 1;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
  }, [allDealers, search]);

  const decisionMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: string }) => {
      return vpsJson(`/api/dealers/${id}/${action}`, { method: "POST", body: JSON.stringify({}) });
    },
    onSuccess: (_res, vars) => {
      const verb = {
        approve: "approved", reject: "rejected",
        suspend: "suspended", reactivate: "reactivated",
      }[vars.action] || vars.action;
      toast({ title: `Dealer ${verb}` });
      qc.invalidateQueries({ queryKey: ["vps-dealers"] });
      setConfirm(null);
    },
    onError: (e: Error) => {
      toast({ variant: "destructive", title: "Action failed", description: e.message });
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async ({ dealer, mode }: { dealer: VpsDealer; mode: "temp" | "link" }) => {
      await vpsJson(`/api/dealers/${dealer.id}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ mode }),
      });
      return dealer;
    },
    onSuccess: (dealer) => {
      toast({
        title: "Password reset sent",
        description: `New credentials emailed to ${dealer.admin_email} and SMS sent to ${dealer.phone || "their phone"}.`,
      });
    },
    onError: (e: Error) => {
      toast({ variant: "destructive", title: "Reset failed", description: e.message });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async ({ dealer, confirmName }: { dealer: VpsDealer; confirmName: string }) => {
      return vpsJson(`/api/dealers/${dealer.id}?confirm=${encodeURIComponent(confirmName)}`, {
        method: "DELETE",
      });
    },
    onSuccess: (_res, vars) => {
      toast({
        title: "Dealer deleted",
        description: `${vars.dealer.name} and all associated data have been permanently removed.`,
      });
      qc.invalidateQueries({ queryKey: ["vps-dealers"] });
      setDeleteTarget(null);
      setDeleteConfirmText("");
    },
    onError: (e: Error) => {
      toast({ variant: "destructive", title: "Delete failed", description: e.message });
    },
  });

  if (env.AUTH_BACKEND !== "vps") {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          This page is connected to the self-hosted backend. Auth backend is currently
          set to <code>{env.AUTH_BACKEND}</code> — switch to <code>vps</code> to use it.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {/* ── Stat cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Total Dealers"    value={stats.total}     icon={Store}     color="bg-primary" />
        <StatCard label="Active"           value={stats.active}    icon={CheckCircle2} color="bg-emerald-500" />
        <StatCard label="Pending Approval" value={stats.pending}   icon={Clock}     color="bg-amber-500" />
        <StatCard label="Suspended"        value={stats.suspended} icon={ShieldOff} color="bg-destructive" />
      </div>

      {/* ── Table card ──────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
          <CardTitle className="text-base">
            All Dealers
            {search && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                — {dealers.length} result{dealers.length !== 1 ? "s" : ""}
              </span>
            )}
          </CardTitle>
          <div className="flex items-center gap-2 flex-1 justify-end">
            {/* Search */}
            <div className="relative max-w-xs w-full">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search name, email, phone…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-8 text-sm"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <CreateDealerDialog />
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {error && (
            <div className="mx-6 mb-4 rounded border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {(error as Error).message}
            </div>
          )}

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Business</TableHead>
                  <TableHead>Owner / Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8">
                      <Loader2 className="h-5 w-5 animate-spin inline text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : dealers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      {search ? "No dealers match your search." : "No dealers yet."}
                    </TableCell>
                  </TableRow>
                ) : (
                  dealers.map((d) => (
                    <TableRow key={d.id} className={d.status === "pending" ? "bg-amber-500/5" : ""}>
                      <TableCell>
                        <button
                          className="font-medium text-left hover:text-primary hover:underline underline-offset-2 transition-colors"
                          onClick={() => setViewing(d)}
                          title="View full dealer details"
                        >
                          {d.name}
                        </button>
                        {d.status === "pending" && (
                          <div className="text-xs text-amber-600 font-medium mt-0.5">⏳ Awaiting approval</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">{d.admin_name || "—"}</div>
                        <div className="text-xs text-muted-foreground">{d.admin_email || "—"}</div>
                      </TableCell>
                      <TableCell className="text-sm">{d.phone || "—"}</TableCell>
                      <TableCell className="text-sm">{d.plan_name || <span className="text-muted-foreground text-xs">No plan</span>}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {d.subscription_end
                          ? (() => {
                              try { return format(new Date(d.subscription_end), "dd MMM yyyy"); }
                              catch { return d.subscription_end; }
                            })()
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant[d.status] || "outline"} className="text-xs">
                          {d.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={() => setEditing(d)}>
                            <Pencil className="h-3 w-3 mr-1" /> Edit
                          </Button>

                          {d.status === "pending" && (
                            <>
                              <Button size="sm" className="h-7 text-xs px-2" onClick={() => setConfirm({ action: "approve", dealer: d })} disabled={decisionMutation.isPending}>
                                <CheckCircle2 className="h-3 w-3 mr-1" /> Approve
                              </Button>
                              <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={() => setConfirm({ action: "reject", dealer: d })} disabled={decisionMutation.isPending}>
                                <XCircle className="h-3 w-3 mr-1" /> Reject
                              </Button>
                            </>
                          )}

                          {(d.status === "active" || d.status === "suspended") && (
                            <Button size="sm" variant="secondary" className="h-7 text-xs px-2" onClick={() => openErp(d)}>
                              <ExternalLink className="h-3 w-3 mr-1" /> Open ERP
                            </Button>
                          )}

                          {d.status === "active" && (
                            <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={() => setConfirm({ action: "suspend", dealer: d })} disabled={decisionMutation.isPending}>
                              <Ban className="h-3 w-3 mr-1" /> Suspend
                            </Button>
                          )}

                          {d.status === "suspended" && (
                            <Button size="sm" className="h-7 text-xs px-2" onClick={() => setConfirm({ action: "reactivate", dealer: d })} disabled={decisionMutation.isPending}>
                              <CheckCircle2 className="h-3 w-3 mr-1" /> Reactivate
                            </Button>
                          )}

                          {(d.status === "active" || d.status === "suspended") && d.admin_email && (
                            <Button
                              size="sm" variant="outline" className="h-7 text-xs px-2"
                              onClick={() => {
                                if (window.confirm(`Reset password for ${d.name}?\n\nA new temporary password will be emailed to ${d.admin_email} and SMS-sent to ${d.phone || "the registered phone"}. All current sessions will be signed out.`)) {
                                  resetPasswordMutation.mutate({ dealer: d, mode: "temp" });
                                }
                              }}
                              disabled={resetPasswordMutation.isPending}
                            >
                              <KeyRound className="h-3 w-3 mr-1" /> Reset Password
                            </Button>
                          )}

                          <Button
                            size="sm" variant="outline"
                            className="h-7 text-xs px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => { setDeleteTarget(d); setDeleteConfirmText(""); }}
                            disabled={deleteMutation.isPending}
                          >
                            <Trash2 className="h-3 w-3 mr-1" /> Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Row count footer */}
          {!isLoading && dealers.length > 0 && (
            <div className="px-6 py-2.5 border-t text-xs text-muted-foreground">
              Showing {dealers.length} of {allDealers.length} dealer{allDealers.length !== 1 ? "s" : ""}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Dealer detail sheet ─────────────────────────────────────────── */}
      <DealerDetailSheet
        dealer={viewing}
        onClose={() => setViewing(null)}
        onEdit={(d) => { setViewing(null); setEditing(d); }}
        onOpenErp={(d) => { setViewing(null); openErp(d); }}
      />

      {/* ── Confirm action dialog ────────────────────────────────────────── */}
      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.action === "approve" && "Approve dealer?"}
              {confirm?.action === "reject" && "Reject dealer?"}
              {confirm?.action === "suspend" && "Suspend dealer?"}
              {confirm?.action === "reactivate" && "Reactivate dealer?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm && (
                <>
                  Business: <b>{confirm.dealer.name}</b>
                  <br />Owner: {confirm.dealer.admin_name || "—"} ({confirm.dealer.admin_email || "—"})
                  <br />Phone: {confirm.dealer.phone || "—"}
                  <br /><br />
                  {confirm.action === "approve" && "The dealer will be notified by SMS and email and will be able to log in immediately."}
                  {confirm.action === "reject" && "The dealer will receive a notification that their registration was not approved. They will not be able to log in."}
                  {confirm.action === "suspend" && "All active sessions will be revoked. The dealer cannot log in until reactivated."}
                  {confirm.action === "reactivate" && "The dealer will be able to log in again."}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={decisionMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirm && decisionMutation.mutate({ id: confirm.dealer.id, action: confirm.action })}
              disabled={decisionMutation.isPending}
            >
              {decisionMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Delete confirm dialog ────────────────────────────────────────── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) { setDeleteTarget(null); setDeleteConfirmText(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">Permanently delete dealer?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                {deleteTarget && (
                  <div className="text-sm">
                    Business: <b>{deleteTarget.name}</b>
                    <br />Owner: {deleteTarget.admin_name || "—"} ({deleteTarget.admin_email || "—"})
                    <br />Phone: {deleteTarget.phone || "—"}
                  </div>
                )}
                <div className="rounded border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                  This will <b>permanently delete</b> the dealer, their admin user, all sales, purchases, products,
                  customers, suppliers, payments, and every other record tied to this account. This action
                  <b> cannot be undone</b>.
                </div>
                <div className="space-y-2">
                  <Label htmlFor="delete-confirm" className="text-sm">
                    Type the business name <b>{deleteTarget?.name}</b> to confirm:
                  </Label>
                  <Input
                    id="delete-confirm"
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                    placeholder={deleteTarget?.name || ""}
                    autoComplete="off"
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={
                deleteMutation.isPending ||
                !deleteTarget ||
                deleteConfirmText.trim().toLowerCase() !== (deleteTarget?.name || "").trim().toLowerCase()
              }
              onClick={() => deleteTarget && deleteMutation.mutate({ dealer: deleteTarget, confirmName: deleteTarget.name })}
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <EditDealerDialog dealer={editing} onClose={() => setEditing(null)} />
    </div>
  );
};

export default VpsDealerManagement;
