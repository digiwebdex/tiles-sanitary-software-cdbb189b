import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useDealerId } from "@/hooks/useDealerId";
import { inventoryIntelligenceService, type LowStockRow, type LowStockStatus } from "@/services/inventoryIntelligenceService";

const STATUS_LABEL: Record<LowStockStatus, string> = {
  understock: "Understock", reorder: "Reorder", ok: "OK", overstock: "Overstock",
};
const STATUS_VARIANT: Record<LowStockStatus, "default" | "destructive" | "secondary" | "outline"> = {
  understock: "destructive", reorder: "secondary", ok: "outline", overstock: "default",
};

/** V2 Sprint 3D — Low Stock Monitoring: reorder level (existing) + new Min/Max Stock thresholds. */
const LowStockTab = () => {
  const dealerId = useDealerId();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<LowStockRow | null>(null);
  const [minStock, setMinStock] = useState("");
  const [maxStock, setMaxStock] = useState("");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["low-stock", dealerId],
    queryFn: () => inventoryIntelligenceService.getLowStock(dealerId),
    enabled: !!dealerId,
  });

  const saveMut = useMutation({
    mutationFn: () => inventoryIntelligenceService.setThreshold(dealerId, editing!.product_id, {
      min_stock: minStock === "" ? null : Number(minStock),
      max_stock: maxStock === "" ? null : Number(maxStock),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["low-stock"] });
      setEditing(null);
      toast.success("Stock thresholds saved");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const counts = rows.reduce(
    (acc, r) => { acc[r.status]++; return acc; },
    { understock: 0, reorder: 0, ok: 0, overstock: 0 } as Record<LowStockStatus, number>,
  );

  const startEdit = (r: LowStockRow) => {
    setEditing(r);
    setMinStock(r.min_stock != null ? String(r.min_stock) : "");
    setMaxStock(r.max_stock != null ? String(r.max_stock) : "");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Low Stock Monitoring</CardTitle>
        <p className="text-sm text-muted-foreground">Reorder Level and Safety Stock are computed from sales velocity (existing Demand Planning). Min/Max Stock are optional per-product overrides you set here.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Understock</p><p className="text-xl font-bold text-destructive">{counts.understock}</p></div>
          <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Reorder</p><p className="text-xl font-bold">{counts.reorder}</p></div>
          <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">OK</p><p className="text-xl font-bold">{counts.ok}</p></div>
          <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Overstock</p><p className="text-xl font-bold">{counts.overstock}</p></div>
        </div>

        {isLoading ? <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p> : (
          <Table>
            <TableHeader><TableRow>
              <TableHead>Product</TableHead><TableHead className="text-right">Free Stock</TableHead>
              <TableHead className="text-right">Reorder Level</TableHead>
              <TableHead className="text-right">Min Stock</TableHead><TableHead className="text-right">Max Stock</TableHead>
              <TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.filter(r => r.status !== "ok").map(r => (
                <TableRow key={r.product_id}>
                  <TableCell className="font-medium">{r.name} <span className="text-xs text-muted-foreground">{r.sku}</span></TableCell>
                  <TableCell className="text-right">{r.free_stock}</TableCell>
                  <TableCell className="text-right">{r.reorder_level}</TableCell>
                  <TableCell className="text-right">{r.min_stock ?? "—"}</TableCell>
                  <TableCell className="text-right">{r.max_stock ?? "—"}</TableCell>
                  <TableCell><Badge variant={STATUS_VARIANT[r.status]}>{STATUS_LABEL[r.status]}</Badge></TableCell>
                  <TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => startEdit(r)}>Set Min/Max</Button></TableCell>
                </TableRow>
              ))}
              {!rows.filter(r => r.status !== "ok").length && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">All products are within healthy stock levels.</TableCell></TableRow>}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Set Min/Max Stock — {editing?.name}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Minimum Stock</Label><Input type="number" min={0} value={minStock} onChange={e => setMinStock(e.target.value)} placeholder="No minimum" /></div>
            <div><Label>Maximum Stock</Label><Input type="number" min={0} value={maxStock} onChange={e => setMaxStock(e.target.value)} placeholder="No maximum" /></div>
          </div>
          <Button className="w-full mt-3" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>Save</Button>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default LowStockTab;
