import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useDealerId } from "@/hooks/useDealerId";
import { goodsReceiptService } from "@/services/goodsReceiptService";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Pencil, Check, Ban, Trash2 } from "lucide-react";

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  completed: "Completed",
  cancelled: "Cancelled",
};

const GoodsReceiptDetail = () => {
  const { id } = useParams<{ id: string }>();
  const dealerId = useDealerId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: gr, isLoading } = useQuery({
    queryKey: ["goods-receipt", id, dealerId],
    queryFn: () => goodsReceiptService.getById(id!, dealerId),
    enabled: !!id && !!dealerId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["goods-receipt", id, dealerId] });
    queryClient.invalidateQueries({ queryKey: ["goods-receipts"] });
  };

  const completeMutation = useMutation({
    mutationFn: () => goodsReceiptService.complete(id!, dealerId),
    onSuccess: () => { invalidate(); toast.success("Goods receipt completed — stock has been posted."); },
    onError: (e: Error) => toast.error(e.message),
  });
  const cancelMutation = useMutation({
    mutationFn: () => goodsReceiptService.cancel(id!, dealerId),
    onSuccess: () => { invalidate(); toast.success("Draft cancelled"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteMutation = useMutation({
    mutationFn: () => goodsReceiptService.remove(id!, dealerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["goods-receipts"] });
      toast.success("Draft deleted");
      navigate("/goods-receipts");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (!gr) {
    navigate("/goods-receipts");
    return null;
  }

  return (
    <div className="p-4 lg:p-6 max-w-4xl mx-auto space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>{gr.grn_number ?? "Draft Goods Receipt"}</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              PO {gr.po_number ?? "—"} · {gr.supplier_name ?? "—"}
            </p>
          </div>
          <Badge variant={gr.status === "completed" ? "default" : gr.status === "cancelled" ? "destructive" : "outline"}>
            {STATUS_LABEL[gr.status]}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          {gr.notes && <p className="text-sm text-muted-foreground">{gr.notes}</p>}
          <p className="text-sm text-muted-foreground">Receive Date: {new Date(gr.receive_date).toLocaleDateString()}</p>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Received Qty</TableHead>
                <TableHead>Batch / Lot</TableHead>
                <TableHead>Shade / Caliber</TableHead>
                <TableHead>Location</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {gr.items.map((it) => (
                <TableRow key={it.id}>
                  <TableCell>{it.product_sku ?? it.product_id}</TableCell>
                  <TableCell className="text-right">{it.received_qty}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{it.batch_no ?? "—"}{it.lot_no ? ` / ${it.lot_no}` : ""}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{[it.shade_code, it.caliber].filter(Boolean).join(" / ") || "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {[it.warehouse_name, it.godown_name, it.rack_name, it.bin_code].filter(Boolean).join(" → ") || "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="flex flex-wrap gap-2 pt-2">
            {gr.status === "draft" && (
              <>
                <Button variant="outline" onClick={() => navigate(`/goods-receipts/${gr.id}/edit`)}>
                  <Pencil className="mr-2 h-4 w-4" /> Edit
                </Button>
                <Button onClick={() => completeMutation.mutate()} disabled={completeMutation.isPending}>
                  <Check className="mr-2 h-4 w-4" /> Complete Receive
                </Button>
                <Button variant="outline" onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending}>
                  <Ban className="mr-2 h-4 w-4" /> Cancel
                </Button>
                <Button
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  onClick={() => { if (confirm("Delete this draft?")) deleteMutation.mutate(); }}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="mr-2 h-4 w-4" /> Delete
                </Button>
              </>
            )}
            {gr.status === "completed" && (
              <p className="text-sm text-muted-foreground">
                Stock has been posted to inventory. Completed goods receipts cannot be edited or reversed.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default GoodsReceiptDetail;
