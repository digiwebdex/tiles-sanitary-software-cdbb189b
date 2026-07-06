import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { salesService } from "@/services/salesService";
import { History } from "lucide-react";

/**
 * V2 Sprint 4C — Invoice Timeline / Audit Trail. Read-only; reuses the
 * existing audit_logs/challans/deliveries/customer_ledger data via
 * GET /api/sales/:id/timeline — no new logging, purely a consolidated view.
 */
const InvoiceTimeline = ({ saleId, dealerId }: { saleId: string; dealerId?: string }) => {
  const { data: events = [], isLoading } = useQuery({
    queryKey: ["invoice-timeline", saleId],
    queryFn: () => salesService.getTimeline(saleId, dealerId),
    enabled: !!saleId,
  });

  const fmt = (at: string) =>
    new Date(at).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <History className="h-4 w-4" /> Invoice Timeline
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : events.length === 0 ? (
          <p className="text-xs text-muted-foreground">No history yet.</p>
        ) : (
          <ol className="space-y-2 border-l border-border pl-4">
            {events.map((e, idx) => (
              <li key={idx} className="text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{e.label}</span>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">{fmt(e.at)}</span>
                </div>
                {e.type === "payment_received" && e.detail?.amount != null && (
                  <p className="text-xs text-muted-foreground">Amount: {String(e.detail.amount)}</p>
                )}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
};

export default InvoiceTimeline;
