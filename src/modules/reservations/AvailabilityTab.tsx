import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDealerId } from "@/hooks/useDealerId";
import { productService } from "@/services/productService";
import { availabilityService } from "@/services/availabilityService";
import { formatBoxPiece } from "@/lib/units";

/**
 * V2 Sprint 3C — Availability Engine viewer. Shows the single-source-of-truth
 * breakdown (Current Stock − Reserved − Allocated − Display − Pending
 * Delivery + Incoming Purchase) for a searched product, plus its per-batch
 * (shade/lot/caliber) availability.
 */
const AvailabilityTab = () => {
  const dealerId = useDealerId();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<{ id: string; name: string; sku: string } | null>(null);

  const { data: searchResults } = useQuery({
    queryKey: ["availability-product-search", dealerId, search],
    queryFn: () => productService.list(dealerId, search, 1),
    enabled: !!dealerId && search.trim().length > 1 && !selected,
  });
  const { data: breakdown, isLoading } = useQuery({
    queryKey: ["availability", dealerId, selected?.id],
    queryFn: () => availabilityService.getAvailability(selected!.id, dealerId),
    enabled: !!dealerId && !!selected,
  });
  const { data: batchRows = [] } = useQuery({
    queryKey: ["availability-batches", dealerId, selected?.id],
    queryFn: () => availabilityService.getBatchAvailability(selected!.id, dealerId),
    enabled: !!dealerId && !!selected,
  });

  const fmt = (pieces: number) => breakdown
    ? (breakdown.unit_type === "box_sft" ? formatBoxPiece(pieces, breakdown.pieces_per_box) : `${Math.round(pieces)} pcs`)
    : pieces;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Availability</CardTitle>
        <p className="text-sm text-muted-foreground">Available = Current Stock − Reserved − Allocated − Display − Pending Delivery + Incoming Purchase.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <Input
          placeholder="Search product by name or SKU…"
          value={selected ? `${selected.name} (${selected.sku})` : search}
          onChange={e => { setSelected(null); setSearch(e.target.value); }}
        />
        {!selected && !!searchResults?.data?.length && (
          <div className="border rounded-md divide-y">
            {searchResults.data.slice(0, 8).map((p: any) => (
              <button key={p.id} type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-muted"
                onClick={() => { setSelected({ id: p.id, name: p.name, sku: p.sku }); setSearch(""); }}>
                {p.name} <span className="text-xs text-muted-foreground">{p.sku}</span>
              </button>
            ))}
          </div>
        )}

        {selected && isLoading && <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>}

        {selected && breakdown && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Current Stock</p><p className="font-semibold">{fmt(breakdown.current_stock_pieces)}</p></div>
              <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Reserved</p><p className="font-semibold">{fmt(breakdown.reserved_pieces)}</p></div>
              <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Allocated</p><p className="font-semibold">{fmt(breakdown.allocated_pieces)}</p></div>
              <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Display Stock</p><p className="font-semibold">{fmt(breakdown.display_stock_pieces)}</p></div>
              <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Pending Delivery</p><p className="font-semibold">{fmt(breakdown.pending_delivery_pieces)}</p></div>
              <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Incoming Purchase</p><p className="font-semibold">{fmt(breakdown.incoming_purchase_pieces)}</p></div>
              <div className="rounded-md border-2 border-primary p-3 col-span-2"><p className="text-xs text-muted-foreground">Available Now</p><p className="font-bold text-lg text-primary">{breakdown.available_display}</p></div>
            </div>

            <Table>
              <TableHeader><TableRow>
                <TableHead>Batch</TableHead><TableHead>Shade</TableHead><TableHead>Caliber</TableHead><TableHead>Lot</TableHead>
                <TableHead className="text-right">Total</TableHead><TableHead className="text-right">Reserved</TableHead>
                <TableHead className="text-right">Allocated</TableHead><TableHead className="text-right">Available</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {batchRows.map(b => (
                  <TableRow key={b.batch_id}>
                    <TableCell className="font-medium">{b.batch_no}</TableCell>
                    <TableCell>{b.shade_code ?? "—"}</TableCell>
                    <TableCell>{b.caliber ?? "—"}</TableCell>
                    <TableCell>{b.lot_no ?? "—"}</TableCell>
                    <TableCell className="text-right">{fmt(b.total_pieces)}</TableCell>
                    <TableCell className="text-right">{fmt(b.reserved_pieces)}</TableCell>
                    <TableCell className="text-right">{fmt(b.allocated_pieces)}</TableCell>
                    <TableCell className="text-right font-semibold">{fmt(b.available_pieces)}</TableCell>
                  </TableRow>
                ))}
                {!batchRows.length && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">No batches recorded for this product.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default AvailabilityTab;
