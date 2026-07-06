/**
 * StockLedgerDialog — V2 Sprint 3A (Inventory Core).
 *
 * Reads GET /api/stock/ledger (stockService.getLedger — new in this sprint,
 * reuses the existing `stock_ledger` table that every write path already
 * populates). Two modes, same dialog:
 *   - productId set   → "Stock History" for one product
 *   - productId unset → dealer-wide "Stock Ledger"
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import Pagination from "@/components/Pagination";
import { stockService } from "@/services/stockService";
import { formatBoxPiece } from "@/lib/units";

interface StockLedgerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dealerId: string;
  /** Omit for the dealer-wide ledger; pass a product to scope to its history. */
  productId?: string | null;
  productName?: string;
}

const PAGE_SIZE = 25;

const TXN_LABELS: Record<string, string> = {
  adj_add: "Manual Add",
  adj_deduct: "Manual Deduct",
  adj_restore: "Manual Restore",
  adj_broken: "Damage / Broken",
  purchase_in: "Purchase",
  sale_out: "Sale",
  sale_update_in: "Sale Edit (+)",
  sale_update_out: "Sale Edit (-)",
  sale_cancel_in: "Sale Cancelled",
};

const TXN_BADGE_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  adj_add: "default",
  adj_deduct: "destructive",
  adj_restore: "secondary",
  adj_broken: "destructive",
  purchase_in: "default",
  sale_out: "secondary",
  sale_update_in: "secondary",
  sale_update_out: "secondary",
  sale_cancel_in: "outline",
};

const StockLedgerDialog = ({ open, onOpenChange, dealerId, productId, productName }: StockLedgerDialogProps) => {
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ["stock-ledger", dealerId, productId ?? null, page],
    queryFn: () =>
      stockService.getLedger(dealerId, {
        productId: productId ?? undefined,
        page: page - 1,
        pageSize: PAGE_SIZE,
      }),
    enabled: open && !!dealerId,
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setPage(1); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {productId ? `Stock History — ${productName ?? ""}` : "Stock Ledger"}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No stock movements recorded yet.</p>
        ) : (
          <>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    {!productId && <TableHead>Product</TableHead>}
                    <TableHead>Type</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead className="text-right">Qty Change</TableHead>
                    <TableHead className="text-right">Before</TableHead>
                    <TableHead className="text-right">After</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const isTile = r.product_unit_type === "box_sft";
                    const ppb = r.product_pieces_per_box || 1;
                    const delta = Number(r.total_pieces) || 0;
                    // stock_ledger.total_pieces is already a raw piece count
                    // (see adjustments.ts), NOT a box-equivalent quantity —
                    // formatBoxPiece is the correct helper for that unit,
                    // not formatStockUnit (which expects box-equivalent input).
                    const deltaDisplay = isTile
                      ? formatBoxPiece(Math.abs(delta), ppb)
                      : `${Math.abs(Math.round(delta))} pcs`;
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="whitespace-nowrap text-xs">
                          {format(new Date(r.created_at), "dd MMM yyyy, HH:mm")}
                        </TableCell>
                        {!productId && (
                          <TableCell className="text-xs">
                            <div className="font-medium">{r.product_name}</div>
                            <div className="text-muted-foreground">{r.product_sku}</div>
                          </TableCell>
                        )}
                        <TableCell>
                          <Badge variant={TXN_BADGE_VARIANT[r.txn_type] ?? "outline"} className="text-xs">
                            {TXN_LABELS[r.txn_type] ?? r.txn_type}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {r.reference_no || "—"}
                        </TableCell>
                        <TableCell className={`text-right font-medium ${delta < 0 ? "text-destructive" : "text-emerald-600"}`}>
                          {delta < 0 ? "-" : "+"}{deltaDisplay}
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">{r.stock_before_display}</TableCell>
                        <TableCell className="text-right text-xs">{r.stock_after_display}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            {total > PAGE_SIZE && (
              <Pagination page={page} totalItems={total} pageSize={PAGE_SIZE} onPageChange={setPage} />
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default StockLedgerDialog;
