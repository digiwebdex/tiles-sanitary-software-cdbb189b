import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDealerId } from "@/hooks/useDealerId";
import { inventoryIntelligenceService, type AgingBucket } from "@/services/inventoryIntelligenceService";

const BUCKET_VARIANT: Record<AgingBucket, "outline" | "secondary" | "default" | "destructive"> = {
  "0-30": "outline", "31-60": "secondary", "61-90": "default", "90+": "destructive",
};

/** V2 Sprint 3D — Stock Aging: batch/lot age buckets from product_batches.created_at. */
const StockAgingTab = () => {
  const dealerId = useDealerId();
  const { data, isLoading } = useQuery({
    queryKey: ["stock-aging", dealerId],
    queryFn: () => inventoryIntelligenceService.getStockAging(dealerId),
    enabled: !!dealerId,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stock Aging</CardTitle>
        <p className="text-sm text-muted-foreground">Age of each active batch/lot since receipt.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p> : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {data?.bucketSummary.map(b => (
                <div key={b.bucket} className="rounded-md border p-3">
                  <Badge variant={BUCKET_VARIANT[b.bucket]} className="mb-1">{b.bucket} days</Badge>
                  <p className="text-xl font-bold">{b.batchCount} <span className="text-sm font-normal text-muted-foreground">batches</span></p>
                  <p className="text-xs text-muted-foreground">{Math.round(b.totalPieces)} pcs</p>
                </div>
              ))}
            </div>

            <Table>
              <TableHeader><TableRow>
                <TableHead>Product</TableHead><TableHead>Batch</TableHead><TableHead>Lot</TableHead>
                <TableHead>Shade</TableHead><TableHead>Caliber</TableHead>
                <TableHead className="text-right">Qty (pcs)</TableHead>
                <TableHead className="text-right">Age (days)</TableHead><TableHead>Bucket</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {data?.rows.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.product_name}</TableCell>
                    <TableCell>{r.batch_no}</TableCell>
                    <TableCell>{r.lot_no ?? "—"}</TableCell>
                    <TableCell>{r.shade_code ?? "—"}</TableCell>
                    <TableCell>{r.caliber ?? "—"}</TableCell>
                    <TableCell className="text-right">{Math.round(r.total_pieces)}</TableCell>
                    <TableCell className="text-right">{r.age_days}</TableCell>
                    <TableCell><Badge variant={BUCKET_VARIANT[r.bucket]}>{r.bucket}</Badge></TableCell>
                  </TableRow>
                ))}
                {!data?.rows.length && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">No active batches recorded.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default StockAgingTab;
