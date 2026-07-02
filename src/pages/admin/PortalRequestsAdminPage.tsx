import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  listDealerPortalPaymentRequests,
  listDealerPortalRequests,
  updatePortalPaymentRequest,
  updatePortalRequest,
  type PortalPaymentRequest,
  type PortalPaymentRequestStatus,
  type PortalRequest,
  type PortalRequestStatus,
} from "@/services/portalService";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { paymentModeLabel } from "@/lib/paymentModes";
import { Link } from "react-router-dom";

const fmtBDT = (n: number) =>
  `৳${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const orderStatusVariant = (s: PortalRequestStatus) => {
  if (s === "converted") return "default" as const;
  if (s === "reviewed") return "secondary" as const;
  if (s === "closed") return "outline" as const;
  return "secondary" as const;
};

const payStatusVariant = (s: PortalPaymentRequestStatus) => {
  if (s === "approved" || s === "applied") return "default" as const;
  if (s === "rejected") return "destructive" as const;
  return "secondary" as const;
};

export default function PortalRequestsAdminPage() {
  const { profile } = useAuth();
  const dealerId = profile?.dealer_id ?? "";
  const qc = useQueryClient();
  const { toast } = useToast();
  const [selectedOrder, setSelectedOrder] = useState<PortalRequest | null>(null);
  const [selectedPay, setSelectedPay] = useState<PortalPaymentRequest | null>(null);
  const [note, setNote] = useState("");

  const ordersQ = useQuery({
    queryKey: ["admin", "portal_requests", dealerId],
    queryFn: () => listDealerPortalRequests(dealerId),
    enabled: !!dealerId,
  });

  const paymentsQ = useQuery({
    queryKey: ["admin", "portal_payment_requests", dealerId],
    queryFn: () => listDealerPortalPaymentRequests(dealerId),
    enabled: !!dealerId,
  });

  const updateOrderM = useMutation({
    mutationFn: (args: { id: string; status: PortalRequestStatus; note: string }) =>
      updatePortalRequest(args.id, {
        status: args.status,
        review_note: args.note || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "portal_requests", dealerId] });
      toast({ title: "Request updated" });
      setSelectedOrder(null);
      setNote("");
    },
    onError: (e) =>
      toast({ variant: "destructive", title: "Failed", description: (e as Error).message }),
  });

  const updatePayM = useMutation({
    mutationFn: (args: { id: string; status: PortalPaymentRequestStatus; note: string }) =>
      updatePortalPaymentRequest(args.id, {
        status: args.status,
        review_note: args.note || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "portal_payment_requests", dealerId] });
      toast({ title: "Payment request updated" });
      setSelectedPay(null);
      setNote("");
    },
    onError: (e) =>
      toast({ variant: "destructive", title: "Failed", description: (e as Error).message }),
  });

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-2xl font-bold">Portal Inbox</h1>
        <p className="text-sm text-muted-foreground">
          Reorder/quote requests and payment notifications from customer portal users.
        </p>
      </div>

      <Tabs defaultValue="orders">
        <TabsList>
          <TabsTrigger value="orders">Orders & quotes</TabsTrigger>
          <TabsTrigger value="payments">
            Payment notifications
            {(paymentsQ.data ?? []).filter((p) => p.status === "pending").length > 0 && (
              <Badge className="ml-2 h-5 px-1.5" variant="destructive">
                {(paymentsQ.data ?? []).filter((p) => p.status === "pending").length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="orders" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Reorder & quote requests</CardTitle>
            </CardHeader>
            <CardContent>
              {ordersQ.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : (ordersQ.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No portal requests yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Items</TableHead>
                        <TableHead>Message</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(ordersQ.data ?? []).map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="text-xs">
                            {new Date(r.created_at).toLocaleString()}
                          </TableCell>
                          <TableCell className="capitalize">{r.request_type}</TableCell>
                          <TableCell>{r.items.length}</TableCell>
                          <TableCell className="max-w-[280px] truncate">
                            {r.message ?? "—"}
                          </TableCell>
                          <TableCell>
                            <Badge variant={orderStatusVariant(r.status)}>{r.status}</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setSelectedOrder(r);
                                setNote(r.review_note ?? "");
                              }}
                            >
                              Review
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payments" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Payment notifications</CardTitle>
            </CardHeader>
            <CardContent>
              {paymentsQ.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : (paymentsQ.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No payment notifications yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Method</TableHead>
                        <TableHead>Reference</TableHead>
                        <TableHead>Invoice</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(paymentsQ.data ?? []).map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="text-xs">
                            {new Date(r.created_at).toLocaleString()}
                          </TableCell>
                          <TableCell>{r.customer_name ?? "—"}</TableCell>
                          <TableCell className="font-medium">{fmtBDT(r.amount)}</TableCell>
                          <TableCell>{paymentModeLabel(r.payment_mode)}</TableCell>
                          <TableCell className="font-mono text-xs">{r.reference_no ?? "—"}</TableCell>
                          <TableCell>{r.invoice_number ?? "—"}</TableCell>
                          <TableCell>
                            <Badge variant={payStatusVariant(r.status)}>{r.status}</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setSelectedPay(r);
                                setNote(r.review_note ?? "");
                              }}
                            >
                              Review
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!selectedOrder} onOpenChange={(o) => !o && setSelectedOrder(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Review portal request</DialogTitle>
          </DialogHeader>
          {selectedOrder && (
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground">
                {new Date(selectedOrder.created_at).toLocaleString()} · {selectedOrder.request_type}
              </div>
              {selectedOrder.message && (
                <div className="p-2 bg-muted rounded text-sm">{selectedOrder.message}</div>
              )}
              <div className="border border-border rounded-md overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead>Unit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedOrder.items.map((it, i) => (
                      <TableRow key={i}>
                        <TableCell>{it.product_name}</TableCell>
                        <TableCell className="text-right">{it.quantity}</TableCell>
                        <TableCell>{it.unit_type ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Review note</label>
                <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              onClick={() =>
                updateOrderM.mutate({ id: selectedOrder!.id, status: "closed", note })
              }
              disabled={!selectedOrder || updateOrderM.isPending}
            >
              Close
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                updateOrderM.mutate({ id: selectedOrder!.id, status: "reviewed", note })
              }
              disabled={!selectedOrder || updateOrderM.isPending}
            >
              Mark reviewed
            </Button>
            <Button
              onClick={() =>
                updateOrderM.mutate({ id: selectedOrder!.id, status: "converted", note })
              }
              disabled={!selectedOrder || updateOrderM.isPending}
            >
              Mark converted
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedPay} onOpenChange={(o) => !o && setSelectedPay(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Review payment notification</DialogTitle>
          </DialogHeader>
          {selectedPay && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-xs text-muted-foreground">Customer</div>
                  <div>{selectedPay.customer_name ?? "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Amount</div>
                  <div className="font-semibold">{fmtBDT(selectedPay.amount)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Method</div>
                  <div>{paymentModeLabel(selectedPay.payment_mode)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Reference</div>
                  <div className="font-mono text-xs">{selectedPay.reference_no ?? "—"}</div>
                </div>
                <div className="col-span-2">
                  <div className="text-xs text-muted-foreground">Invoice</div>
                  <div>{selectedPay.invoice_number ?? "General account payment"}</div>
                </div>
              </div>
              {selectedPay.message && (
                <div className="p-2 bg-muted rounded">{selectedPay.message}</div>
              )}
              <div>
                <label className="text-xs text-muted-foreground">Review note</label>
                <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
              <p className="text-xs text-muted-foreground">
                After verifying the payment, record it in{" "}
                <Link to="/collections" className="text-primary underline">
                  Collections
                </Link>{" "}
                using the same reference, then mark as applied.
              </p>
            </div>
          )}
          <DialogFooter className="gap-2 flex-wrap">
            <Button
              variant="destructive"
              onClick={() =>
                updatePayM.mutate({ id: selectedPay!.id, status: "rejected", note })
              }
              disabled={!selectedPay || updatePayM.isPending}
            >
              Reject
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                updatePayM.mutate({ id: selectedPay!.id, status: "reviewed", note })
              }
              disabled={!selectedPay || updatePayM.isPending}
            >
              Mark reviewed
            </Button>
            <Button
              onClick={() =>
                updatePayM.mutate({ id: selectedPay!.id, status: "approved", note })
              }
              disabled={!selectedPay || updatePayM.isPending}
            >
              Approve
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                updatePayM.mutate({ id: selectedPay!.id, status: "applied", note })
              }
              disabled={!selectedPay || updatePayM.isPending}
            >
              {updatePayM.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Mark applied
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
