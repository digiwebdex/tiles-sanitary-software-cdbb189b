import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CalendarClock, AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useDealerInfo } from "@/hooks/useDealerInfo";
import { usePermissions } from "@/hooks/usePermissions";
import ReservationsTab from "@/modules/reservations/ReservationsTab";
import BackordersTab from "@/modules/reservations/BackordersTab";
import AvailabilityTab from "@/modules/reservations/AvailabilityTab";

/**
 * V2 Sprint 3C — Reservation, Backorder & Availability Engine.
 * New page (does not modify Sprint 3A's InventoryPage.tsx or Sprint 3B's
 * WarehousesPage.tsx) consolidating the sprint's operational surfaces.
 */
const ReservationsPage = () => {
  const [tab, setTab] = useState("reservations");
  const navigate = useNavigate();
  const { data: dealerInfo } = useDealerInfo();
  const { isDealerAdmin } = usePermissions();
  const reservationsEnabled = dealerInfo?.enable_reservations === true;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><CalendarClock className="h-6 w-6 text-primary" /> Reservations & Backorders</h1>
        <p className="text-sm text-muted-foreground mt-1">Stock reservations, allocations, backorder status, and live availability.</p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="reservations">Reservations</TabsTrigger>
          <TabsTrigger value="allocations">Allocations</TabsTrigger>
          <TabsTrigger value="backorders">Backorders</TabsTrigger>
          <TabsTrigger value="availability">Availability</TabsTrigger>
        </TabsList>

        <TabsContent value="reservations">
          {reservationsEnabled ? <ReservationsTab kind="reservation" /> : (
            <Card><CardContent className="pt-6 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <AlertTriangle className="h-4 w-4" />
                <span className="text-sm">Stock Reservations are turned off for this dealer.</span>
              </div>
              {isDealerAdmin && <Button size="sm" variant="outline" onClick={() => navigate("/settings")}>Enable in Settings</Button>}
            </CardContent></Card>
          )}
        </TabsContent>
        <TabsContent value="allocations">
          {reservationsEnabled ? <ReservationsTab kind="allocation" /> : (
            <Card><CardContent className="pt-6 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <AlertTriangle className="h-4 w-4" />
                <span className="text-sm">Stock Allocation reuses the Reservation mechanism, which is turned off for this dealer.</span>
              </div>
              {isDealerAdmin && <Button size="sm" variant="outline" onClick={() => navigate("/settings")}>Enable in Settings</Button>}
            </CardContent></Card>
          )}
        </TabsContent>
        <TabsContent value="backorders"><BackordersTab /></TabsContent>
        <TabsContent value="availability"><AvailabilityTab /></TabsContent>
      </Tabs>
    </div>
  );
};

export default ReservationsPage;
