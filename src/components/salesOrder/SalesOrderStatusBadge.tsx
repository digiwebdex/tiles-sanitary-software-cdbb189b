import { Badge } from "@/components/ui/badge";
import type { SalesOrderStatus } from "@/services/salesOrderService";

const STATUS_LABELS: Record<SalesOrderStatus, string> = {
  draft: "Draft",
  confirmed: "Confirmed",
  partially_delivered: "Partially Delivered",
  completed: "Completed",
  cancelled: "Cancelled",
};

const STATUS_CLASS: Record<SalesOrderStatus, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  confirmed: "bg-primary/15 text-primary border-primary/30",
  partially_delivered: "bg-secondary text-secondary-foreground border-border",
  completed: "bg-accent text-accent-foreground border-border",
  cancelled: "bg-destructive/10 text-destructive border-destructive/20",
};

export function SalesOrderStatusBadge({ status }: { status: SalesOrderStatus }) {
  return (
    <Badge variant="outline" className={STATUS_CLASS[status]}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}
