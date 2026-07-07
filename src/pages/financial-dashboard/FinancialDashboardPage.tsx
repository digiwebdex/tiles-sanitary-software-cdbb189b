/**
 * Financial Dashboard — V2 Sprint 6E.
 * Reuses the same helpers the Balance Sheet uses (reportQueryService.ts) via
 * financialDashboardService.ts — see that route for detail.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDealerId } from "@/hooks/useDealerId";
import { financialDashboardService } from "@/services/financialDashboardService";
import { Gauge, TrendingUp, TrendingDown, Wallet, Landmark, HandCoins, Boxes, Scale } from "lucide-react";

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const firstOfMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; };
const today = () => new Date().toISOString().slice(0, 10);

const KpiCard = ({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone?: "positive" | "negative" }) => (
  <Card>
    <CardContent className="pt-6 flex items-start justify-between">
      <div>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className={`text-2xl font-bold ${tone === "positive" ? "text-emerald-600" : tone === "negative" ? "text-destructive" : ""}`}>{value}</p>
      </div>
      <Icon className="h-5 w-5 text-muted-foreground" />
    </CardContent>
  </Card>
);

const FinancialDashboardPage = () => {
  const dealerId = useDealerId();
  const [period, setPeriod] = useState({ from: firstOfMonth(), to: today() });

  const { data, isLoading } = useQuery({
    queryKey: ["financial-dashboard", dealerId, period],
    queryFn: () => financialDashboardService.get(dealerId, period.from, period.to),
    enabled: !!dealerId,
  });

  return (
    <div className="container mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-bold flex items-center gap-2"><Gauge className="h-6 w-6" /> Financial Dashboard</h1>

      <Card>
        <CardContent className="pt-6 flex flex-wrap gap-3 items-end">
          <div><Label>From</Label><Input type="date" value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} /></div>
          <div><Label>To</Label><Input type="date" value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} /></div>
        </CardContent>
      </Card>

      {isLoading && <p>Loading…</p>}

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard icon={TrendingUp} label="Revenue" value={money(data.revenue)} />
            <KpiCard icon={TrendingDown} label="Expenses" value={money(data.expenses)} />
            <KpiCard icon={Wallet} label="Profit" value={money(data.profit)} tone={data.profit >= 0 ? "positive" : "negative"} />
            <KpiCard icon={Landmark} label="Cash Position" value={money(data.cash_position)} />
            <KpiCard icon={HandCoins} label="Receivable" value={money(data.receivable)} />
            <KpiCard icon={HandCoins} label="Payable" value={money(data.payable)} />
            <KpiCard icon={Boxes} label="Inventory Value" value={money(data.inventory_value)} />
            <KpiCard icon={Scale} label="Working Capital" value={money(data.working_capital)} tone={data.working_capital >= 0 ? "positive" : "negative"} />
          </div>

          <Card>
            <CardHeader><CardTitle>Liquidity</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Current Ratio</p>
                <p className="text-2xl font-bold">{data.current_ratio != null ? data.current_ratio.toFixed(2) : "—"}</p>
                <p className="text-xs text-muted-foreground">Current Assets ÷ Current Liabilities</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Current Assets</p>
                <p className="text-xl font-semibold">{money(data.current_assets)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Current Liabilities</p>
                <p className="text-xl font-semibold">{money(data.current_liabilities)}</p>
              </div>
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">{data.data_source}</p>
        </>
      )}
    </div>
  );
};

export default FinancialDashboardPage;
