/**
 * Purchase Return List — V2 Sprint 5E.
 * A separate page from the legacy /purchase-returns (kept untouched for
 * backward compatibility) — this one talks to the new draft/complete/cancel
 * lifecycle with over-return prevention. See docs/SPRINT5E_PURCHASE_RETURN.md.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { purchaseReturnV2Service, type PurchaseReturnStatus } from "@/services/purchaseReturnV2Service";
import { useDealerId } from "@/hooks/useDealerId";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

const STATUS_BADGE: Record<PurchaseReturnStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-muted text-muted-foreground" },
  completed: { label: "Completed", className: "bg-green-100 text-green-700" },
  cancelled: { label: "Cancelled", className: "bg-red-100 text-red-700" },
};

const PurchaseReturnsV2Page = () => {
  const dealerId = useDealerId();
  const navigate = useNavigate();
  const [page] = useState(1);

  // Reuses the same `purchase_returns` table the legacy list reads —
  // both creation paths (old and new) show up together in one place.
  const { data, isLoading } = useQuery({
    queryKey: ["purchase-returns-v2", dealerId, page],
    queryFn: async () => {
      const res = await vpsAuthedFetch(`/api/returns/purchases?dealerId=${encodeURIComponent(dealerId)}&page=${page}`);
      const body = await res.json();
      return { data: body.data ?? [], total: body.total ?? 0 };
    },
    enabled: !!dealerId,
  });

  const rows = data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Purchase Returns</h1>
          <p className="text-sm text-muted-foreground">Return goods against a posted Purchase Invoice — full or partial, with automatic stock and supplier balance adjustment.</p>
        </div>
        <Button onClick={() => navigate("/purchase-returns-v2/new")}>
          <Plus className="mr-2 h-4 w-4" /> Create Return
        </Button>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 space-y-3">
          <p className="text-muted-foreground">No purchase returns found.</p>
          <Button onClick={() => navigate("/purchase-returns-v2/new")}>
            <Plus className="mr-2 h-4 w-4" /> Create Your First Return
          </Button>
        </div>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Return No</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r: any) => {
                const status = (r.status as PurchaseReturnStatus) ?? "completed";
                const badge = STATUS_BADGE[status] ?? STATUS_BADGE.completed;
                return (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => navigate(`/purchase-returns-v2/${r.id}`)}>
                    <TableCell className="font-mono text-sm">{r.return_no}</TableCell>
                    <TableCell>{r.suppliers?.name ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{r.return_date}</TableCell>
                    <TableCell><Badge variant="secondary" className={badge.className}>{badge.label}</Badge></TableCell>
                    <TableCell className="text-right">{formatCurrency(Number(r.total_amount) || 0)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
};

export default PurchaseReturnsV2Page;
