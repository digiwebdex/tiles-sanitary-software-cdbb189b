/**
 * Create Purchase Invoice from Goods Receipt — V2 Sprint 5D.
 * Own self-sufficient GRN picker (mirrors CreateGoodsReceipt.tsx's own PO
 * picker pattern from Sprint 5C) rather than a button on the frozen
 * GoodsReceiptDetail.tsx page. Supports Full Invoice (default full
 * invoiceable_qty per line), Partial Invoice (editable qty per line), and
 * Multiple GRNs to one Invoice (add more than one GRN, as long as they
 * share the same supplier — a purchase invoice has exactly one supplier_id).
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useDealerId } from "@/hooks/useDealerId";
import {
  purchaseInvoiceService,
  type InvoiceableLine,
  type PurchaseInvoiceItemInput,
} from "@/services/purchaseInvoiceService";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Search, X } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

interface LineDraft extends PurchaseInvoiceItemInput {
  grn_id: string;
  grn_number: string | null;
  product_name_snapshot: string;
  invoiceable_qty: number;
}

const CreatePurchaseInvoice = () => {
  const dealerId = useDealerId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [supplierId, setSupplierId] = useState("");
  const [addedGrnIds, setAddedGrnIds] = useState<string[]>([]);
  const [grnSearch, setGrnSearch] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [purchaseDate, setPurchaseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [voucherDiscount, setVoucherDiscount] = useState("0");

  const { data: uninvoicedGrns = [] } = useQuery({
    queryKey: ["uninvoiced-grns", dealerId, supplierId],
    queryFn: () => purchaseInvoiceService.listUninvoicedGoodsReceipts(dealerId, supplierId),
    enabled: !!dealerId,
  });

  const searchResults = uninvoicedGrns.filter(
    (g) => !addedGrnIds.includes(g.id) &&
      (grnSearch.trim() === "" ||
        (g.grn_number ?? "").toLowerCase().includes(grnSearch.toLowerCase()) ||
        (g.supplier_name ?? "").toLowerCase().includes(grnSearch.toLowerCase())),
  );

  const addGrn = async (grnId: string, grnNumber: string | null, grnSupplierId: string) => {
    if (!supplierId) setSupplierId(grnSupplierId);
    try {
      const resp = await purchaseInvoiceService.getGoodsReceiptLines(grnId, dealerId);
      const invoiceable = resp.lines.filter((l: InvoiceableLine) => l.invoiceable_qty > 0.001);
      if (invoiceable.length === 0) {
        toast.error("This GRN has no remaining invoiceable quantity.");
        return;
      }
      setAddedGrnIds((prev) => [...prev, grnId]);
      setLines((prev) => [
        ...prev,
        ...invoiceable.map((l) => ({
          grn_id: grnId,
          grn_number: grnNumber,
          goods_receipt_item_id: l.goods_receipt_item_id,
          product_id: l.product_id,
          product_name_snapshot: l.product_name_snapshot,
          invoice_qty: l.invoiceable_qty,
          rate: l.rate,
          invoiceable_qty: l.invoiceable_qty,
        })),
      ]);
      setGrnSearch("");
    } catch (e: any) {
      toast.error(e.message || "Failed to load goods receipt lines");
    }
  };

  const removeGrn = (grnId: string) => {
    setAddedGrnIds((prev) => prev.filter((id) => id !== grnId));
    setLines((prev) => prev.filter((l) => l.grn_id !== grnId));
    if (addedGrnIds.length <= 1) setSupplierId("");
  };

  const updateLine = (goodsReceiptItemId: string, patch: Partial<LineDraft>) => {
    setLines((prev) => prev.map((l) => (l.goods_receipt_item_id === goodsReceiptItemId ? { ...l, ...patch } : l)));
  };

  const subtotal = lines.reduce((sum, l) => sum + l.invoice_qty * l.rate, 0);
  const discount = Math.max(0, Math.min(Number(voucherDiscount) || 0, subtotal));

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!supplierId) throw new Error("Add at least one goods receipt.");
      if (lines.length === 0) throw new Error("No lines to invoice.");
      for (const l of lines) {
        if (l.invoice_qty <= 0) throw new Error(`${l.product_name_snapshot}: quantity must be greater than 0.`);
        if (l.invoice_qty > l.invoiceable_qty + 0.001) throw new Error(`${l.product_name_snapshot}: cannot invoice more than ${l.invoiceable_qty} remaining.`);
      }
      return purchaseInvoiceService.create(dealerId, {
        supplier_id: supplierId,
        purchase_date: purchaseDate,
        notes,
        voucher_discount: discount,
        items: lines.map((l) => ({
          goods_receipt_item_id: l.goods_receipt_item_id,
          product_id: l.product_id,
          invoice_qty: l.invoice_qty,
          rate: l.rate,
        })),
      });
    },
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: ["purchase-invoices"] });
      toast.success("Purchase invoice saved as draft");
      navigate(`/purchase-invoices/${row.id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const groupedByGrn = addedGrnIds.map((grnId) => ({
    grnId,
    grnNumber: lines.find((l) => l.grn_id === grnId)?.grn_number ?? grnId,
    lines: lines.filter((l) => l.grn_id === grnId),
  }));

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Create Purchase Invoice from Goods Receipt</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1 block">Add Goods Receipt(s)</label>
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search completed, uninvoiced GRNs…"
                value={grnSearch}
                onChange={(e) => setGrnSearch(e.target.value)}
                className="pl-9"
              />
              {grnSearch.trim().length > 0 && searchResults.length > 0 && (
                <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-md max-h-56 overflow-y-auto">
                  {searchResults.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      className="block w-full text-left px-3 py-2 text-sm hover:bg-accent"
                      onClick={() => addGrn(g.id, g.grn_number, g.supplier_id)}
                    >
                      {g.grn_number ?? "Draft"} — {g.supplier_name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {supplierId && (
              <p className="text-xs text-muted-foreground mt-2">
                Locked to supplier: <span className="font-medium">{uninvoicedGrns.find((g) => g.supplier_id === supplierId)?.supplier_name ?? supplierId}</span>. Remove all GRNs to change supplier.
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium mb-1 block">Invoice/Purchase Date</label>
              <Input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Voucher Discount</label>
              <Input type="number" min={0} step="0.01" value={voucherDiscount} onChange={(e) => setVoucherDiscount(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Notes</label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {groupedByGrn.map((group) => (
        <Card key={group.grnId}>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">GRN {group.grnNumber}</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => removeGrn(group.grnId)}>
              <X className="h-4 w-4 mr-1" /> Remove
            </Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                  <TableHead className="text-right">Invoiceable</TableHead>
                  <TableHead className="text-right w-32">Invoice Qty</TableHead>
                  <TableHead className="text-right w-32">Rate</TableHead>
                  <TableHead className="text-right">Line Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.lines.map((l) => (
                  <TableRow key={l.goods_receipt_item_id}>
                    <TableCell>{l.product_name_snapshot}</TableCell>
                    <TableCell className="text-right text-muted-foreground">—</TableCell>
                    <TableCell className="text-right">{l.invoiceable_qty}</TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        min={0.001}
                        max={l.invoiceable_qty}
                        step="0.001"
                        className="text-right"
                        value={l.invoice_qty}
                        onChange={(e) => updateLine(l.goods_receipt_item_id, { invoice_qty: Number(e.target.value) })}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        className="text-right"
                        value={l.rate}
                        onChange={(e) => updateLine(l.goods_receipt_item_id, { rate: Number(e.target.value) })}
                      />
                    </TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(l.invoice_qty * l.rate)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}

      {lines.length > 0 && (
        <Card>
          <CardContent className="pt-6 space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{formatCurrency(subtotal)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span>-{formatCurrency(discount)}</span></div>
            <div className="flex justify-between font-semibold text-base pt-1 border-t"><span>Net Payable (before VAT)</span><span>{formatCurrency(Math.max(0, subtotal - discount))}</span></div>
            <p className="text-xs text-muted-foreground pt-1">VAT/SD will be calculated automatically when this invoice is finalized, using the dealer's VAT settings.</p>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-3">
        <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || lines.length === 0}>
          {createMutation.isPending ? "Saving…" : "Save as Draft"}
        </Button>
        <Button type="button" variant="outline" onClick={() => navigate("/purchase-invoices")}>
          Cancel
        </Button>
      </div>
    </div>
  );
};

export default CreatePurchaseInvoice;
