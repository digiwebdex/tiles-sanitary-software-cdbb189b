import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getLedgerHistory,
  getOutstandingSummary,
  getRecentPayments,
  listMyPortalPaymentRequests,
} from "@/services/portalService";
import { PortalListSkeleton } from "./PortalLayout";
import { Wallet, BellPlus } from "lucide-react";
import PortalPaymentRequestDialog from "./PortalPaymentRequestDialog";
import { paymentModeLabel } from "@/lib/paymentModes";

const fmtBDT = (n: number | null | undefined) =>
  `৳${Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type FilterType = "all" | "sale" | "payment" | "return" | "adjustment";

export default function PortalLedgerPage() {
  const [filter, setFilter] = useState<FilterType>("all");
  const [payOpen, setPayOpen] = useState(false);

  const summaryQ = useQuery({
    queryKey: ["portal", "outstanding"],
    queryFn: getOutstandingSummary,
  });
  const paymentsQ = useQuery({
    queryKey: ["portal", "recent-payments", 10],
    queryFn: () => getRecentPayments(10),
  });
  const historyQ = useQuery({
    queryKey: ["portal", "ledger-history", 50],
    queryFn: () => getLedgerHistory(50),
  });
  const paymentReqQ = useQuery({
    queryKey: ["portal", "payment-requests"],
    queryFn: listMyPortalPaymentRequests,
  });

  const filteredHistory = useMemo(() => {
    const rows = historyQ.data ?? [];
    if (filter === "all") return rows;
    return rows.filter((r) => r.entry_type === filter);
  }, [historyQ.data, filter]);

  const outstanding = summaryQ.data?.outstanding ?? 0;

  return (
    <div className="space-y-4">
      {/* Outstanding header */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="flex items-center gap-2 text-base">
              <Wallet className="h-4 w-4 text-primary" /> Outstanding balance
            </CardTitle>
            {outstanding > 0 && (
              <Button size="sm" onClick={() => setPayOpen(true)}>
                <BellPlus className="h-4 w-4 mr-1.5" />
                Notify payment
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <Stat
            label="Outstanding"
            value={fmtBDT(outstanding)}
            tone={outstanding > 0 ? "warn" : "ok"}
          />
          <Stat label="Total billed" value={fmtBDT(summaryQ.data?.total_billed)} />
          <Stat label="Total paid" value={fmtBDT(summaryQ.data?.total_paid)} />
          <Stat
            label="Last payment"
            value={
              summaryQ.data?.last_payment_date
                ? `${summaryQ.data.last_payment_date}`
                : "—"
            }
            sub={
              summaryQ.data?.last_payment_amount != null
                ? fmtBDT(summaryQ.data.last_payment_amount)
                : undefined
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">My payment notifications</CardTitle>
            <Button variant="outline" size="sm" onClick={() => setPayOpen(true)}>
              New notification
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {paymentReqQ.isLoading ? (
            <PortalListSkeleton />
          ) : (paymentReqQ.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No payment notifications yet. After you pay via bKash or bank, notify your dealer here.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paymentReqQ.data!.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{r.created_at?.slice(0, 10) ?? "—"}</TableCell>
                      <TableCell className="font-medium">{fmtBDT(r.amount)}</TableCell>
                      <TableCell>{paymentModeLabel(r.payment_mode)}</TableCell>
                      <TableCell className="font-mono text-xs">{r.reference_no ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant={r.status === "approved" || r.status === "applied" ? "default" : "secondary"}>
                          {r.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent payments */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Recent payments</CardTitle>
        </CardHeader>
        <CardContent>
          {paymentsQ.isLoading ? (
            <PortalListSkeleton />
          ) : (paymentsQ.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paymentsQ.data!.map((p, idx) => (
                    <TableRow key={`${p.entry_date}-${idx}`}>
                      <TableCell>{p.entry_date}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {p.description ?? "Payment"}
                      </TableCell>
                      <TableCell className="text-right font-medium">{fmtBDT(p.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* History — billed + paid interleaved */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-base">Account activity</CardTitle>
            <div className="flex items-center gap-2">
              <Select value={filter} onValueChange={(v) => setFilter(v as FilterType)}>
                <SelectTrigger className="h-8 w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="sale">Bills</SelectItem>
                  <SelectItem value="payment">Payments</SelectItem>
                  <SelectItem value="return">Returns</SelectItem>
                  <SelectItem value="adjustment">Adjustments</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => historyQ.refetch()}
                disabled={historyQ.isFetching}
              >
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {historyQ.isLoading ? (
            <PortalListSkeleton />
          ) : filteredHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredHistory.map((r, idx) => (
                    <TableRow key={`${r.entry_date}-${idx}`}>
                      <TableCell>{r.entry_date}</TableCell>
                      <TableCell>
                        <Badge variant={typeVariant(r.entry_type)}>{labelType(r.entry_type)}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{r.reference_no ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {r.description ?? "—"}
                      </TableCell>
                      <TableCell
                        className={`text-right font-medium ${
                          r.entry_type === "payment" || r.entry_type === "return"
                            ? "text-foreground"
                            : ""
                        }`}
                      >
                        {fmtBDT(r.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <PortalPaymentRequestDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        suggestedAmount={outstanding > 0 ? outstanding : null}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "ok" | "warn";
}) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold ${tone === "warn" ? "text-destructive" : ""}`}>
        {value}
      </div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function labelType(t: string): string {
  switch (t) {
    case "sale":
      return "Bill";
    case "payment":
      return "Payment";
    case "return":
      return "Return";
    case "opening_balance":
      return "Opening";
    case "adjustment":
      return "Adjustment";
    default:
      return t;
  }
}

function typeVariant(t: string): "default" | "secondary" | "destructive" | "outline" {
  if (t === "payment" || t === "return") return "default";
  if (t === "sale") return "secondary";
  return "outline";
}
