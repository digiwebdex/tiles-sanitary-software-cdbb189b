import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDealerId } from "@/hooks/useDealerId";
import { inventoryIntelligenceService } from "@/services/inventoryIntelligenceService";
import { formatCurrency } from "@/lib/utils";
import { ArrowRight } from "lucide-react";

const scoreColor = (score: number) => (score >= 80 ? "text-green-600" : score >= 60 ? "text-amber-600" : "text-destructive");

/**
 * V2 Sprint 3D — Inventory Health Dashboard. Fast/Slow-moving counts here
 * are read from the same existing demand-planning classification already
 * used by the Reports module's Fast/Slow Moving reports (not duplicated) —
 * this tab links out to those reports and to the Auto-PO page rather than
 * rebuilding them.
 */
const HealthDashboardTab = () => {
  const dealerId = useDealerId();
  const { data, isLoading } = useQuery({
    queryKey: ["inventory-health", dealerId],
    queryFn: () => inventoryIntelligenceService.getHealth(dealerId),
    enabled: !!dealerId,
  });

  if (isLoading || !data) return <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Inventory Health Score</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className={`text-5xl font-bold ${scoreColor(data.score)}`}>{data.score}<span className="text-xl text-muted-foreground">/100</span></p>
          <div className="space-y-1">
            {data.breakdown.map(b => (
              <div key={b.label} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{b.label}</span>
                <span className={b.penalty > 0 ? "text-destructive" : ""}>-{b.penalty}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Understock</p><p className="text-2xl font-bold">{data.understockCount}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Overstock</p><p className="text-2xl font-bold">{data.overstockCount}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Stockout Risk</p><p className="text-2xl font-bold">{data.stockoutRiskCount}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Dead Stock Value</p><p className="text-2xl font-bold">{formatCurrency(data.deadStockValue)}</p></CardContent></Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-6 flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Fast Moving Items</p>
              <p className="text-2xl font-bold">{data.fastMovingCount}</p>
            </div>
            <Link to="/reports" className="text-sm text-primary flex items-center gap-1 hover:underline">
              View in Reports <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Slow Moving Items ({data.deadStockCount} dead)</p>
              <p className="text-2xl font-bold">{data.slowMovingCount}</p>
            </div>
            <Link to="/reports" className="text-sm text-primary flex items-center gap-1 hover:underline">
              View in Reports <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-6 flex items-center justify-between">
          <div>
            <p className="font-medium">Reorder Suggestions & Auto-PO</p>
            <p className="text-sm text-muted-foreground">Generate draft purchase orders for low-stock products, grouped by supplier.</p>
          </div>
          <Link to="/purchases/auto-draft" className="text-sm text-primary flex items-center gap-1 hover:underline">
            Open Auto-PO <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </CardContent>
      </Card>
    </div>
  );
};

export default HealthDashboardTab;
