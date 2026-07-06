import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatBoxPiece } from "@/lib/units";
import type { LocationStockRow } from "@/services/godownService";

/**
 * V2 Sprint 3B — Multi-location Stock viewer.
 * Generic over warehouse/godown/rack: all three `<level>_stock` tables share
 * the same row shape, so one dialog serves all three "View Stock" actions.
 */
const LocationStockDialog = ({
  open,
  onOpenChange,
  title,
  queryKey,
  fetchStock,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  queryKey: unknown[];
  fetchStock: () => Promise<{ rows: LocationStockRow[] }>;
}) => {
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: fetchStock,
    enabled: open,
  });
  const rows = data?.rows ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
        ) : (
          <Table>
            <TableHeader><TableRow>
              <TableHead>Product</TableHead><TableHead>SKU</TableHead>
              <TableHead className="text-right">Quantity</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.product_id}>
                  <TableCell className="font-medium">{r.product_name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.product_sku}</TableCell>
                  <TableCell className="text-right">
                    {r.product_unit_type === "box_sft"
                      ? formatBoxPiece(Number(r.total_pieces), Number(r.product_pieces_per_box ?? 1))
                      : `${Math.round(Number(r.total_pieces))} pcs`}
                  </TableCell>
                </TableRow>
              ))}
              {!rows.length && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-6">No stock recorded here yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default LocationStockDialog;
