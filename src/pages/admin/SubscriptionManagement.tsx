import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { recordSubscriptionPayment } from "@/services/subscriptionPaymentService";
import {
  Plus, CalendarPlus, Play, Pause, RefreshCw, Banknote, AlertCircle,
  CheckCircle2, BellRing, MessageSquare, Mail, Phone, ChevronDown, Send, X,
  History, CheckCheck, XCircle, Clock, Settings2,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { differenceInDays, parseISO, format, addMonths, addYears } from "date-fns";
import { checkYearlyDiscountEligibility } from "@/services/subscriptionPaymentService";
import { sendReminderToDealer } from "@/services/reminderService";

import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

interface SubRow {
  id: string;
  dealer_id: string;
  plan_id: string;
  status: string;
  start_date: string;
  end_date: string | null;
  custom_features?: Record<string, boolean> | null;
  dealers: { name: string } | null;
  plans: { name: string; id: string } | null;
}

const CUSTOM_FEATURE_LABELS: { key: string; label: string }[] = [
  { key: "posEnabled",              label: "POS (Point of Sale)" },
  { key: "barcodeEnabled",         label: "Barcode Scanning" },
  { key: "leadsEnabled",           label: "Leads / Visit Register" },
  { key: "projectsEnabled",        label: "Projects" },
  { key: "quotationsEnabled",      label: "Quotations" },
  { key: "backordersEnabled",      label: "Backorders" },
  { key: "hrmEnabled",             label: "HRM Module" },
  { key: "campaignsEnabled",       label: "Campaigns & Marketing" },
  { key: "portalEnabled",          label: "Customer Portal" },
  { key: "advancedFinanceEnabled", label: "Directors / Shareholder Accounts" },
  { key: "advancedReportsEnabled", label: "Advanced Reports" },
  { key: "whatsappEnabled",        label: "WhatsApp Notifications" },
];

interface NotifRow {
  id: string;
  dealer_id: string;
  dealer_name: string | null;
  channel: string;
  type: string;
  status: string;
  error_message: string | null;
  sent_at: string | null;
  created_at: string;
  payload: Record<string, any>;
}

const GRACE_DAYS = 3;

async function vpsJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await vpsAuthedFetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
  return body as T;
}

function getDisplayStatus(sub: SubRow) {
  if (sub.status === "suspended") return "suspended";
  if (sub.status === "active") {
    if (sub.end_date) {
      const daysLeft = differenceInDays(parseISO(sub.end_date), new Date());
      if (daysLeft >= 0 && daysLeft <= 7) return "expiring_soon";
    }
    return "active";
  }
  if (sub.status === "expired" && sub.end_date) {
    const daysSinceExpiry = differenceInDays(new Date(), parseISO(sub.end_date));
    if (daysSinceExpiry <= GRACE_DAYS) return "grace";
  }
  return "expired";
}

function getDaysRemaining(sub: SubRow) {
  if (!sub.end_date) return "∞";
  const days = differenceInDays(parseISO(sub.end_date), new Date());
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "Today";
  return `${days}d`;
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { variant: "default" | "destructive" | "secondary" | "outline"; className: string }> = {
    active: { variant: "default", className: "bg-green-600 hover:bg-green-700 text-white border-0" },
    expiring_soon: { variant: "outline", className: "border-yellow-500 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400" },
    grace: { variant: "outline", className: "border-yellow-500 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400" },
    expired: { variant: "destructive", className: "" },
    suspended: { variant: "secondary", className: "" },
  };
  const c = config[status] ?? config.expired;
  return (
    <Badge variant={c.variant} className={`capitalize text-xs ${c.className}`}>
      {status === "grace" ? "Grace Period" : status === "expiring_soon" ? "Expiring Soon" : status}
    </Badge>
  );
}

