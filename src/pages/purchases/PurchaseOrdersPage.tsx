import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Eye, PackageCheck, Plus, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";
import {
  purchaseOrderService, type PurchaseOrder, type PurchaseOrderStatus,
} from "@/services/purchaseOrderService";

const STATUS_BADGE: Record<PurchaseOrderStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  ordered: { label: "Ordered (অর্ডারকৃত)", variant: "default" },
  received: { label: "Received (গৃহীত)", variant: "secondary" },
  cancelled: { label: "Cancelled (বাতিল)", variant: "destructive" },
};

export default function PurchaseOrdersPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [viewing, setViewing] = useState<string | null>(null);

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["purchase-orders", statusFilter],
    queryFn: () => purchaseOrderService.list(statusFilter === "all" ? "" : (statusFilter as PurchaseOrderStatus)),
  });

  const { data: detail } = useQuery({
    queryKey: ["purchase-order", viewing],
    queryFn: () => purchaseOrderService.get(viewing!),
    enabled: !!viewing,
  });

  const convertMut = useMutation({
    mutationFn: (id: string) => purchaseOrderService.convert(id),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      toast.success(
        r.already
          ? "আগেই কনভার্ট করা হয়েছে — Purchase Entry-র Draft থেকে খুলুন"
          : "ক্রয় খসড়া তৈরি হয়েছে — Purchase Entry-র Draft থেকে সম্পন্ন করুন",
      );
      navigate("/purchases/new");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => purchaseOrderService.update(id, { status: "cancelled" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      toast.success("PO বাতিল করা হয়েছে");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Purchase Orders <span className="text-muted-foreground font-normal">(ক্রয় আদেশ)</span></h1>
            <p className="text-sm text-muted-foreground">
              সরবরাহকারীকে আগাম অর্ডার দিন — মাল এলে এক ক্লিকে ক্রয়ে রূপান্তর
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="ordered">Ordered</SelectItem>
              <SelectItem value="received">Received</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => navigate("/purchases/orders/new")}>
            <Plus className="mr-1 h-4 w-4" /> New PO
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PO No.</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Order Date</TableHead>
                <TableHead>Expected Delivery</TableHead>
                <TableHead className="text-right">Items</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Advance</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
              ) : orders.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">No purchase orders yet</TableCell></TableRow>
              ) : (
                orders.map((po: PurchaseOrder) => (
                  <TableRow key={po.id}>
                    <TableCell className="font-medium">{po.po_number}</TableCell>
                    <TableCell>{po.supplier_name ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{po.order_date}</TableCell>
                    <TableCell className="whitespace-nowrap">{po.expected_delivery_date ?? "—"}</TableCell>
                    <TableCell className="text-right">{po.item_count ?? 0}</TableCell>
                    <TableCell className="text-right">{formatCurrency(po.total_amount)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(po.advance_paid)}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_BADGE[po.status].variant}>{STATUS_BADGE[po.status].label}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setViewing(po.id)} aria-label="View">
                          <Eye className="h-4 w-4" />
                        </Button>
                        {po.status === "ordered" && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => convertMut.mutate(po.id)}
                              disabled={convertMut.isPending}
                              title="Receive & convert to purchase draft"
                            >
                              <PackageCheck className="mr-1 h-4 w-4" /> Receive
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive"
                              onClick={() => cancelMut.mutate(po.id)}
                              disabled={cancelMut.isPending}
                              aria-label="Cancel"
                            >
                              <XCircle className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!viewing} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {detail?.po_number} — {detail?.supplier_name}
            </DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div><p className="text-muted-foreground">Order Date</p><p className="font-medium">{detail.order_date}</p></div>
                <div><p className="text-muted-foreground">Expected</p><p className="font-medium">{detail.expected_delivery_date ?? "—"}</p></div>
                <div><p className="text-muted-foreground">Advance</p><p className="font-medium">{formatCurrency(detail.advance_paid)}</p></div>
                <div><p className="text-muted-foreground">Status</p><Badge variant={STATUS_BADGE[detail.status].variant}>{STATUS_BADGE[detail.status].label}</Badge></div>
              </div>
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
                  {(detail.items ?? []).map((it) => (
                    <TableRow key={it.id}>
                      <TableCell>{it.product_name ?? it.product_id}</TableCell>
                      <TableCell className="text-right">{it.quantity}</TableCell>
                      <TableCell className="text-right">{formatCurrency(it.unit_price)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(it.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="text-right font-semibold">Total: {formatCurrency(detail.total_amount)}</p>
              {detail.notes && <p className="text-sm text-muted-foreground">Notes: {detail.notes}</p>}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
