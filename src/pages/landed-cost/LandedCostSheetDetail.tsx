import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useDealerId } from "@/hooks/useDealerId";
import { landedCostSheetService, CHARGE_FIELDS } from "@/services/landedCostSheetService";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ArrowLeft, Check, Ban } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-muted text-muted-foreground" },
  applied: { label: "Applied", className: "bg-green-100 text-green-700" },
  cancelled: { label: "Cancelled", className: "bg-red-100 text-red-700" },
};

const LandedCostSheetDetail = () => {
  const { id } = useParams<{ id: string }>();
  const dealerId = useDealerId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: sheet, isLoading } = useQuery({
    queryKey: ["landed-cost-sheet", id, dealerId],
    queryFn: () => landedCostSheetService.getById(id!, dealerId),
    enabled: !!id && !!dealerId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["landed-cost-sheet", id, dealerId] });
    queryClient.invalidateQueries({ queryKey: ["landed-cost-sheets"] });
    queryClient.invalidateQueries({ queryKey: ["stock-cost-adjustments"] });
  };

  const applyMutation = useMutation({
    mutationFn: () => landedCostSheetService.apply(id!, dealerId),
    onSuccess: () => { invalidate(); toast.success("Landed cost applied — product average costs updated."); },
    onError: (e: Error) => toast.error(e.message),
  });
  const cancelMutation = useMutation({
    mutationFn: () => landedCostSheetService.cancel(id!, dealerId),
    onSuccess: () => { invalidate(); toast.success("Draft sheet cancelled"); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (!sheet) {
    navigate("/landed-cost");
    return null;
  }

  const badge = STATUS_BADGE[sheet.status] ?? STATUS_BADGE.draft;
  const isDraft = sheet.status === "draft";

  return (
    <div className="p-4 lg:p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate("/landed-cost")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-2xl font-bold text-foreground">{sheet.sheet_no}</h1>
          <Badge variant="secondary" className={badge.className}>{badge.label}</Badge>
        </div>
        {isDraft && (
          <div className="flex gap-2">
            <Button onClick={() => applyMutation.mutate()} disabled={applyMutation.isPending}>
              <Check className="mr-2 h-4 w-4" /> Apply
            </Button>
            <Button variant="outline" onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending}>
              <Ban className="mr-2 h-4 w-4" /> Cancel
            </Button>
          </div>
        )}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Charges</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
          <div><span className="text-muted-foreground">Purchase Invoice</span><p className="font-medium">{sheet.purchase_invoice_number ?? "—"}</p></div>
          <div><span className="text-muted-foreground">Sheet Date</span><p className="font-medium">{sheet.sheet_date}</p></div>
          {CHARGE_FIELDS.map((f) => (
            <div key={f.key}><span className="text-muted-foreground">{f.label}</span><p className="font-medium">{formatCurrency(Number((sheet as any)[f.key]) || 0)}</p></div>
          ))}
          <div><span className="text-muted-foreground">Total</span><p className="font-semibold">{formatCurrency(Number(sheet.total_amount) || 0)}</p></div>
        </CardContent>
      </Card>

      {sheet.status === "applied" && (
        <Card>
          <CardHeader><CardTitle className="text-base">Allocation</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Line Value</TableHead>
                  <TableHead className="text-right">Allocated</TableHead>
                  <TableHead className="text-right">Avg Cost Before</TableHead>
                  <TableHead className="text-right">Avg Cost After</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(sheet.items ?? []).map((it: any) => (
                  <TableRow key={it.id}>
                    <TableCell>{it.product_name ?? it.product_sku ?? it.product_id}</TableCell>
                    <TableCell className="text-right">{formatCurrency(it.line_value)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(it.allocated_amount)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(it.avg_cost_before)}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(it.avg_cost_after)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {isDraft && (
        <p className="text-sm text-muted-foreground">
          Applying this sheet will spread the total charges proportionally across the invoice's lines (by line value) and add the per-unit cost onto each product's average cost. This cannot be undone.
        </p>
      )}
    </div>
  );
};

export default LandedCostSheetDetail;