function ChannelBadge({ channel }: { channel: string }) {
  const map: Record<string, { label: string; className: string }> = {
    sms:      { label: "SMS",       className: "bg-green-100 text-green-700 border-green-300" },
    whatsapp: { label: "WhatsApp",  className: "bg-emerald-100 text-emerald-700 border-emerald-300" },
    email:    { label: "Email",     className: "bg-blue-100 text-blue-700 border-blue-300" },
  };
  const c = map[channel] ?? { label: channel, className: "bg-gray-100 text-gray-700 border-gray-300" };
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${c.className}`}>
      {c.label}
    </span>
  );
}

const SubscriptionManagement = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: subscriptions = [], isLoading } = useQuery({
    queryKey: ["admin-subscriptions"],
    queryFn: async () => {
      const body = await vpsJson<{ subscriptions: SubRow[] }>("/api/subscriptions");
      return body.subscriptions ?? [];
    },
  });

  const { data: dealers = [] } = useQuery({
    queryKey: ["admin-dealers-list"],
    queryFn: async () => {
      const body = await vpsJson<{ dealers: any[]; plans: any[] }>("/api/subscriptions/lookups");
      return body.dealers ?? [];
    },
  });

  const { data: plans = [] } = useQuery({
    queryKey: ["admin-plans-list"],
    queryFn: async () => {
      const body = await vpsJson<{ dealers: any[]; plans: any[] }>("/api/subscriptions/lookups");
      return body.plans ?? [];
    },
  });

  // ── Notification history ──────────────────────────────────────────────
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<{ channel: string; status: string }>({ channel: "", status: "" });

  const { data: historyData, isLoading: historyLoading, refetch: refetchHistory } = useQuery({
    queryKey: ["notification-history", historyFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "200" });
      if (historyFilter.channel) params.set("channel", historyFilter.channel);
      if (historyFilter.status) params.set("status", historyFilter.status);
      const body = await vpsJson<{ notifications: NotifRow[] }>(`/api/admin/reminders/history?${params}`);
      return body.notifications ?? [];
    },
    enabled: historyOpen,
  });

  // ── Bulk selection ────────────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const allIds = subscriptions.map((s) => s.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const someSelected = selected.size > 0 && !allSelected;

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allIds));
    }
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  const selectedSubs = subscriptions.filter((s) => selected.has(s.id));

  // ── Bulk toggle status (activate / suspend) ───────────────────────────
  const [bulkWorking, setBulkWorking] = useState(false);

  const bulkToggle = async (newStatus: "active" | "suspended") => {
    setBulkWorking(true);
    const ids = [...selected];
    let ok = 0;
    let fail = 0;
    for (const id of ids) {
      try {
        await vpsJson(`/api/subscriptions/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ status: newStatus }),
        });
        ok++;
      } catch {
        fail++;
      }
    }
    setBulkWorking(false);
    qc.invalidateQueries({ queryKey: ["admin-subscriptions"] });
    clearSelection();
    toast({
      title: `Bulk ${newStatus === "active" ? "activate" : "suspend"} done`,
      description: `${ok} updated${fail ? `, ${fail} failed` : ""}`,
    });
  };

  // ── Bulk reminder ─────────────────────────────────────────────────────
  const [bulkRemindWorking, setBulkRemindWorking] = useState(false);

  const bulkRemind = async (channel: "sms" | "whatsapp" | "email" | "all") => {
    setBulkRemindWorking(true);
    const dealerIds = [...new Set(selectedSubs.map((s) => s.dealer_id))];
    let ok = 0;
    let fail = 0;
    for (const dealerId of dealerIds) {
      try {
        const r = await sendReminderToDealer(dealerId, channel);
        if (r.ok) ok++;
        else fail++;
      } catch {
        fail++;
      }
    }
    setBulkRemindWorking(false);
    clearSelection();
    toast({
      title: "Bulk reminder sent",
      description: `${ok} sent${fail ? `, ${fail} failed` : ""}`,
    });
  };

  // Assign dialog
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignForm, setAssignForm] = useState({ dealer_id: "", plan_id: "", start_date: "", end_date: "" });

  const assignMutation = useMutation({
    mutationFn: async () => {
      if (!assignForm.dealer_id || !assignForm.plan_id) throw new Error("Dealer and Plan are required");
      await vpsJson("/api/subscriptions", { method: "POST", body: JSON.stringify({ ...assignForm, status: "active" }) });
    },
    onSuccess: () => {
      toast({ title: "Subscription assigned" });
      qc.invalidateQueries({ queryKey: ["admin-subscriptions"] });
      setAssignOpen(false);
      setAssignForm({ dealer_id: "", plan_id: "", start_date: "", end_date: "" });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Error", description: e.message }),
  });

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editSub, setEditSub] = useState<SubRow | null>(null);
  const [editForm, setEditForm] = useState({ end_date: "", status: "", plan_id: "", duration_type: "1month" as "1month" | "1year" | "custom", custom_months: "3" });
  const [customFeatures, setCustomFeatures] = useState<Record<string, boolean>>({});

  // Payment dialog
  const [payOpen, setPayOpen] = useState(false);
  const [paySub, setPaySub] = useState<SubRow | null>(null);
  const [payDiscountEligible, setPayDiscountEligible] = useState<boolean | null>(null);
  const [payForm, setPayForm] = useState({
    amount: "",
    payment_date: format(new Date(), "yyyy-MM-dd"),
    payment_method: "cash" as "cash" | "bank" | "mobile_banking",
    payment_status: "paid" as "paid" | "partial" | "pending",
    billing_cycle: "monthly" as "monthly" | "yearly",
    extend_months: "1",
    note: "",
  });

  const [sendingReminder, setSendingReminder] = useState<string | null>(null);

  const sendReminder = async (
    dealerId: string,
    channel: "sms" | "whatsapp" | "email" | "all",
  ) => {
    setSendingReminder(`${dealerId}-${channel}`);
    try {
      const r = await sendReminderToDealer(dealerId, channel);
      if (r.ok) {
        const channels = [r.sms && "SMS", r.whatsapp && "WhatsApp", r.email && "Email"]
          .filter(Boolean).join(", ");
        toast({ title: "Reminder sent", description: `Delivered via ${channels || "—"}.` });
      } else {
        toast({ title: "Not sent", description: r.message || "All channels failed.", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSendingReminder(null);
    }
  };

  const openPayment = async (sub: SubRow) => {
    setPaySub(sub);
    setPayDiscountEligible(null);
    setPayForm({
      amount: "",
      payment_date: format(new Date(), "yyyy-MM-dd"),
      payment_method: "cash",
      payment_status: "paid",
      billing_cycle: "monthly",
      extend_months: "1",
      note: "",
    });
    setPayOpen(true);
    try {
      const eligible = await checkYearlyDiscountEligibility(sub.dealer_id);
      setPayDiscountEligible(eligible);
    } catch {
      setPayDiscountEligible(null);
    }
  };

  const paymentMutation = useMutation({
    mutationFn: async () => {
      if (!paySub || !user) throw new Error("Missing context");
      if (!payForm.amount || Number(payForm.amount) <= 0) throw new Error("Amount must be > 0");
      await recordSubscriptionPayment({
        subscription_id: paySub.id,
        dealer_id: paySub.dealer_id,
        amount: Number(payForm.amount),
        payment_date: payForm.payment_date,
        payment_method: payForm.payment_method,
        payment_status: payForm.payment_status,
        collected_by: user.id,
        note: payForm.note || undefined,
        billing_cycle: payForm.billing_cycle,
        extend_months: payForm.payment_status === "paid" ? Number(payForm.extend_months) || 1 : undefined,
      });
    },
    onSuccess: () => {
      toast({ title: "Payment recorded successfully" });
      qc.invalidateQueries({ queryKey: ["admin-subscriptions"] });
      setPayOpen(false);
      setPaySub(null);
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Payment Error", description: e.message }),
  });

  const openEdit = (sub: SubRow) => {
    setEditSub(sub);
    setEditForm({
      end_date: sub.end_date ?? "",
      status: sub.status,
      plan_id: sub.plan_id,
      duration_type: "1month",
      custom_months: "3",
    });
    setCustomFeatures(sub.custom_features ?? {});
    setEditOpen(true);
  };

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editSub) return;
      const selectedPlan = plans.find((p: any) => p.id === editForm.plan_id);
      const isPremiumCustom = selectedPlan?.name?.toLowerCase() === "premium custom";
      await vpsJson(`/api/subscriptions/${editSub.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          end_date: editForm.end_date || null,
          status: editForm.status,
          plan_id: editForm.plan_id,
          custom_features: isPremiumCustom ? customFeatures : null,
        }),
      });
    },
    onSuccess: () => {
      toast({ title: "Subscription updated" });
      qc.invalidateQueries({ queryKey: ["admin-subscriptions"] });
      setEditOpen(false);
      setEditSub(null);
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Error", description: e.message }),
  });

  // Quick toggle status
  const toggleMutation = useMutation({
    mutationFn: async ({ id, newStatus }: { id: string; newStatus: string }) => {
      await vpsJson(`/api/subscriptions/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: newStatus }),
      });
    },
    onSuccess: () => {
      toast({ title: "Status updated" });
      qc.invalidateQueries({ queryKey: ["admin-subscriptions"] });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Error", description: e.message }),
  });

  const getRowClass = (displayStatus: string) => {
    if (displayStatus === "expired") return "bg-destructive/5";
    if (displayStatus === "grace" || displayStatus === "expiring_soon") return "bg-yellow-500/5";
    return "";
  };

  const isBulkBusy = bulkWorking || bulkRemindWorking;

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Subscription Management</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => { setHistoryOpen(true); refetchHistory(); }}>
              <History className="mr-1 h-4 w-4" /> Notification History
            </Button>
            <Button size="sm" onClick={() => setAssignOpen(true)}>
              <Plus className="mr-1 h-4 w-4" /> Assign Plan
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* ── Bulk action bar ── */}
          {selected.size > 0 && (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
              <span className="text-sm font-medium text-primary mr-2">
                {selected.size} selected
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs text-green-600 border-green-400"
                disabled={isBulkBusy}
                onClick={() => bulkToggle("active")}
              >
                <Play className="mr-1 h-3 w-3" /> Activate All
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs text-yellow-600 border-yellow-400"
                disabled={isBulkBusy}
                onClick={() => bulkToggle("suspended")}
              >
                <Pause className="mr-1 h-3 w-3" /> Suspend All
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs text-blue-600 border-blue-300"
                    disabled={isBulkBusy}
                  >
                    <BellRing className="mr-1 h-3 w-3" />
                    {bulkRemindWorking ? "Sending…" : "Remind All"}
                    <ChevronDown className="ml-1 h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-44">
                  <DropdownMenuLabel className="text-xs text-muted-foreground py-1">
                    Send via
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-sm gap-2" onClick={() => bulkRemind("sms")} disabled={isBulkBusy}>
                    <Phone className="h-3.5 w-3.5 text-green-600" /> SMS only
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-sm gap-2" onClick={() => bulkRemind("whatsapp")} disabled={isBulkBusy}>
                    <MessageSquare className="h-3.5 w-3.5 text-emerald-600" /> WhatsApp only
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-sm gap-2" onClick={() => bulkRemind("email")} disabled={isBulkBusy}>
                    <Mail className="h-3.5 w-3.5 text-blue-600" /> Email only
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-sm gap-2 font-medium" onClick={() => bulkRemind("all")} disabled={isBulkBusy}>
                    <Send className="h-3.5 w-3.5 text-primary" /> All channels
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs ml-auto text-muted-foreground"
                onClick={clearSelection}
              >
                <X className="mr-1 h-3 w-3" /> Clear
              </Button>
            </div>
          )}

          {isLoading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allSelected}
                        ref={(el) => {
                          if (el) (el as any).indeterminate = someSelected;
                        }}
                        onCheckedChange={toggleAll}
                        aria-label="Select all"
                      />
                    </TableHead>
                    <TableHead>Dealer</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Start</TableHead>
                    <TableHead>End</TableHead>
                    <TableHead>Remaining</TableHead>
                    <TableHead className="w-56">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subscriptions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground">
                        No subscriptions
                      </TableCell>
                    </TableRow>
                  ) : (
                    subscriptions.map((sub) => {
                      const displayStatus = getDisplayStatus(sub);
                      const isChecked = selected.has(sub.id);
                      return (
                        <TableRow
                          key={sub.id}
                          className={`${getRowClass(displayStatus)} ${isChecked ? "bg-primary/5 hover:bg-primary/10" : ""}`}
                        >
                          <TableCell>
                            <Checkbox
                              checked={isChecked}
                              onCheckedChange={() => toggleOne(sub.id)}
                              aria-label={`Select ${sub.dealers?.name}`}
                            />
                          </TableCell>
                          <TableCell className="font-medium">{sub.dealers?.name ?? "—"}</TableCell>
                          <TableCell>{sub.plans?.name ?? "—"}</TableCell>
                          <TableCell><StatusBadge status={displayStatus} /></TableCell>
                          <TableCell className="text-xs">{sub.start_date}</TableCell>
                          <TableCell className="text-xs">{sub.end_date ?? "—"}</TableCell>
                          <TableCell className="text-xs font-mono">{getDaysRemaining(sub)}</TableCell>
                          <TableCell>
                            <div className="flex gap-1 flex-wrap">
                              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openPayment(sub)}>
                                <Banknote className="mr-1 h-3 w-3" /> Payment
                              </Button>
                              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openEdit(sub)}>
                                <CalendarPlus className="mr-1 h-3 w-3" /> Edit
                              </Button>
                              {sub.status === "active" ? (
                                <Button
                                  size="sm" variant="outline" className="h-7 text-xs text-yellow-600"
                                  onClick={() => toggleMutation.mutate({ id: sub.id, newStatus: "suspended" })}
                                >
                                  <Pause className="mr-1 h-3 w-3" /> Suspend
                                </Button>
                              ) : (
                                <Button
                                  size="sm" variant="outline" className="h-7 text-xs text-green-600"
                                  onClick={() => toggleMutation.mutate({ id: sub.id, newStatus: "active" })}
                                >
                                  <Play className="mr-1 h-3 w-3" /> Activate
                                </Button>
                              )}
                              {/* Reminder dropdown */}
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs text-blue-600 border-blue-300 hover:bg-blue-50"
                                    disabled={!!sendingReminder}
                                  >
                                    <BellRing className="mr-1 h-3 w-3" />
                                    {sendingReminder?.startsWith(sub.dealer_id) ? "Sending…" : "Remind"}
                                    <ChevronDown className="ml-1 h-3 w-3" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-44">
                                  <DropdownMenuLabel className="text-xs text-muted-foreground py-1">
                                    Send Reminder via
                                  </DropdownMenuLabel>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    className="text-sm gap-2"
                                    onClick={() => sendReminder(sub.dealer_id, "sms")}
                                    disabled={!!sendingReminder}
                                  >
                                    <Phone className="h-3.5 w-3.5 text-green-600" /> SMS only
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    className="text-sm gap-2"
                                    onClick={() => sendReminder(sub.dealer_id, "whatsapp")}
                                    disabled={!!sendingReminder}
                                  >
                                    <MessageSquare className="h-3.5 w-3.5 text-emerald-600" /> WhatsApp only
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    className="text-sm gap-2"
                                    onClick={() => sendReminder(sub.dealer_id, "email")}
                                    disabled={!!sendingReminder}
                                  >
                                    <Mail className="h-3.5 w-3.5 text-blue-600" /> Email only
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    className="text-sm gap-2 font-medium"
                                    onClick={() => sendReminder(sub.dealer_id, "all")}
                                    disabled={!!sendingReminder}
                                  >
                                    <Send className="h-3.5 w-3.5 text-primary" /> All channels
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Assign Plan Dialog */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Assign Plan to Dealer</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Dealer *</Label>
              <Select value={assignForm.dealer_id} onValueChange={(v) => setAssignForm({ ...assignForm, dealer_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select dealer" /></SelectTrigger>
                <SelectContent>
                  {dealers.map((d: any) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Plan *</Label>
              <Select value={assignForm.plan_id} onValueChange={(v) => setAssignForm({ ...assignForm, plan_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select plan" /></SelectTrigger>
                <SelectContent>
                  {plans.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input type="date" value={assignForm.start_date} onChange={(e) => setAssignForm({ ...assignForm, start_date: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>End Date</Label>
                <Input type="date" value={assignForm.end_date} onChange={(e) => setAssignForm({ ...assignForm, end_date: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>Cancel</Button>
            <Button onClick={() => assignMutation.mutate()} disabled={assignMutation.isPending}>Assign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Subscription Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Subscription — {editSub?.dealers?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Change Plan</Label>
              <Select value={editForm.plan_id} onValueChange={(v) => setEditForm({ ...editForm, plan_id: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {plans.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Duration</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={editForm.duration_type === "1month" ? "default" : "outline"}
                  onClick={() => {
                    const base = editForm.end_date ? parseISO(editForm.end_date) : new Date();
                    const newEnd = addMonths(base > new Date() ? base : new Date(), 1);
                    setEditForm({ ...editForm, duration_type: "1month", end_date: format(newEnd, "yyyy-MM-dd") });
                  }}
                >
                  1 Month
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={editForm.duration_type === "1year" ? "default" : "outline"}
                  onClick={() => {
                    const base = editForm.end_date ? parseISO(editForm.end_date) : new Date();
                    const newEnd = addYears(base > new Date() ? base : new Date(), 1);
                    setEditForm({ ...editForm, duration_type: "1year", end_date: format(newEnd, "yyyy-MM-dd") });
                  }}
                >
                  1 Year
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={editForm.duration_type === "custom" ? "default" : "outline"}
                  onClick={() => setEditForm({ ...editForm, duration_type: "custom" })}
                >
                  Custom
                </Button>
              </div>
              {editForm.duration_type === "custom" && (
                <div className="grid grid-cols-2 gap-2 items-end mt-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Months from now</Label>
                    <Input
                      type="number"
                      min="1"
                      max="60"
                      value={editForm.custom_months}
                      onChange={(e) => {
                        const months = parseInt(e.target.value) || 1;
                        const base = editForm.end_date ? parseISO(editForm.end_date) : new Date();
                        const startBase = base > new Date() ? base : new Date();
                        const newEnd = addMonths(startBase, months);
                        setEditForm({ ...editForm, custom_months: e.target.value, end_date: format(newEnd, "yyyy-MM-dd") });
                      }}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Or pick End Date</Label>
                    <Input
                      type="date"
                      value={editForm.end_date}
                      onChange={(e) => setEditForm({ ...editForm, end_date: e.target.value })}
                    />
                  </div>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                End Date: {editForm.end_date ? format(parseISO(editForm.end_date), "dd MMM yyyy") : "Not set"}
              </p>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={editForm.status} onValueChange={(v) => setEditForm({ ...editForm, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                  <SelectItem value="suspended">Suspended</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {/* Custom feature overrides — Premium Custom plan only */}
            {plans.find((p: any) => p.id === editForm.plan_id)?.name?.toLowerCase() === "premium custom" && (
              <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Settings2 className="h-4 w-4 text-amber-600" />
                  <span className="text-sm font-semibold text-amber-800 dark:text-amber-300">Custom Feature Configuration</span>
                </div>
                <p className="text-xs text-amber-700 dark:text-amber-400 mb-3">
                  Toggle individual modules for this dealer. All are ON by default for Premium Custom. Overrides are applied on top of plan defaults.
                </p>
                <div className="grid grid-cols-1 gap-2.5">
                  {CUSTOM_FEATURE_LABELS.map(({ key, label }) => (
                    <div key={key} className="flex items-center justify-between">
                      <span className="text-sm text-foreground">{label}</span>
                      <Switch
                        checked={customFeatures[key] !== false}
                        onCheckedChange={(checked) =>
                          setCustomFeatures((prev) => ({ ...prev, [key]: checked }))
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}>
              <RefreshCw className="mr-1 h-4 w-4" /> Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Notification History Sheet */}
      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent side="right" className="w-full sm:max-w-2xl flex flex-col p-0">
          <SheetHeader className="px-6 py-4 border-b">
            <SheetTitle className="flex items-center gap-2">
              <History className="h-4 w-4" /> Notification History
            </SheetTitle>
            {/* Filters */}
            <div className="flex gap-2 mt-2">
              <Select
                value={historyFilter.channel || "all"}
                onValueChange={(v) => setHistoryFilter((f) => ({ ...f, channel: v === "all" ? "" : v }))}
              >
                <SelectTrigger className="h-8 text-xs w-36">
                  <SelectValue placeholder="All channels" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All channels</SelectItem>
                  <SelectItem value="sms">SMS</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={historyFilter.status || "all"}
                onValueChange={(v) => setHistoryFilter((f) => ({ ...f, status: v === "all" ? "" : v }))}
              >
                <SelectTrigger className="h-8 text-xs w-32">
                  <SelectValue placeholder="All status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All status</SelectItem>
                  <SelectItem value="sent">Sent</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" variant="ghost" className="h-8 text-xs ml-auto" onClick={() => refetchHistory()}>
                <RefreshCw className="h-3 w-3 mr-1" /> Refresh
              </Button>
            </div>
          </SheetHeader>

          <ScrollArea className="flex-1 px-6 py-3">
            {historyLoading ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>
            ) : !historyData || historyData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No notification history yet.</p>
            ) : (
              <div className="space-y-2">
                {historyData.map((n) => (
                  <div
                    key={n.id}
                    className={`rounded-lg border px-4 py-3 text-sm ${
                      n.status === "sent"
                        ? "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30"
                        : "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 font-medium">
                        {n.status === "sent" ? (
                          <CheckCheck className="h-4 w-4 text-green-600 shrink-0" />
                        ) : (
                          <XCircle className="h-4 w-4 text-red-500 shrink-0" />
                        )}
                        <span>{n.dealer_name ?? n.dealer_id}</span>
                        <ChannelBadge channel={n.channel} />
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {n.sent_at
                          ? format(new Date(n.sent_at), "dd MMM HH:mm")
                          : format(new Date(n.created_at), "dd MMM HH:mm")}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground pl-6">
                      <span className="capitalize">{n.type.replace(/_/g, " ")}</span>
                      {n.error_message && (
                        <span className="ml-2 text-red-500">— {n.error_message}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* Record Payment Dialog */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Payment — {paySub?.dealers?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">

            <div className="space-y-2">
              <Label>Payment Status *</Label>
              <Select
                value={payForm.payment_status}
                onValueChange={(v: "paid" | "partial" | "pending") =>
                  setPayForm({ ...payForm, payment_status: v })
                }
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="paid">Paid (Full)</SelectItem>
                  <SelectItem value="partial">Partial</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {payForm.payment_status === "paid" && (
              <div className="space-y-2">
                <Label>Billing Cycle *</Label>
                <Select
                  value={payForm.billing_cycle}
                  onValueChange={(v: "monthly" | "yearly") =>
                    setPayForm({ ...payForm, billing_cycle: v, extend_months: v === "yearly" ? "12" : "1" })
                  }
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="yearly">Yearly (12 months)</SelectItem>
                  </SelectContent>
                </Select>

                {payForm.billing_cycle === "yearly" && payDiscountEligible !== null && (
                  payDiscountEligible ? (
                    <div className="flex items-start gap-2 rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-sm">
                      <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-green-600" />
                      <div className="text-green-700 dark:text-green-400">
                        <p className="font-semibold">30% First-Year Discount Eligible</p>
                        <p className="text-xs opacity-80 mt-0.5">First yearly renewal — enter the discounted yearly price (30% off).</p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm">
                      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-yellow-600" />
                      <div className="text-yellow-700 dark:text-yellow-400">
                        <p className="font-semibold">No Discount — Full Yearly Price Applies</p>
                        <p className="text-xs opacity-80 mt-0.5">Dealer already used the 30% first-year discount. Charge full price (monthly rate × 12).</p>
                      </div>
                    </div>
                  )
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Amount (৳) *</Label>
                <Input
                  type="number"
                  min="0"
                  value={payForm.amount}
                  onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label>Payment Date *</Label>
                <Input
                  type="date"
                  value={payForm.payment_date}
                  onChange={(e) => setPayForm({ ...payForm, payment_date: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Payment Method *</Label>
              <Select
                value={payForm.payment_method}
                onValueChange={(v: "cash" | "bank" | "mobile_banking") =>
                  setPayForm({ ...payForm, payment_method: v })
                }
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="bank">Bank</SelectItem>
                  <SelectItem value="mobile_banking">Mobile Banking</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {payForm.payment_status === "paid" && (
              <div className="space-y-2">
                <Label>Extend subscription by (months)</Label>
                <Input
                  type="number"
                  min="1"
                  max="24"
                  value={payForm.extend_months}
                  onChange={(e) => setPayForm({ ...payForm, extend_months: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Full payment will activate the subscription and extend end date.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label>Note</Label>
              <Textarea
                value={payForm.note}
                onChange={(e) => setPayForm({ ...payForm, note: e.target.value })}
                placeholder="Optional payment note…"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>Cancel</Button>
            <Button onClick={() => paymentMutation.mutate()} disabled={paymentMutation.isPending}>
              <Banknote className="mr-1 h-4 w-4" /> Record Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default SubscriptionManagement;
