import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { env } from "@/lib/env";
import { formatCurrency } from "@/lib/utils";
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";
import { Banknote, CheckCircle2, Download, Search, Share2, WalletCards } from "lucide-react";
import { confirmPendingSubscriptionPayment } from "@/services/subscriptionPaymentService";
import { useQueryClient } from "@tanstack/react-query";

type PaymentRow = {
  id: string;
  subscription_id: string;
  dealer_id: string;
  dealer_name: string | null;
  dealer_email: string | null;
  dealer_phone: string | null;
  dealer_address: string | null;
  plan_name: string | null;
  billing_cycle: string | null;
  amount: number;
  payment_method: string;
  payment_status: "paid" | "partial" | "pending";
  payment_date: string;
  start_date: string | null;
  end_date: string | null;
  note: string | null;
  collected_by_name: string | null;
  requested_plan_id?: string | null;
  requested_billing_cycle?: string | null;
  requested_plan_name?: string | null;
  source?: string | null;
};

async function vpsJson<T>(path: string): Promise<T> {
  const res = await vpsAuthedFetch(path);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
  return body as T;
}

function statusBadge(status: PaymentRow["payment_status"]) {
  if (status === "paid") return <Badge className="text-xs">Paid</Badge>;
  if (status === "partial") return <Badge variant="outline" className="text-xs">Partial</Badge>;
  return <Badge variant="secondary" className="text-xs">Pending</Badge>;
}

