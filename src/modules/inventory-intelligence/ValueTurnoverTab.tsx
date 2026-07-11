import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDealerId } from "@/hooks/useDealerId";
import { inventoryIntelligenceService } from "@/services/inventoryIntelligenceService";
import { formatCurrency } from "@/lib/utils";

/** V2 Sprint 3D — Stock/Warehouse/Godown Value + Inventory Turnover. */
const ValueTurnoverTab = () => {
  const dealerId = useDealerId();
  const { data: value, isLoading: valueLoading } = useQuery({
    queryKey: ["inventory-value", dealerId],
    queryFn: () => inventoryIntelligenceService.getValue(dealerId),
    enabled: !!dealerId,
  });
  const { data: turnover, isLoading: turnoverLoading } = useQuery({
    queryKey: ["inventory-turnover", dealerId],
    queryFn: () => inventoryIntelligenceService.getTurnover(dealerId),
    enabled: !!dealerId,
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Stock Value</CardTitle></CardHeader>
        <CardContent>
          {valueLoading ? <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p> : (
            <p className="text-2xl font-bold text-primary">{formatCurrency(value?.totalStockValue ?? 0)}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Warehouse Value</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Warehouse</TableHead><TableHead className="text-right">Value</TableHead></TableRow></TableHeader>
            <TableBody>
              {value?.byWarehouse.map(w => (
                <TableRow key={w.warehouse_id}><TableCell>{w.warehouse_name}</TableCell><TableCell className="text-right">{formatCurrency(w.value)}</TableCell></TableRow>
              ))}
              {!value?.byWarehouse.length && <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground py-6">No warehouse stock recorded.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Godown Value</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Godown</TableHead><TableHead className="text-right">Value</TableHead></TableRow></TableHeader>
            <TableBody>
              {value?.byGodown.map(g => (
                <TableRow key={g.godown_id}><TableCell>{g.godown_name}</TableCell><TableCell className="text-right">{formatCurrency(g.value)}</TableCell></TableRow>
              ))}
              {!value?.byGodown.length && <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground py-6">No godown stock recorded.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Inventory Turnover</CardTitle>
          <p className="text-sm text-muted-foreground">Approximated from trailing 90-day cost of goods sold vs. current stock value (annualized).</p>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          {turnoverLoading ? <p className="text-sm text-muted-foreground py-6 text-center col-span-2">Loading…</p> : (
            <>
              <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Turnover Ratio (annualized)</p><p className="text-xl font-bold">{turnover?.turnoverRatioAnnualized ?? 0}×</p></div>
              <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Days Sales of Inventory</p><p className="text-xl font-bold">{turnover?.daysSalesOfInventory ?? "—"}</p></div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ValueTurnoverTab;
