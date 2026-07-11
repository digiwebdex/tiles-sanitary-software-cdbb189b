import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { availabilityService } from "@/services/availabilityService";

/**
 * V2 Sprint 4A — "Quotation Product Selection": shows only Available
 * Quantity (Sprint 3C's Availability Engine, read-only). Does NOT reserve
 * stock — a quotation is non-binding, so this is purely informational.
 * One cell per line item, fetched independently and cached by product_id
 * (a quotation typically has a handful of lines, so this stays cheap —
 * there is no bulk-availability endpoint to call instead, and adding one
 * would mean modifying Sprint 3C's frozen availability route).
 */
const AvailabilityCell = ({ productId, dealerId }: { productId: string | null | undefined; dealerId: string }) => {
  const { data, isLoading } = useQuery({
    queryKey: ["quotation-line-availability", dealerId, productId],
    queryFn: () => availabilityService.getAvailability(productId!, dealerId),
    enabled: !!productId && !!dealerId,
    staleTime: 30_000,
  });

  if (!productId) return <span className="text-xs text-muted-foreground">—</span>;
  if (isLoading) return <span className="text-xs text-muted-foreground">…</span>;
  if (!data) return <span className="text-xs text-muted-foreground">—</span>;

  const low = data.available_pieces <= 0;
  return (
    <span className={`text-xs whitespace-nowrap flex items-center gap-1 ${low ? "text-destructive" : "text-muted-foreground"}`}>
      {low && <AlertTriangle className="h-3 w-3" />}
      {data.available_display}
    </span>
  );
};

export default AvailabilityCell;