function invoiceNo(row: PaymentRow) {
  return `INV-${row.payment_date?.replace(/-/g, "") || "PAY"}-${row.id.slice(0, 6).toUpperCase()}`;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function invoiceHtml(row: PaymentRow) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${invoiceNo(row)}</title><style>
    body{font-family:Arial,sans-serif;color:#111827;margin:40px;line-height:1.45} .top{display:flex;justify-content:space-between;border-bottom:2px solid #111827;padding-bottom:18px;margin-bottom:28px}
    h1{margin:0;font-size:28px}.muted{color:#6b7280;font-size:13px}.box{border:1px solid #d1d5db;border-radius:8px;padding:16px;margin:16px 0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
    table{width:100%;border-collapse:collapse;margin-top:18px}th,td{border-bottom:1px solid #e5e7eb;padding:12px;text-align:left}th{background:#f9fafb}.total{font-size:22px;font-weight:700;text-align:right;margin-top:20px}
  </style></head><body><div class="top"><div><h1>TilesERP</h1><div class="muted">Dealer Subscription Payment Invoice</div></div><div><b>${invoiceNo(row)}</b><br><span class="muted">Date: ${escapeHtml(row.payment_date)}</span></div></div>
  <div class="grid"><div class="box"><b>Billed To</b><br>${escapeHtml(row.dealer_name || "Dealer")}<br>${escapeHtml(row.dealer_phone || "")}<br>${escapeHtml(row.dealer_email || "")}<br>${escapeHtml(row.dealer_address || "")}</div>
  <div class="box"><b>Payment</b><br>Status: ${escapeHtml(row.payment_status)}<br>Method: ${escapeHtml(row.payment_method)}<br>Collected by: ${escapeHtml(row.collected_by_name || "Super Admin")}</div></div>
  <table><thead><tr><th>Plan</th><th>Billing</th><th>Period End</th><th style="text-align:right">Amount</th></tr></thead><tbody><tr><td>${escapeHtml(row.plan_name || "Subscription")}</td><td>${escapeHtml(row.billing_cycle || "—")}</td><td>${escapeHtml(row.end_date || "—")}</td><td style="text-align:right">${escapeHtml(formatCurrency(row.amount))}</td></tr></tbody></table>
  <div class="total">Total: ${escapeHtml(formatCurrency(row.amount))}</div>${row.note ? `<div class="box"><b>Note</b><br>${escapeHtml(row.note)}</div>` : ""}</body></html>`;
}

const SADealerPaymentsPage = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const { data: payments = [], isLoading } = useQuery({
    queryKey: ["sa-payment-history"],
    queryFn: async () => {
      if (env.AUTH_BACKEND === "vps") {
        const body = await vpsJson<{ payments: PaymentRow[] }>("/api/subscriptions/payments");
        return body.payments ?? [];
      }
      const { data, error } = await supabase
        .from("subscription_payments")
        .select("*, dealers(name,email,phone,address), subscriptions(billing_cycle,start_date,end_date, subscription_plans!subscriptions_plan_id_fkey(name))")
        .order("payment_date", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []).map((p: any) => ({
        ...p,
        dealer_name: p.dealers?.name ?? null,
        dealer_email: p.dealers?.email ?? null,
        dealer_phone: p.dealers?.phone ?? null,
        dealer_address: p.dealers?.address ?? null,
        plan_name: p.subscriptions?.subscription_plans?.name ?? null,
        billing_cycle: p.subscriptions?.billing_cycle ?? null,
        start_date: p.subscriptions?.start_date ?? null,
        end_date: p.subscriptions?.end_date ?? null,
        collected_by_name: null,
        amount: Number(p.amount || 0),
      })) as PaymentRow[];
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return payments.filter((p) => {
      const matchesStatus = status === "all" || p.payment_status === status;
      const haystack = `${p.dealer_name ?? ""} ${p.dealer_phone ?? ""} ${p.dealer_email ?? ""} ${p.plan_name ?? ""}`.toLowerCase();
      return matchesStatus && (!q || haystack.includes(q));
    });
  }, [payments, search, status]);

  const stats = useMemo(() => ({
    total: filtered.reduce((sum, p) => sum + Number(p.amount || 0), 0),
    paid: filtered.filter((p) => p.payment_status === "paid").length,
    partial: filtered.filter((p) => p.payment_status === "partial").length,
    pending: filtered.filter((p) => p.payment_status === "pending").length,
  }), [filtered]);

  const downloadInvoice = (row: PaymentRow) => {
    const blob = new Blob([invoiceHtml(row)], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${invoiceNo(row)}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const confirmPayment = async (row: PaymentRow) => {
    if (row.payment_status !== "pending") return;
    setConfirmingId(row.id);
    try {
      const result = await confirmPendingSubscriptionPayment(row.id);
      toast({
        title: "Payment confirmed",
        description: result.subscription?.end_date
          ? `Account activated until ${result.subscription.end_date}. Dealer notified by SMS and email.`
          : "Payment confirmed.",
      });
      await queryClient.invalidateQueries({ queryKey: ["sa-payment-history"] });
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Could not confirm payment",
        description: err?.message || "Please try again.",
      });
    } finally {
      setConfirmingId(null);
    }
  };

  const shareInvoice = async (row: PaymentRow) => {
    const text = `${invoiceNo(row)}\nDealer: ${row.dealer_name || "Dealer"}\nAmount: ${formatCurrency(row.amount)}\nStatus: ${row.payment_status}\nDate: ${row.payment_date}`;
    try {
      if (navigator.share) await navigator.share({ title: invoiceNo(row), text });
      else await navigator.clipboard.writeText(text);
      toast({ title: navigator.share ? "Invoice shared" : "Invoice copied" });
    } catch {
      toast({ variant: "destructive", title: "Share failed" });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dealer Payment History</h1>
        <p className="text-sm text-muted-foreground">Check dealer subscription payments and download or share invoices.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Collected</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{formatCurrency(stats.total)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Paid</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{stats.paid}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Partial</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{stats.partial}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Pending</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{stats.pending}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="space-y-4">
          <div className="flex items-center gap-2"><WalletCards className="h-5 w-5 text-primary" /><CardTitle>Payment Check</CardTitle></div>
          <div className="grid gap-3 md:grid-cols-[1fr_180px]">
            <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search dealer, phone, email, plan…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            <Select value={status} onValueChange={setStatus}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Status</SelectItem><SelectItem value="paid">Paid</SelectItem><SelectItem value="partial">Partial</SelectItem><SelectItem value="pending">Pending</SelectItem></SelectContent></Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Dealer</TableHead><TableHead>Plan</TableHead><TableHead>Date</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead><TableHead>Method</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {isLoading ? <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Loading…</TableCell></TableRow> : filtered.length === 0 ? <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No payment records</TableCell></TableRow> : filtered.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell><div className="font-medium">{p.dealer_name ?? "—"}</div><div className="text-xs text-muted-foreground">{p.dealer_phone ?? p.dealer_email ?? "—"}</div></TableCell>
                    <TableCell><div>{p.plan_name ?? "—"}</div><div className="text-xs text-muted-foreground capitalize">{p.billing_cycle ?? "—"}</div></TableCell>
                    <TableCell className="text-xs">{p.payment_date}</TableCell>
                    <TableCell className="font-mono">{formatCurrency(p.amount)}</TableCell>
                    <TableCell>{statusBadge(p.payment_status)}</TableCell>
                    <TableCell className="capitalize text-sm">{p.payment_method?.replace("_", " ")}</TableCell>
                    <TableCell className="text-right space-x-2">
                      {p.payment_status === "pending" && p.source === "dealer_request" && (
                        <Button
                          size="sm"
                          onClick={() => confirmPayment(p)}
                          disabled={confirmingId === p.id}
                        >
                          <CheckCircle2 className="mr-1 h-4 w-4" />
                          {confirmingId === p.id ? "Confirming…" : "Confirm"}
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => downloadInvoice(p)}><Download className="mr-1 h-4 w-4" /> Download</Button>
                      <Button size="sm" variant="outline" onClick={() => shareInvoice(p)}><Share2 className="mr-1 h-4 w-4" /> Share</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default SADealerPaymentsPage;