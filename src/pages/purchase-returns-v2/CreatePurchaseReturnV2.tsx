/**
 * Create Purchase Return — V2 Sprint 5E.
 * Own self-sufficient picker (mirrors CreatePurchaseInvoice.tsx's own GRN
 * picker pattern from Sprint 5D) — pick a posted Purchase Invoice, then
 * choose per-line return quantity (full or partial, up to the remaining
 * returnable quantity).
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useDealerId } from "@/hooks/useDealerId";
import {
  purchaseReturnV2Service,
  type ReturnableLine,
  type PurchaseReturnItemInput,
} from "@/services/purchaseReturnV2Service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Search } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

interface LineDraft extends PurchaseReturnItemInput {
  product_name: string;
  returnable_qty: number;
}

const CreatePurchaseReturnV2 = () => {
  const dealerId = useDealerId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [purchaseId, setPurchaseId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [returnDate, setReturnDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");

  const { data: returnablePurchases = [] } = useQuery({
    queryKey: ["returnable-purchases", dealerId, search],
    queryFn: () => purchaseReturnV2Service.listReturnablePurchases(dealerId),
    enabled: !!dealerId && !purchaseId,
  });

  const searchResults = returnablePurchases.filter(
    (p) => search.trim() === "" ||
      (p.invoice_number ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (p.supplier_name ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  const selectPurchase = async (id: string, supId: string) => {
    try {
      const resp = await purchaseReturnV2Service.getPurchaseLines(id, dealerId);
      const returnable = resp.lines.filter((l: ReturnableLine) => l.returnable_qty > 0.001);
      if (returnable.length === 0) {
        toast.error("This purchase has no remaining returnable quantity.");
        return;
      }
      setPurchaseId(id);
      setSupplierId(supId);
      setLines(
        returnable.map((l) => ({
          purchase_item_id: l.purchase_item_id,
          product_id: l.product_id,
          product_name: l.product_name,
          return_qty: l.returnable_qty,
          unit_price: l.purchase_rate,
          returnable_qty: l.returnable_qty,
          warehouse_id: l.warehouse_id,
          godown_id: l.godown_id,
          rack_id: l.rack_id,
        })),
      );
    } catch (e: any) {
      toast.error(e.message || "Failed to load purchase lines");
    }
  };

  const updateLine = (purchaseItemId: string, patch: Partial<LineDraft>) => {
    setLines((prev) => prev.map((l) => (l.purchase_item_id === purchaseItemId ? { ...l, ...patch } : l)));
  };

  const totalAmount = lines.reduce((sum, l) => sum + l.return_qty * l.unit_price, 0);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!purchaseId) throw new Error("Select a purchase invoice to return against.");
      if (lines.length === 0) throw new Error("No lines to return.");
      for (const l of lines) {
        if (l.return_qty <= 0) throw new Error(`${l.product_name}: quantity must be greater than 0.`);
        if (l.return_qty > l.returnable_qty + 0.001) throw new Error(`${l.product_name}: cannot return more than ${l.returnable_qty} remaining.`);
      }
      return purchaseReturnV2Service.create(dealerId, {
        supplier_id: supplierId,
        purchase_id: purchaseId,
        return_date: returnDate,
        notes,
        items: lines.map((l) => ({
          purchase_item_id: l.purchase_item_id,
          product_id: l.product_id,
          return_qty: l.return_qty,
          unit_price: l.unit_price,
          warehouse_id: l.warehouse_id,
          godown_id: l.godown_id,
          rack_id: l.rack_id,
        })),
      });
    },
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: ["purchase-returns-v2"] });
      toast.success("Purchase return saved as draft");
      navigate(`/purchase-returns-v2/${row.id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Create Purchase Return</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1 block">Purchase Invoice</label>
            {purchaseId ? (
              <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                <span>{returnablePurchases.find((p) => p.id === purchaseId)?.invoice_number ?? purchaseId} — {returnablePurchases.find((p) => p.id === purchaseId)?.supplier_name}</span>
                <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => { setPurchaseId(""); setSupplierId(""); setLines([]); }}>
                  Change
                </button>
              </div>
            ) : (
              <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Search a posted purchase invoice…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
                {search.trim().length > 0 && searchResults.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-md max-h-56 overflow-y-auto">
                    {searchResults.map((p) => (
                      <button key={p.id} type="button" className="block w-full text-left px-3 py-2 text-sm hover:bg-accent" onClick={() => selectPurchase(p.id, p.supplier_id)}>
                        {p.invoice_number ?? "Draft"} — {p.supplier_name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium mb-1 block">Return Date</label>
              <Input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Notes</label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {purchaseId && lines.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Lines to Return</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Purchased</TableHead>
                  <TableHead className="text-right">Returnable</TableHead>
                  <TableHead className="text-right w-32">Return Qty</TableHead>
                  <TableHead className="text-right w-32">Unit Price</TableHead>
                  <TableHead className="text-right">Line Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l) => (
                  <TableRow key={l.purchase_item_id}>
                    <TableCell>{l.product_name}</TableCell>
                    <TableCell className="text-right text-muted-foreground">—</TableCell>
                    <TableCell className="text-right">{l.returnable_qty}</TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number" min={0.001} max={l.returnable_qty} step="0.001" className="text-right"
                        value={l.return_qty}
                        onChange={(e) => updateLine(l.purchase_item_id, { return_qty: Number(e.target.value) })}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number" min={0} step="0.01" className="text-right"
                        value={l.unit_price}
                        onChange={(e) => updateLine(l.purchase_item_id, { unit_price: Number(e.target.value) })}
                      />
                    </TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(l.return_qty * l.unit_price)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex justify-end pt-3 text-sm font-semibold">
              Total: {formatCurrency(totalAmount)}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-3">
        <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || lines.length === 0}>
          {createMutation.isPending ? "Saving…" : "Save as Draft"}
        </Button>
        <Button type="button" variant="outline" onClick={() => navigate("/purchase-returns-v2")}>
          Cancel
        </Button>
      </div>
    </div>
  );
};

export default CreatePurchaseReturnV2;
