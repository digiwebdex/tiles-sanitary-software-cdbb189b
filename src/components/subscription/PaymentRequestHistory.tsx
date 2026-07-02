/**
 * Shows dealer's own submitted payment requests + button to submit new one
 */
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { PlusCircle, ExternalLink, Clock, CheckCircle2, XCircle } from "lucide-react";
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

interface PaymentRequest {
  id: string;
  amount: number;
  payment_method: string;
  transaction_id: string | null;
  screenshot_url: string | null;
  note: string | null;
  status: "pending" | "approved" | "rejected";
  review_note: string | null;
  created_at: string;
}

const METHOD_LABELS: Record<string, string> = {
  bkash: "bKash", nagad: "Nagad", bank: "Bank Transfer", ssl: "SSLCommerz", cash: "Cash",
};

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

interface Props {
  onOpenDialog: () => void;
}

export default function PaymentRequestHistory({ onOpenDialog }: Props) {
  const { data, isLoading } = useQuery<{ requests: PaymentRequest[] }>({
    queryKey: ["my-payment-requests"],
    queryFn: async () => {
      const res = await vpsAuthedFetch("/api/payment-requests");
      if (!res.ok) throw new Error("Failed to load payment requests");
      return res.json();
    },
  });

  const requests = data?.requests ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base font-semibold">Payment Requests</CardTitle>
        <Button size="sm" onClick={onOpenDialog} className="gap-1.5">
          <PlusCircle className="h-4 w-4" />
          Submit Payment
        </Button>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>
        ) : requests.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground text-sm">
            <p>No payment requests yet.</p>
            <p className="mt-1">Made a subscription payment? Click <strong>Submit Payment</strong> to notify the Super Admin.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Txn ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs whitespace-nowrap">
                      {format(parseISO(r.created_at), "dd MMM yyyy")}
                    </TableCell>
                    <TableCell className="font-medium">
                      ৳{Number(r.amount).toLocaleString("en-BD")}
                    </TableCell>
                    <TableCell className="text-xs">
                      {METHOD_LABELS[r.payment_method] ?? r.payment_method}
                    </TableCell>
                    <TableCell className="text-xs font-mono max-w-[140px] truncate">
                      {r.transaction_id ?? "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <StatusBadge status={r.status} />
                        {r.review_note && (
                          <span className="text-xs text-muted-foreground">{r.review_note}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs max-w-[180px]">
                      <div className="flex items-center gap-1">
                        {r.note ? (
                          <span className="truncate" title={r.note}>{r.note}</span>
                        ) : "—"}
                        {r.screenshot_url && (
                          <a
                            href={r.screenshot_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline shrink-0"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
