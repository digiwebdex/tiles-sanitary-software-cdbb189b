/**
 * Batch/Stock Cost Update — V2 Sprint 5E.
 * No per-batch cost column exists anywhere in this codebase — this adjusts
 * the dealer-wide product cost (`stock.average_cost_per_unit`), which is
 * the only place unit cost is stored. See docs/SPRINT5E_PURCHASE_RETURN.md
 * for why this is scoped as a product-level (not true per-batch) update.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useDealerId } from "@/hooks/useDealerId";
import { stockCostAdjustmentService } from "@/services/stockCostAdjustmentService";
import { productService } from "@/services/productService";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Search, Plus } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

const StockCostAdjustmentsPage = () => {
  const dealerId = useDealerId();
  const queryClient = useQueryClient();
  const [productSearch, setProductSearch] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<{ id: string; name: string; sku?: string } | null>(null);
  const [newAvgCost, setNewAvgCost] = useState("");
  const [reason, setReason] = useState("");

  const { data: history = [], isLoading } = useQuery({
    queryKey: ["stock-cost-adjustments", dealerId],
    queryFn: () => stockCostAdjustmentService.list(dealerId),
    enabled: !!dealerId,
  });

  const { data: productResults } = useQuery({
    queryKey: ["cost-adjustment-product-search", dealerId, productSearch],
    queryFn: () => productService.list(dealerId, productSearch, 1),
    enabled: !!dealerId && !selectedProduct && productSearch.trim().length > 1,
  });

  const createMutation = useMutation({
    mutationFn: () => stockCostAdjustmentService.create(dealerId, {
      product_id: selectedProduct!.id,
      new_avg_cost: Number(newAvgCost),
      reason,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stock-cost-adjustments"] });
      toast.success("Cost adjustment recorded");
      setSelectedProduct(null);
      setNewAvgCost("");
      setReason("");
      setProductSearch("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Batch / Stock Cost Update</h1>
        <p className="text-sm text-muted-foreground">Adjust a product's average cost per unit — e.g. after a physical revaluation. Every change is logged below.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Record a Cost Adjustment</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="mb-1 block">Product</Label>
            {selectedProduct ? (
              <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm max-w-md">
                <span>{selectedProduct.name} {selectedProduct.sku ? `(${selectedProduct.sku})` : ""}</span>
                <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => setSelectedProduct(null)}>Change</button>
              </div>
            ) : (
              <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Search a product…" value={productSearch} onChange={(e) => setProductSearch(e.target.value)} className="pl-9" />
                {productSearch.trim().length > 1 && (productResults?.data?.length ?? 0) > 0 && (
                  <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-md max-h-56 overflow-y-auto">
                    {productResults!.data.map((p: any) => (
                      <button key={p.id} type="button" className="block w-full text-left px-3 py-2 text-sm hover:bg-accent" onClick={() => { setSelectedProduct({ id: p.id, name: p.name, sku: p.sku }); setProductSearch(""); }}>
                        {p.name} {p.sku ? `(${p.sku})` : ""}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2 max-w-md">
            <div>
              <Label className="mb-1 block">New Average Cost</Label>
              <Input type="number" min={0} step="0.01" value={newAvgCost} onChange={(e) => setNewAvgCost(e.target.value)} />
            </div>
          </div>
          <div className="max-w-md">
            <Label className="mb-1 block">Reason</Label>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this cost being adjusted?" />
          </div>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending || !selectedProduct || !newAvgCost || !reason.trim()}
          >
            <Plus className="mr-2 h-4 w-4" /> Record Adjustment
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Adjustment History</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Old Cost</TableHead>
                  <TableHead className="text-right">New Cost</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>
                ) : history.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">No cost adjustments recorded yet</TableCell></TableRow>
                ) : (
                  history.map((h) => (
                    <TableRow key={h.id}>
                      <TableCell className="text-xs whitespace-nowrap">{new Date(h.created_at).toLocaleDateString()}</TableCell>
                      <TableCell>{h.product_name ?? h.product_sku ?? h.product_id}</TableCell>
                      <TableCell className="text-right">{formatCurrency(h.old_avg_cost)}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(h.new_avg_cost)}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs capitalize">{h.adjustment_type === "landed_cost" ? "Landed Cost" : "Manual"}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-xs truncate">{h.reason}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default StockCostAdjustmentsPage;
