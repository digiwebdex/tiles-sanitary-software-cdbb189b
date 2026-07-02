/**
 * Super Admin — Dealer Payment Requests Review page
 * Route: /super-admin/payment-requests
 *
 * Shows all payment proofs submitted by dealers.
 * SA can Approve or Reject each one; dealer gets a WhatsApp notification.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import {
  CheckCircle2, XCircle, Clock, ExternalLink, Search, X, RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

// ── Types ────────────────────────────────────────────────────────────────────
interface PaymentRequest {
  id: string;
  dealer_id: string;
  dealer_name: string;
  dealer_phone: string | null;
  amount: number;
  payment_method: string;
  transaction_id: string | null;
  screenshot_url: string | null;
  note: string | null;
  status: "pending" | "approved" | "rejected";
  review_note: string | null;
  reviewed_at: string | null;
  reviewed_by_name: string | null;
  created_at: string;
}

const METHOD_LABELS: Record<string, string> = {
  bkash: "bKash", nagad: "Nagad", bank: "Bank Transfer", ssl: "SSLCommerz", cash: "Cash",
};

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: PaymentRequest["status"] }) {
  if (status === "approved") return (
    <Badge className="bg-green-600 text-white gap-1 text-xs">
      <CheckCircle2 className="h-3 w-3" /> Approved
    </Badge>
  );
  if (status === "rejected") return (
    <Badge variant="destructive" className="gap-1 text-xs">
      <XCircle className="h-3 w-3" /> Rejected
    </Badge>
  );
  return (
    <Badge variant="secondary" className="gap-1 text-xs">
      <Clock className="h-3 w-3" /> Pending
    </Badge>
  );
}

// ── Review dialog ─────────────────────────────────────────────────────────────
interface ReviewDialogProps {
  request: PaymentRequest | null;
  onClose: () => void;
}

function ReviewDialog({ request, onClose }: ReviewDialogProps) {
  const qc = useQueryClient();
  const [verdict, setVerdict] = useState<"approved" | "rejected">("approved");
  const [note, setNote] = useState("");

  const submit = useMutation({
    mutationFn: async () => {
      const res = await vpsAuthedFetch(`/api/payment-requests/sa/${request!.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: verdict, review_note: note.trim() || null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as any)?.error ?? "Update failed");
      return body;
    },
    onSuccess: () => {
      toast.success(`Payment request ${verdict}.`);
      qc.invalidateQueries({ queryKey: ["sa-payment-requests"] });
      onClose();
      setNote("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!request) return null;

  return (
    <Dialog open={!!request} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Review Payment Request</DialogTitle>
          <DialogDescription>
            {request.dealer_name} — ৳{Number(request.amount).toLocaleString("en-BD")} via{" "}
            {METHOD_LABELS[request.payment_method] ?? request.payment_method}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          {request.transaction_id && (
            <p><span className="font-medium">Txn ID:</span> <span className="font-mono">{request.transaction_id}</span></p>
          )}
          {request.note && (
            <p><span className="font-medium">Dealer Note:</span> {request.note}</p>
          )}
          {request.screenshot_url && (
            <a
              href={request.screenshot_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-blue-600 hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" /> View Screenshot
            </a>
          )}
        </div>

        <div className="space-y-3 pt-2">
          <div className="space-y-1.5">
            <Label>Decision</Label>
            <Select value={verdict} onValueChange={(v) => setVerdict(v as any)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="approved">✅ Approve</SelectItem>
                <SelectItem value="rejected">❌ Reject</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Note to dealer <span className="text-xs text-muted-foreground">(optional — sent via WhatsApp)</span></Label>
            <Textarea
              placeholder={verdict === "rejected" ? "Reason for rejection…" : "e.g. Payment received, subscription extended…"}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submit.isPending}>Cancel</Button>
          <Button
            onClick={() => submit.mutate()}
            disabled={submit.isPending}
            variant={verdict === "rejected" ? "destructive" : "default"}
          >
            {submit.isPending ? "Saving…" : verdict === "approved" ? "Approve" : "Reject"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function SAPaymentRequestsPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [reviewing, setReviewing] = useState<PaymentRequest | null>(null);

  const { data, isLoading, refetch } = useQuery<{ requests: PaymentRequest[]; pendingCount: number }>({
    queryKey: ["sa-payment-requests", statusFilter],
    queryFn: async () => {
      const params = statusFilter !== "all" ? `?status=${statusFilter}` : "";
      const res = await vpsAuthedFetch(`/api/payment-requests/sa/all${params}`);
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    refetchInterval: 60_000,
  });

  const requests = (data?.requests ?? []).filter((r) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      r.dealer_name?.toLowerCase().includes(q) ||
      r.dealer_phone?.includes(q) ||
      r.transaction_id?.toLowerCase().includes(q) ||
      r.note?.toLowerCase().includes(q)
    );
  });

  const pendingCount = data?.pendingCount ?? 0;

  return (
    <div className="space-y-4 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">Payment Requests</h1>
          {pendingCount > 0 && (
            <Badge className="bg-orange-500 text-white text-xs">{pendingCount} pending</Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Review subscription payment proofs submitted by dealers.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search dealer, txn ID…"
            className="pl-8 h-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36 h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>

        <Button variant="ghost" size="sm" onClick={() => refetch()} className="h-9">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="text-sm text-center text-muted-foreground py-12">Loading…</p>
          ) : requests.length === 0 ? (
            <p className="text-sm text-center text-muted-foreground py-12">
              {statusFilter === "pending" ? "No pending payment requests." : "No payment requests found."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Dealer</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Txn ID</TableHead>
                    <TableHead>Note</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requests.map((r) => (
                    <TableRow
                      key={r.id}
                      className={r.status === "pending" ? "bg-orange-50 dark:bg-orange-950/10" : ""}
                    >
                      <TableCell className="text-xs whitespace-nowrap">
                        {format(parseISO(r.created_at), "dd MMM yyyy")}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-sm leading-tight">{r.dealer_name}</div>
                        {r.dealer_phone && (
                          <div className="text-xs text-muted-foreground">{r.dealer_phone}</div>
                        )}
                      </TableCell>
                      <TableCell className="font-semibold">
                        ৳{Number(r.amount).toLocaleString("en-BD")}
                      </TableCell>
                      <TableCell className="text-xs">
                        {METHOD_LABELS[r.payment_method] ?? r.payment_method}
                      </TableCell>
                      <TableCell className="text-xs font-mono max-w-[120px] truncate">
                        {r.transaction_id ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs max-w-[160px]">
                        <div className="flex items-center gap-1">
                          {r.note ? (
                            <span className="truncate" title={r.note}>{r.note}</span>
                          ) : "—"}
                          {r.screenshot_url && (
                            <a
                              href={r.screenshot_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 shrink-0"
                            >
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <StatusBadge status={r.status} />
                          {r.review_note && (
                            <span className="text-xs text-muted-foreground line-clamp-1">{r.review_note}</span>
                          )}
                          {r.reviewed_by_name && (
                            <span className="text-xs text-muted-foreground">by {r.reviewed_by_name}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {r.status === "pending" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => setReviewing(r)}
                          >
                            Review
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            onClick={() => setReviewing(r)}
                          >
                            Update
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="text-xs text-muted-foreground text-right px-4 py-2">
                {requests.length} record{requests.length !== 1 ? "s" : ""}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <ReviewDialog request={reviewing} onClose={() => setReviewing(null)} />
    </div>
  );
}
