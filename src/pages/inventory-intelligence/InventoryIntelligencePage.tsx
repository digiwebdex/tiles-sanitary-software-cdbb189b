import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart3 } from "lucide-react";
import LowStockTab from "@/modules/inventory-intelligence/LowStockTab";
import StockAgingTab from "@/modules/inventory-intelligence/StockAgingTab";
import AnalyticsTab from "@/modules/inventory-intelligence/AnalyticsTab";
import ValueTurnoverTab from "@/modules/inventory-intelligence/ValueTurnoverTab";
import HealthDashboardTab from "@/modules/inventory-intelligence/HealthDashboardTab";

/**
 * V2 Sprint 3D — Inventory Intelligence. New page (does not modify Sprint
 * 3A's InventoryPage.tsx, Sprint 3B's WarehousesPage.tsx, Sprint 3C's
 * ReservationsPage.tsx, or the Reports module). Dead/Slow/Fast-Moving Stock
 * and Reorder/Purchase Suggestions already exist elsewhere (Reports module,
 * /purchases/auto-draft) and are linked from the Health tab rather than
 * duplicated here.
 */
const InventoryIntelligencePage = () => {
  const [tab, setTab] = useState("health");

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><BarChart3 className="h-6 w-6 text-primary" /> Inventory Intelligence</h1>
        <p className="text-sm text-muted-foreground mt-1">Low stock thresholds, stock aging, ABC/XYZ analytics, value & turnover, and overall inventory health.</p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="health">Health Dashboard</TabsTrigger>
          <TabsTrigger value="low-stock">Low Stock</TabsTrigger>
          <TabsTrigger value="aging">Stock Aging</TabsTrigger>
          <TabsTrigger value="analytics">ABC/XYZ Analytics</TabsTrigger>
          <TabsTrigger value="value">Value & Turnover</TabsTrigger>
        </TabsList>

        <TabsContent value="health"><HealthDashboardTab /></TabsContent>
        <TabsContent value="low-stock"><LowStockTab /></TabsContent>
        <TabsContent value="aging"><StockAgingTab /></TabsContent>
        <TabsContent value="analytics"><AnalyticsTab /></TabsContent>
        <TabsContent value="value"><ValueTurnoverTab /></TabsContent>
      </Tabs>
    </div>
  );
};

export default InventoryIntelligencePage;
