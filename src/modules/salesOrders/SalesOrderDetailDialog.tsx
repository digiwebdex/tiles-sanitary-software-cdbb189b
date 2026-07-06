import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { X, CheckCircle2, Ban, AlertTriangle, Pencil } from "lucide-react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { salesOrderService, type DeliveryReadiness } from "@/services/salesOrderService";
import { SalesOrderStatusBadge } from "@/components/salesOrder/SalesOrderStatusBadge";
import { useDealerId } from "@/hooks/useDealerId";
import { formatCurrency, parseLocalDate } from "@/lib/utils";

interface Props {
  salesOrderId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

const fmtDate = (d?: string | null) => {
  if (!d) return "—";
  const dt = parseLocalDate(d);
  return dt ? dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : d;
};

const READINESS_LABEL: Record<DeliveryReadiness, string> = {
  pending: "Pending",
  ready: "Ready",
  partially_ready: "Partially Ready",
};

const SalesOrderDetailDialog = ({ salesOrderId, open, onOpenChange }: Props) => {
  const dealerId = useDealerId();
  const qc = useQueryClient();
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editQty, setEditQty] = useState<string>("");

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["sales-order", salesOrderId] });
    qc.invalidateQueries({ queryKey: ["sales-order-items", salesOrderId] });
    qc.invalidateQueries({ queryKey: ["sales-orders"] });
  };

  const { data: so } = useQuery({
    queryKey: ["sales-order", salesOrderId],
    queryFn: () => salesOrderService.getById(salesOrderId),
    enabled: open,
  });

  const { data: items = [] } = useQuery({
    queryKey: ["sales-order-items", salesOrderId],
    queryFn: () => salesOrderService.listItems(salesOrderId),
    enabled: open,
  });

  const confirmMutation = useMutation({
    mutationFn: () => salesOrderService.confirm(salesOrderId, dealerId),
    onSuccess: ({ warnings }) => {
      if (warnings.length > 0) {
        toast.warning(warnings[0].message, {
          description: warnings.length > 1 ? `+${warnings.length - 1} more line(s) with limited stock` : undefined,
        });
      } else {
        toast.success("Sales order confirmed — stock reserved");
      }
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelMutation = useMutation({
    mutationFn: (reason: string) => salesOrderService.cancel(salesOrderId, dealerId, reason),
    onSuccess: () => {
      toast.success("Sales order cancelled — reservations released");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateQtyMutation = useMutation({
    mutationFn: (vars: { itemId: string; quantity: number }) =>
      salesOrderService.updateItemQuantity(salesOrderId, vars.itemId, dealerId, vars.quantity),
    onSuccess: (r) => {
      if (r.warning) toast.warning(r.warning);
      else toast.success("Quantity updated — reservation adjusted");
      setEditingItemId(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deliveryPlanningMutation = useMutation({
    mutationFn: (patch: { planned_delivery_date?: string | null; delivery_readiness?: DeliveryReadiness }) =>
      salesOrderService.updateDeliveryPlanning(salesOrderId, dealerId, patch),
    onSuccess: () => {
      toast.success("Delivery planning updated");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!so) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Loading…</DialogTitle></DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  const customerName = so.customers?.name ?? so.customer_name_text ?? "—";
  const canConfirm = so.status === "draft";
  const canCancel = ["draft", "confirmed", "partially_delivered"].includes(so.status);
  const canEditPlanning = ["draft", "confirmed", "partially_delivered"].includes(so.status);
  const canEditQty = ["confirmed", "partially_delivered"].includes(so.status);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-auto">
        <DialogHeader className="flex-row items-center justify-between space-y-0">
          <div className="space-y-1">
            <DialogTitle>Sales Order Detail</DialogTitle>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono">{so.so_number}</span>
              <SalesOrderStatusBadge status={so.status} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canConfirm && (
              <Button
                size="sm"
                onClick={() => confirmMutation.mutate()}
                disabled={confirmMutation.isPending}
              >
                <CheckCircle2 className="h-4 w-4 mr-1" /> Approve
              </Button>
            )}
            {canCancel && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const reason = window.prompt("Reason for cancelling this sales order?");
                  if (reason && reason.trim()) cancelMutation.mutate(reason.trim());
                }}
                disabled={cancelMutation.isPending}
              >
                <Ban className="h-4 w-4 mr-1 text-destructive" /> Cancel
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        <Card>
          <CardContent className="py-4 grid md:grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Customer</p>
              <p className="font-medium">{customerName}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Order Date</p>
              <p className="font-medium">{fmtDate(so.order_date)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="font-medium">{formatCurrency(so.total_amount)}</p>
            </div>
            {so.cancel_reason && (
              <div className="md:col-span-3">
                <p className="text-xs text-muted-foreground">Cancel Reason</p>
                <p className="text-destructive">{so.cancel_reason}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-4 space-y-3">
            <p className="text-xs font-semibold uppercase text-muted-foreground">Delivery Planning</p>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-muted-foreground">Planned Delivery Date</label>
                <Input
                  type="date"
                  defaultValue={so.planned_delivery_date ?? ""}
                  disabled={!canEditPlanning}
                  onBlur={(e) => {
                    const v = e.target.value || null;
                    if (v !== so.planned_delivery_date) deliveryPlanningMutation.mutate({ planned_delivery_date: v });
                  }}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Readiness</label>
                <Select
                  value={so.delivery_readiness}
                  disabled={!canEditPlanning}
                  onValueChange={(v) => deliveryPlanningMutation.mutate({ delivery_readiness: v as DeliveryReadiness })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(READINESS_LABEL) as DeliveryReadiness[]).map((k) => (
                      <SelectItem key={k} value={k}>{READINESS_LABEL[k]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0 overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2">Product</th>
                  <th className="text-right px-3 py-2">Qty</th>
                  <th className="text-right px-3 py-2">Rate</th>
                  <th className="text-right px-3 py-2">Total</th>
                  <th className="text-left px-3 py-2">Reserved</th>
                  {canEditQty && <th className="text-right px-3 py-2 w-10"></th>}
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className="border-t align-top">
                    <td className="px-3 py-2">
                      <div className="font-medium">{it.product_name_snapshot}</div>
                      {(it.preferred_shade_code || it.preferred_caliber || it.preferred_batch_no) && (
                        <div className="text-xs text-muted-foreground">
                          {[it.preferred_shade_code, it.preferred_caliber, it.preferred_batch_no].filter(Boolean).join(" · ")}
                        </div>
                      )}
                      {it.caliber_mismatch && (
                        <div className="flex items-center gap-1 text-xs text-destructive mt-1">
                          <AlertTriangle className="h-3 w-3" />
                          Preferred caliber "{it.preferred_caliber}" doesn't match batch "{it.preferred_batch_no}" (actual: {it.actual_batch_caliber})
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {editingItemId === it.id ? (
                        <div className="flex items-center gap-1 justify-end">
                          <Input
                            type="number"
                            step="0.01"
                            className="w-24 h-8"
                            value={editQty}
                            onChange={(e) => setEditQty(e.target.value)}
                            autoFocus
                          />
                          <Button
                            size="sm"
                            className="h-8"
                            onClick={() => updateQtyMutation.mutate({ itemId: it.id, quantity: Number(editQty) })}
                            disabled={updateQtyMutation.isPending || !editQty || Number(editQty) <= 0}
                          >
                            Save
                          </Button>
                          <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditingItemId(null)}>
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <span>{it.quantity} {it.unit_type}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">{formatCurrency(it.rate)}</td>
                    <td className="px-3 py-2 text-right font-semibold">{formatCurrency(it.line_total)}</td>
                    <td className="px-3 py-2">
                      {it.product_id ? (
                        <span className={Number(it.reserved_qty) >= Number(it.quantity) ? "text-primary" : Number(it.reserved_qty) > 0 ? "text-amber-600" : "text-destructive"}>
                          {it.reserved_qty} / {it.quantity}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    {canEditQty && (
                      <td className="px-3 py-2 text-right">
                        {editingItemId !== it.id && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => { setEditingItemId(it.id); setEditQty(String(it.quantity)); }}
                            title="Edit quantity"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </DialogContent>
    </Dialog>
  );
};

export default SalesOrderDetailDialog;
