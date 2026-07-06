import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useDealerId } from "@/hooks/useDealerId";
import { productService } from "@/services/productService";
import { purchaseRequestService } from "@/services/purchaseRequestService";
import { rfqService, type RfqItemInput } from "@/services/rfqService";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Search, Trash2 } from "lucide-react";

/**
 * Optionally seeded from an approved Purchase Request via
 * /rfqs/new?fromPurchaseRequest=<id> (CreatePurchaseRequest doesn't link
 * here directly yet — this just means an RFQ can trace back to a PR when
 * one exists, per the sprint's "RFQ may originate from a PR" design).
 */
const CreateRfq = () => {
  const dealerId = useDealerId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const fromPrId = searchParams.get("fromPurchaseRequest");

  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<RfqItemInput[]>([]);
  const [search, setSearch] = useState("");

  useQuery({
    queryKey: ["rfq-from-pr", fromPrId, dealerId],
    queryFn: async () => {
      const pr = await purchaseRequestService.getById(fromPrId!, dealerId);
      setItems(
        pr.items.map((it) => ({
          product_id: it.product_id,
          product_name_snapshot: it.product_name_snapshot,
          qty: it.requested_qty,
        })),
      );
      return pr;
    },
    enabled: !!fromPrId && !!dealerId,
  });

  const { data: searchResults = [] } = useQuery({
    queryKey: ["rfq-product-search", dealerId, search],
    queryFn: async () => {
      const { data } = await productService.list(dealerId, search, 1, { active: true }, { column: "name", direction: "asc" }, 10);
      return data;
    },
    enabled: !!dealerId && search.trim().length > 1,
  });

  const addProduct = (p: { id: string; name: string }) => {
    if (items.some((it) => it.product_id === p.id)) {
      toast.info("Already added.");
      return;
    }
    setItems((prev) => [...prev, { product_id: p.id, product_name_snapshot: p.name, qty: 1 }]);
    setSearch("");
  };

  const updateQty = (idx: number, qty: number) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, qty } : it)));
  };

  const removeItem = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx));

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (items.length === 0) throw new Error("Add at least one item.");
      return rfqService.create(dealerId, { purchase_request_id: fromPrId, notes, items });
    },
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: ["rfqs"] });
      toast.success("RFQ saved as draft");
      navigate(`/rfqs/${row.id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-4 lg:p-6 max-w-4xl mx-auto space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>New Request for Quotation</CardTitle>
        </CardHeader>
        <CardContent>
          <label className="text-sm font-medium mb-1 block">Notes</label>
          <Textarea rows={2} placeholder="Purpose of this RFQ…" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Items</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search a product to add…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
            {search.trim().length > 1 && searchResults.length > 0 && (
              <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-md max-h-56 overflow-y-auto">
                {searchResults.map((p: any) => (
                  <button
                    key={p.id}
                    type="button"
                    className="block w-full text-left px-3 py-2 text-sm hover:bg-accent"
                    onClick={() => addProduct(p)}
                  >
                    {p.name} <span className="text-muted-foreground">({p.sku})</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No items added yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="w-32">Qty</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((it, idx) => (
                  <TableRow key={idx}>
                    <TableCell>{it.product_name_snapshot}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={0.01}
                        step="0.01"
                        value={it.qty}
                        onChange={(e) => updateQty(idx, Number(e.target.value))}
                      />
                    </TableCell>
                    <TableCell>
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeItem(idx)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? "Saving…" : "Save as Draft"}
        </Button>
        <Button type="button" variant="outline" onClick={() => navigate("/rfqs")}>
          Cancel
        </Button>
      </div>
    </div>
  );
};

export default CreateRfq;
