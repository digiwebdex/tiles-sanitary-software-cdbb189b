import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDealerId } from "@/hooks/useDealerId";
import { productService } from "@/services/productService";
import { batchService } from "@/services/batchService";

const STATUS_VARIANT: Record<string, "default" | "outline" | "secondary" | "destructive"> = {
  active: "default", depleted: "secondary", broken: "destructive",
};

/**
 * V2 Sprint 3B — Batch / Lot Management: Batch Information, Lot Information,
 * Batch History, Batch Availability. 100% reuse of the existing read-only
 * GET /api/batches surface (batchService.getAllBatches) — no backend change.
 */
const BatchesTab = () => {
  const dealerId = useDealerId();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<{ id: string; name: string; sku: string } | null>(null);

  const { data: searchResults } = useQuery({
    queryKey: ["batches-product-search", dealerId, search],
    queryFn: () => productService.list(dealerId, search, 1),
    enabled: !!dealerId && search.trim().length > 1 && !selected,
  });

  const { data: batches = [], isLoading } = useQuery({
    queryKey: ["product-batches", dealerId, selected?.id],
    queryFn: () => batchService.getAllBatches(selected!.id, dealerId),
    enabled: !!dealerId && !!selected,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Batches / Lots</CardTitle>
        <p className="text-sm text-muted-foreground">Search a product to see its Batch History and Batch Availability.</p>
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
              <button
                key={p.id}
                type="button"
                className="w-full text-left px-3 py-2 text-sm hover:bg-muted"
                onClick={() => { setSelected({ id: p.id, name: p.name, sku: p.sku }); setSearch(""); }}
              >
                {p.name} <span className="text-xs text-muted-foreground">{p.sku}</span>
              </button>
            ))}
          </div>
        )}

        {selected && (
          isLoading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Batch No.</TableHead><TableHead>Lot No.</TableHead>
                <TableHead>Shade</TableHead><TableHead>Caliber</TableHead>
                <TableHead className="text-right">Box Qty</TableHead>
                <TableHead className="text-right">Reserved</TableHead>
                <TableHead className="text-right">Available</TableHead>
                <TableHead>Status</TableHead><TableHead>Received</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {batches.map((b: any) => {
                  const total = Number(b.box_qty ?? b.piece_qty ?? 0);
                  const reserved = Number(b.reserved_box_qty ?? b.reserved_piece_qty ?? 0);
                  return (
                    <TableRow key={b.id}>
                      <TableCell className="font-medium">{b.batch_no}</TableCell>
                      <TableCell>{b.lot_no || "—"}</TableCell>
                      <TableCell>{b.shade_code || "—"}</TableCell>
                      <TableCell>{b.caliber || "—"}</TableCell>
                      <TableCell className="text-right">{total}</TableCell>
                      <TableCell className="text-right">{reserved}</TableCell>
                      <TableCell className="text-right">{Math.max(0, total - reserved)}</TableCell>
                      <TableCell><Badge variant={STATUS_VARIANT[b.status] ?? "outline"}>{b.status ?? "active"}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{b.created_at ? new Date(b.created_at).toLocaleDateString() : "—"}</TableCell>
                    </TableRow>
                  );
                })}
                {!batches.length && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">No batches recorded for this product.</TableCell></TableRow>}
              </TableBody>
            </Table>
          )
        )}
      </CardContent>
    </Card>
  );
};

export default BatchesTab;
