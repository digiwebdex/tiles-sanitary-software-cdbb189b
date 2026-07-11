/**
 * Purchase Return Detail — V2 Sprint 5E. Doubles as the printable "Return
 * Note" (browser print, matching this codebase's existing PDF/print
 * infrastructure limitation, same as every other document in this app).
 */
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useDealerId } from "@/hooks/useDealerId";
import { purchaseReturnV2Service } from "@/services/purchaseReturnV2Service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ArrowLeft, Check, Ban, Trash2, Printer } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-muted text-muted-foreground" },
  completed: { label: "Completed", className: "bg-green-100 text-green-700" },
  cancelled: { label: "Cancelled", className: "bg-red-100 text-red-700" },
};

const PurchaseReturnV2Detail = () => {
  const { id } = useParams<{ id: string }>();
  const dealerId = useDealerId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: ret, isLoading } = useQuery({
    queryKey: ["purchase-return-v2", id, dealerId],
    queryFn: () => purchaseReturnV2Service.getById(id!, dealerId),
    enabled: !!id && !!dealerId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["purchase-return-v2", id, dealerId] });
    queryClient.invalidateQueries({ queryKey: ["purchase-returns-v2"] });
    queryClient.invalidateQueries({ queryKey: ["supplier-ledger-summary"] });
    queryClient.invalidateQueries({ queryKey: ["supplier-aging"] });
  };

  const completeMutation = useMutation({
    mutationFn: () => purchaseReturnV2Service.complete(id!, dealerId),
    onSuccess: () => { invalidate(); toast.success("Return completed — stock and supplier balance updated."); },
    onError: (e: Error) => toast.error(e.message),
  });
  const cancelMutation = useMutation({
    mutationFn: () => purchaseReturnV2Service.cancel(id!, dealerId),
    onSuccess: () => { invalidate(); toast.success("Draft return cancelled"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteMutation = useMutation({
    mutationFn: () => purchaseReturnV2Service.remove(id!, dealerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-returns-v2"] });
      toast.success("Draft return deleted");
      navigate("/purchase-returns-v2");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (!ret) {
    navigate("/purchase-returns-v2");
    return null;
  }

  const badge = STATUS_BADGE[ret.status] ?? STATUS_BADGE.draft;
  const isDraft = ret.status === "draft";

  return (
    <div className="p-4 lg:p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate("/purchase-returns-v2")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-2xl font-bold text-foreground">{ret.return_no}</h1>
          <Badge variant="secondary" className={badge.className}>{badge.label}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" /> Print Return Note
          </Button>
          {isDraft && (
            <>
              <Button onClick={() => completeMutation.mutate()} disabled={completeMutation.isPending}>
                <Check className="mr-2 h-4 w-4" /> Complete Return
              </Button>
              <Button variant="outline" onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending}>
                <Ban className="mr-2 h-4 w-4" /> Cancel
              </Button>
              <Button
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => { if (confirm("Delete this draft return?")) deleteMutation.mutate(); }}
                disabled={deleteMutation.isPending}
              >
                <Trash2 className="mr-2 h-4 w-4" /> Delete
              </Button>
            </>
          )}
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Return Note — {ret.return_no}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
            <div><span className="text-muted-foreground">Supplier</span><p className="font-medium">{ret.supplier_name ?? "—"}</p></div>
            <div><span className="text-muted-foreground">Return Date</span><p className="font-medium">{ret.return_date}</p></div>
            <div><span className="text-muted-foreground">Source Invoice</span><p className="font-medium">{ret.source_invoice_number ?? "—"}</p></div>
          </div>
          {ret.notes && <p className="text-sm text-muted-foreground">{ret.notes}</p>}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit Price</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(ret.items ?? []).map((it: any) => (
                <TableRow key={it.id}>
                  <TableCell>{it.product_name ?? it.product_sku ?? it.product_id}</TableCell>
                  <TableCell className="text-right">{it.quantity}</TableCell>
                  <TableCell className="text-right">{formatCurrency(it.unit_price)}</TableCell>
                  <TableCell className="text-right font-medium">{formatCurrency(it.total)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{it.reason ?? "—"}</TableCell>
                </TableRow>
              ))}
              <TableRow className="font-bold border-t-2">
                <TableCell colSpan={3}>Total</TableCell>
                <TableCell className="text-right">{formatCurrency(ret.total_amount)}</TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>

          {isDraft && (
            <p className="text-sm text-muted-foreground print:hidden">
              This is a draft — stock has not been deducted and no supplier ledger entry has been posted yet. Complete to apply both.
            </p>
          )}
          {ret.status === "completed" && (
            <p className="text-sm text-muted-foreground print:hidden">
              Completed — stock has been deducted and the supplier's balance owed has been reduced by {formatCurrency(ret.total_amount)}.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default PurchaseReturnV2Detail;
