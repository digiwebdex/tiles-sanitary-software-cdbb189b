import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useDealerId } from "@/hooks/useDealerId";
import { useDealerInfo } from "@/hooks/useDealerInfo";
import { usePermissions } from "@/hooks/usePermissions";
import { purchaseOrderService } from "@/services/purchaseOrderService";
import { supplierService } from "@/services/supplierService";
import { supplierPerformanceService } from "@/services/supplierPerformanceService";
import { buildPurchaseOrderMessage } from "@/services/whatsappService";
import { formatCurrency } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import SendWhatsAppDialog from "@/components/whatsapp/SendWhatsAppDialog";
import {
  Pencil, Send, Check, X, Ban, Trash2, Copy, Printer, Mail,
  MessageCircle, PackageCheck, PackageOpen, Lock,
} from "lucide-react";

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  pending_approval: "Pending Approval",
  approved: "Approved",
  sent: "Sent",
  partially_received: "Partially Received",
  fully_received: "Fully Received",
  cancelled: "Cancelled",
  closed: "Closed",
};

const PurchaseOrderDetail = () => {
  const { id } = useParams<{ id: string }>();
  const dealerId = useDealerId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const permissions = usePermissions();
  const { data: dealerInfo } = useDealerInfo();
  const canApprove = (permissions.isDealerAdmin || permissions.isSuperAdmin) && permissions.canMutate;

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [waOpen, setWaOpen] = useState(false);

  const { data: po, isLoading } = useQuery({
    queryKey: ["purchase-order", id, dealerId],
    queryFn: () => purchaseOrderService.getById(id!, dealerId),
    enabled: !!id && !!dealerId,
  });

  const { data: ledgerSummary } = useQuery({
    queryKey: ["po-supplier-ledger", po?.supplier_id],
    queryFn: () => supplierService.getLedgerSummary(po!.supplier_id),
    enabled: !!po?.supplier_id,
  });

  const { data: performance } = useQuery({
    queryKey: ["po-supplier-performance", dealerId, po?.supplier_id],
    queryFn: () => supplierPerformanceService.getForSupplier(dealerId, po!.supplier_id),
    enabled: !!dealerId && !!po?.supplier_id,
  });

  const { data: supplier } = useQuery({
    queryKey: ["po-supplier", po?.supplier_id],
    queryFn: () => supplierService.getById(po!.supplier_id),
    enabled: !!po?.supplier_id,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["purchase-order", id, dealerId] });
    queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
  };

  const submitMutation = useMutation({
    mutationFn: () => purchaseOrderService.submit(id!, dealerId),
    onSuccess: () => { invalidate(); toast.success("Submitted for approval"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const approveMutation = useMutation({
    mutationFn: () => purchaseOrderService.approve(id!, dealerId),
    onSuccess: () => { invalidate(); toast.success("Purchase order approved"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const rejectMutation = useMutation({
    mutationFn: () => purchaseOrderService.reject(id!, dealerId, rejectReason),
    onSuccess: () => { invalidate(); setRejectOpen(false); setRejectReason(""); toast.success("Sent back to draft for revision"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const sendMutation = useMutation({
    mutationFn: () => purchaseOrderService.send(id!, dealerId),
    onSuccess: () => { invalidate(); toast.success("Marked as sent to supplier"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const partiallyReceivedMutation = useMutation({
    mutationFn: () => purchaseOrderService.markPartiallyReceived(id!, dealerId),
    onSuccess: () => { invalidate(); toast.success("Marked as partially received"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const fullyReceivedMutation = useMutation({
    mutationFn: () => purchaseOrderService.markFullyReceived(id!, dealerId),
    onSuccess: () => { invalidate(); toast.success("Marked as fully received"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const closeMutation = useMutation({
    mutationFn: () => purchaseOrderService.close(id!, dealerId),
    onSuccess: () => { invalidate(); toast.success("Purchase order closed"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const cancelMutation = useMutation({
    mutationFn: () => purchaseOrderService.cancel(id!, dealerId, cancelReason),
    onSuccess: () => { invalidate(); setCancelOpen(false); setCancelReason(""); toast.success("Purchase order cancelled"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteMutation = useMutation({
    mutationFn: () => purchaseOrderService.remove(id!, dealerId),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["purchase-orders"] }); toast.success("Draft deleted"); navigate("/purchase-orders"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const cloneMutation = useMutation({
    mutationFn: () => purchaseOrderService.clone(id!, dealerId),
    onSuccess: (row) => { queryClient.invalidateQueries({ queryKey: ["purchase-orders"] }); toast.success("Cloned as a new draft"); navigate(`/purchase-orders/${row.id}`); },
    onError: (e: Error) => toast.error(e.message),
  });
  const emailMutation = useMutation({
    mutationFn: () => purchaseOrderService.email(id!, dealerId),
    onSuccess: () => toast.success("Emailed to supplier"),
    onError: (e: Error) => toast.error(e.message),
  });

  const handlePrint = () => window.print();

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (!po) {
    navigate("/purchase-orders");
    return null;
  }

  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #po-print-area, #po-print-area * { visibility: visible !important; }
          #po-print-area {
            position: fixed !important; top: 0 !important; left: 0 !important;
            width: 100% !important; padding: 0 !important; margin: 0 !important;
          }
          .no-print { display: none !important; }
          @page { size: A4; margin: 10mm; }
        }
      `}</style>

      <div className="no-print p-4 lg:p-6 max-w-5xl mx-auto space-y-4">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>{po.po_number ?? "Draft Purchase Order"}</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">{po.supplier_name}</p>
            </div>
            <Badge variant={po.status === "cancelled" ? "destructive" : po.status === "draft" ? "outline" : "secondary"}>
              {STATUS_LABEL[po.status]}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            {po.notes && <p className="text-sm text-muted-foreground">{po.notes}</p>}
            {po.cancel_reason && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
                <span className="font-medium">Cancellation reason: </span>{po.cancel_reason}
              </div>
            )}

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {po.items.map((it) => (
                  <TableRow key={it.id}>
                    <TableCell>{it.product_name_snapshot}</TableCell>
                    <TableCell className="text-right">{it.ordered_qty}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(it.rate)}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(it.line_total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="flex flex-col items-end gap-1 pt-2 border-t text-sm">
              <div className="flex gap-6"><span className="text-muted-foreground">Subtotal</span><span className="font-mono w-28 text-right">{formatCurrency(po.subtotal)}</span></div>
              <div className="flex gap-6"><span className="text-muted-foreground">Discount</span><span className="font-mono w-28 text-right">{po.discount_type === "percent" ? `${po.discount_value}%` : formatCurrency(po.discount_value)}</span></div>
              <div className="flex gap-6 font-semibold"><span>Total</span><span className="font-mono w-28 text-right">{formatCurrency(po.total_amount)}</span></div>
            </div>

            {/* Workflow actions */}
            <div className="flex flex-wrap gap-2 pt-2">
              {po.status === "draft" && (
                <>
                  <Button variant="outline" onClick={() => navigate(`/purchase-orders/${po.id}/edit`)}><Pencil className="mr-2 h-4 w-4" /> Edit</Button>
                  <Button onClick={() => submitMutation.mutate()} disabled={submitMutation.isPending}><Send className="mr-2 h-4 w-4" /> Submit for Approval</Button>
                  <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => { if (confirm("Delete this draft?")) deleteMutation.mutate(); }} disabled={deleteMutation.isPending}>
                    <Trash2 className="mr-2 h-4 w-4" /> Delete
                  </Button>
                </>
              )}
              {po.status === "pending_approval" && (
                canApprove ? (
                  <>
                    <Button onClick={() => approveMutation.mutate()} disabled={approveMutation.isPending}><Check className="mr-2 h-4 w-4" /> Approve</Button>
                    <Button variant="destructive" onClick={() => setRejectOpen(true)}><X className="mr-2 h-4 w-4" /> Reject</Button>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Awaiting dealer admin approval.</p>
                )
              )}
              {po.status === "approved" && (
                <Button onClick={() => sendMutation.mutate()} disabled={sendMutation.isPending}><Send className="mr-2 h-4 w-4" /> Mark as Sent</Button>
              )}
              {po.status === "sent" && (
                <>
                  <Button variant="outline" onClick={() => partiallyReceivedMutation.mutate()} disabled={partiallyReceivedMutation.isPending}>
                    <PackageOpen className="mr-2 h-4 w-4" /> Mark Partially Received
                  </Button>
                  <Button variant="outline" onClick={() => fullyReceivedMutation.mutate()} disabled={fullyReceivedMutation.isPending}>
                    <PackageCheck className="mr-2 h-4 w-4" /> Mark Fully Received
                  </Button>
                </>
              )}
              {po.status === "partially_received" && (
                <Button variant="outline" onClick={() => fullyReceivedMutation.mutate()} disabled={fullyReceivedMutation.isPending}>
                  <PackageCheck className="mr-2 h-4 w-4" /> Mark Fully Received
                </Button>
              )}
              {["sent", "partially_received", "fully_received"].includes(po.status) && (
                <Button variant="outline" onClick={() => closeMutation.mutate()} disabled={closeMutation.isPending}>
                  <Lock className="mr-2 h-4 w-4" /> Close
                </Button>
              )}
              {["draft", "pending_approval", "approved", "sent"].includes(po.status) && (
                <Button variant="outline" onClick={() => setCancelOpen(true)}><Ban className="mr-2 h-4 w-4" /> Cancel</Button>
              )}
              <Button variant="outline" onClick={() => cloneMutation.mutate()} disabled={cloneMutation.isPending}><Copy className="mr-2 h-4 w-4" /> Clone</Button>
            </div>

            {/* Communication actions */}
            <div className="flex flex-wrap gap-2 pt-2 border-t">
              <Button variant="outline" size="sm" onClick={handlePrint}><Printer className="mr-2 h-4 w-4" /> Print</Button>
              <Button variant="outline" size="sm" onClick={handlePrint}><Printer className="mr-2 h-4 w-4" /> PDF</Button>
              <Button variant="outline" size="sm" onClick={() => emailMutation.mutate()} disabled={emailMutation.isPending || !supplier?.email}>
                <Mail className="mr-2 h-4 w-4" /> Email
              </Button>
              <Button variant="outline" size="sm" onClick={() => setWaOpen(true)} disabled={!supplier?.phone}>
                <MessageCircle className="mr-2 h-4 w-4" /> WhatsApp
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Supplier Integration */}
        {supplier && (
          <Card>
            <CardHeader><CardTitle className="text-base">Supplier</CardTitle></CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-3">
                <div><p className="text-[11px] text-muted-foreground">Credit Limit</p><p className="font-semibold">{formatCurrency(supplier.credit_limit)}</p></div>
                <div><p className="text-[11px] text-muted-foreground">Outstanding Payables</p><p className={`font-semibold ${ (ledgerSummary?.outstanding ?? 0) > 0 ? "text-destructive" : ""}`}>{formatCurrency(ledgerSummary?.outstanding ?? 0)}</p></div>
                <div><p className="text-[11px] text-muted-foreground">Last Purchase</p><p className="font-semibold">{performance?.last_purchase_date ? new Date(performance.last_purchase_date).toLocaleDateString() : "—"}</p></div>
                <div><p className="text-[11px] text-muted-foreground">Supplier Performance Score</p><p className="font-semibold">{performance ? `${performance.reliability_score}/100 (${performance.reliability_band})` : "—"}</p></div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Approval History */}
        {po.approval_history.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base">Approval History</CardTitle></CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {po.approval_history.map((h) => (
                  <li key={h.id} className="text-sm border-b pb-2 last:border-0">
                    <span className="font-medium capitalize">{h.action}</span>
                    <span className="text-muted-foreground"> — {new Date(h.created_at).toLocaleString()}</span>
                    {h.note && <p className="text-muted-foreground mt-0.5">{h.note}</p>}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Print area */}
      <div id="po-print-area" className="hidden print:block p-8">
        <h1 className="text-xl font-bold">{dealerInfo?.name ?? "Purchase Order"}</h1>
        <h2 className="text-lg mt-2">Purchase Order {po.po_number ?? "(Draft)"}</h2>
        <p>Supplier: {po.supplier_name}</p>
        <p>Order Date: {po.order_date}</p>
        <table className="w-full mt-4 border-collapse">
          <thead><tr className="border-b"><th className="text-left py-1">Item</th><th className="text-right py-1">Qty</th><th className="text-right py-1">Rate</th><th className="text-right py-1">Total</th></tr></thead>
          <tbody>
            {po.items.map((it) => (
              <tr key={it.id} className="border-b">
                <td className="py-1">{it.product_name_snapshot}</td>
                <td className="text-right py-1">{it.ordered_qty}</td>
                <td className="text-right py-1">{formatCurrency(it.rate)}</td>
                <td className="text-right py-1">{formatCurrency(it.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-right mt-2 font-semibold">Total: {formatCurrency(po.total_amount)}</p>
        {po.terms_text && <p className="mt-4">Terms: {po.terms_text}</p>}
      </div>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject Purchase Order</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">This will send the purchase order back to Draft for revision.</p>
          <Textarea placeholder="Reason for rejection…" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={3} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button variant="destructive" disabled={!rejectReason.trim() || rejectMutation.isPending} onClick={() => rejectMutation.mutate()}>Reject</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Cancel Purchase Order</DialogTitle></DialogHeader>
          <Textarea placeholder="Reason (optional)…" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} rows={3} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>Back</Button>
            <Button variant="destructive" disabled={cancelMutation.isPending} onClick={() => cancelMutation.mutate()}>Confirm Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {supplier && (
        <SendWhatsAppDialog
          open={waOpen}
          onOpenChange={setWaOpen}
          dealerId={dealerId}
          messageType="purchase_order_share"
          sourceType="purchase_order"
          sourceId={po.id}
          templateKey="purchase_order_share_v1"
          defaultPhone={supplier.phone ?? ""}
          defaultName={supplier.name}
          defaultMessage={buildPurchaseOrderMessage({
            dealerName: dealerInfo?.name ?? "Our Business",
            supplierName: supplier.name,
            poNumber: po.po_number ?? "(Draft)",
            totalAmount: Number(po.total_amount),
            itemCount: po.items.length,
            expectedDeliveryDate: po.expected_delivery_date,
          })}
        />
      )}
    </>
  );
};

export default PurchaseOrderDetail;
