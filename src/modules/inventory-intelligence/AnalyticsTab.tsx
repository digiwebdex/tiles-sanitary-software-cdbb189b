import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDealerId } from "@/hooks/useDealerId";
import { inventoryIntelligenceService } from "@/services/inventoryIntelligenceService";
import { formatCurrency } from "@/lib/utils";

const ABC_VARIANT: Record<string, "default" | "secondary" | "outline"> = { A: "default", B: "secondary", C: "outline" };

/** V2 Sprint 3D — Inventory Analytics: ABC (value Pareto) x XYZ (demand variability). */
const AnalyticsTab = () => {
  const dealerId = useDealerId();
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["inventory-analytics", dealerId],
    queryFn: () => inventoryIntelligenceService.getAnalytics(dealerId),
    enabled: !!dealerId,
  });

  const classCounts = rows.reduce((acc, r) => {
    acc[r.abc_class] = (acc[r.abc_class] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <Card>
      <CardHeader>
        <CardTitle>ABC / XYZ Analysis</CardTitle>
        <p className="text-sm text-muted-foreground">
          ABC ranks products by stock-value contribution (A = top 70% of value, B = next 20%, C = remaining 10%).
          XYZ ranks by demand variability across the last three 30-day windows (X = stable, Y = variable, Z = erratic/no sales).
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          {["A", "B", "C"].map(c => (
            <div key={c} className="rounded-md border p-3">
              <Badge variant={ABC_VARIANT[c]} className="mb-1">Class {c}</Badge>
              <p className="text-xl font-bold">{classCounts[c] ?? 0} <span className="text-sm font-normal text-muted-foreground">products</span></p>
            </div>
          ))}
        </div>

        {isLoading ? <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p> : (
          <Table>
            <TableHeader><TableRow>
              <TableHead>Product</TableHead><TableHead className="text-right">Stock Value</TableHead>
              <TableHead className="text-right">Value Share</TableHead><TableHead className="text-right">Cumulative</TableHead>
              <TableHead>Class</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.product_id}>
                  <TableCell className="font-medium">{r.name} <span className="text-xs text-muted-foreground">{r.sku}</span></TableCell>
                  <TableCell className="text-right">{formatCurrency(r.stock_value)}</TableCell>
                  <TableCell className="text-right">{r.value_share_pct.toFixed(1)}%</TableCell>
                  <TableCell className="text-right">{r.cumulative_value_share_pct.toFixed(1)}%</TableCell>
                  <TableCell><Badge variant={ABC_VARIANT[r.abc_class]}>{r.combined_class}</Badge></TableCell>
                </TableRow>
              ))}
              {!rows.length && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No stock value data yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
};

export default AnalyticsTab;
