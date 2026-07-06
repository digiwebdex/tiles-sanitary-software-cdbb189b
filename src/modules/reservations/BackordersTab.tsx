import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDealerId } from "@/hooks/useDealerId";
import { backorderAllocationService, FULFILLMENT_STATUS_LABELS, FULFILLMENT_STATUS_COLORS } from "@/services/backorderAllocationService";

/**
 * V2 Sprint 3C — Backorder: customer backorder status/history (existing
 * read-only /api/backorders/* endpoints) + "Supplier Backorder" (which
 * purchase is expected to cover which shortage, via the existing
 * purchase_shortage_links table). No write logic here — all backorder
 * allocation happens atomically inside Sale/Purchase creation, unchanged.
 */
const BackordersTab = () => {
  const dealerId = useDealerId();

  const { data: stats } = useQuery({
    queryKey: ["backorder-dashboard-stats", dealerId],
    queryFn: () => backorderAllocationService.getDashboardStats(dealerId),
    enabled: !!dealerId,
  });
  const { data: pending = [] } = useQuery({
    queryKey: ["backorder-pending", dealerId],
    queryFn: () => backorderAllocationService.getPendingFulfillment(dealerId),
    enabled: !!dealerId,
  });
  const { data: supplierLinks = [] } = useQuery({
    queryKey: ["backorder-supplier-links", dealerId],
    queryFn: () => backorderAllocationService.getSupplierLinks(dealerId),
    enabled: !!dealerId,
  });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Total Backorders</p><p className="text-2xl font-bold mt-1">{stats?.totalBackorders ?? 0}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Pending Fulfillment</p><p className="text-2xl font-bold mt-1">{stats?.pendingFulfillment ?? 0}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Ready for Delivery</p><p className="text-2xl font-bold mt-1">{stats?.readyForDelivery ?? 0}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Partially Delivered</p><p className="text-2xl font-bold mt-1">{stats?.partiallyDelivered ?? 0}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Customer Backorders — Pending</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Invoice</TableHead><TableHead>Customer</TableHead><TableHead>Product</TableHead>
              <TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Backordered</TableHead>
              <TableHead className="text-right">Allocated</TableHead><TableHead>Status</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {pending.map((item: any) => (
                <TableRow key={item.id}>
                  <TableCell className="text-xs">{item.sales?.invoice_number ?? "—"}</TableCell>
                  <TableCell>{item.sales?.customers?.name ?? "—"}</TableCell>
                  <TableCell>{item.products?.name ?? "—"}</TableCell>
                  <TableCell className="text-right">{Number(item.quantity)}</TableCell>
                  <TableCell className="text-right">{Number(item.backorder_qty)}</TableCell>
                  <TableCell className="text-right">{Number(item.allocated_qty)}</TableCell>
                  <TableCell>
                    <span className={FULFILLMENT_STATUS_COLORS[item.fulfillment_status] ?? ""}>
                      {FULFILLMENT_STATUS_LABELS[item.fulfillment_status] ?? item.fulfillment_status}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
              {!pending.length && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No pending backorders.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Supplier Backorder</CardTitle>
          <p className="text-sm text-muted-foreground">Which purchase order is expected to cover which customer shortage.</p>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Customer</TableHead><TableHead>Product</TableHead>
              <TableHead className="text-right">Planned Qty</TableHead>
              <TableHead>Supplier</TableHead><TableHead>Purchase</TableHead><TableHead>Linked</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {supplierLinks.map((l: any) => (
                <TableRow key={l.id}>
                  <TableCell>{l.sale_item?.customer_name ?? "—"}</TableCell>
                  <TableCell>{l.sale_item?.product_name ?? "—"} <span className="text-xs text-muted-foreground">{l.sale_item?.product_sku}</span></TableCell>
                  <TableCell className="text-right">{Number(l.planned_qty)}</TableCell>
                  <TableCell>{l.purchase?.supplier_name ?? "—"}</TableCell>
                  <TableCell className="text-xs">{l.purchase?.invoice_number ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{l.created_at ? new Date(l.created_at).toLocaleDateString() : "—"}</TableCell>
                </TableRow>
              ))}
              {!supplierLinks.length && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No supplier links recorded yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default BackordersTab;
