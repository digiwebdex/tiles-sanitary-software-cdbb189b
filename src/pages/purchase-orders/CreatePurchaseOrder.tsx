import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useDealerId } from "@/hooks/useDealerId";
import { productService } from "@/services/productService";
import { supplierService } from "@/services/supplierService";
import {
  purchaseOrderService,
  type PurchaseOrderItemInput,
} from "@/services/purchaseOrderService";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Search, Trash2 } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

const CreatePurchaseOrder = () => {
  const dealerId = useDealerId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;

  const [supplierId, setSupplierId] = useState("");
  const [supplierSearch, setSupplierSearch] = useState("");
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState("");
  const [discountType, setDiscountType] = useState<"flat" | "percent">("flat");
  const [discountValue, setDiscountValue] = useState(0);
  const [notes, setNotes] = useState("");
  const [termsText, setTermsText] = useState("");
  const [items, setItems] = useState<PurchaseOrderItemInput[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [lastRateByProduct, setLastRateByProduct] = useState<Record<string, number | null>>({});

  const { data: existing } = useQuery({
    queryKey: ["purchase-order", id, dealerId],
    queryFn: () => purchaseOrderService.getById(id!, dealerId),
    enabled: isEdit && !!id && !!dealerId,
  });

  const hasPrefilled = useRef(false);
  useEffect(() => {
    if (!existing || hasPrefilled.current) return;
    if (existing.status !== "draft") {
      toast.error("Only a draft purchase order can be edited.");
      navigate(`/purchase-orders/${existing.id}`);
      return;
    }
    hasPrefilled.current = true;
    setSupplierId(existing.supplier_id);
    setOrderDate(existing.order_date.slice(0, 10));
    setExpectedDeliveryDate(existing.expected_delivery_date?.slice(0, 10) ?? "");
    setDiscountType(existing.discount_type);
    setDiscountValue(existing.discount_value);
    setNotes(existing.notes ?? "");
    setTermsText(existing.terms_text ?? "");
    setItems(
      existing.items.map((it) => ({
        product_id: it.product_id,
        product_name_snapshot: it.product_name_snapshot,
        product_sku_snapshot: it.product_sku_snapshot,
        unit_type: it.unit_type as "box_sft" | "piece" | null,
        per_box_sft: it.per_box_sft,
        ordered_qty: it.ordered_qty,
        rate: it.rate,
        rate_unit: it.rate_unit as "per_piece" | "per_box" | "per_sqft" | null,
        notes: it.notes,
      })),
    );
  }, [existing, navigate]);

  const { data: supplierResults = [] } = useQuery({
    queryKey: ["po-supplier-search", dealerId, supplierSearch],
    queryFn: async () => {
      const { data } = await supplierService.list(dealerId, supplierSearch, 1);
      return data;
    },
    enabled: !!dealerId && supplierSearch.trim().length > 1,
  });

  const { data: selectedSupplier } = useQuery({
    queryKey: ["po-selected-supplier", supplierId],
    queryFn: () => supplierService.getById(supplierId),
    enabled: !!supplierId,
  });

  const { data: productResults = [] } = useQuery({
    queryKey: ["po-product-search", dealerId, productSearch],
    queryFn: async () => {
      const { data } = await productService.list(dealerId, productSearch, 1, { active: true }, { column: "name", direction: "asc" }, 10);
      return data;
    },
    enabled: !!dealerId && productSearch.trim().length > 1,
  });

  const addProduct = async (p: any) => {
    if (items.some((it) => it.product_id === p.id)) {
      toast.info("Already added.");
      return;
    }
    setItems((prev) => [
      ...prev,
      {
        product_id: p.id,
        product_name_snapshot: p.name,
        product_sku_snapshot: p.sku ?? null,
        unit_type: p.unit_type ?? null,
        per_box_sft: p.per_box_sft ?? null,
        ordered_qty: 1,
        rate: 0,
      },
    ]);
    setProductSearch("");

    if (supplierId) {
      const info = await purchaseOrderService.getLastPurchaseRate(dealerId, supplierId, p.id);
      setLastRateByProduct((prev) => ({ ...prev, [p.id]: info.last_purchase_rate }));
    }
  };

  const updateItem = (idx: number, patch: Partial<PurchaseOrderItemInput>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const removeItem = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx));

  const subtotal = items.reduce((sum, it) => sum + it.ordered_qty * it.rate, 0);
  const discount = discountType === "percent" ? subtotal * (discountValue / 100) : discountValue;
  const total = Math.max(0, subtotal - discount);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!supplierId) throw new Error("Select a supplier.");
      if (items.length === 0) throw new Error("Add at least one item.");
      const form = {
        supplier_id: supplierId,
        order_date: orderDate,
        expected_delivery_date: expectedDeliveryDate || null,
        discount_type: discountType,
        discount_value: discountValue,
        notes,
        terms_text: termsText,
        items,
      };
      if (isEdit) return purchaseOrderService.update(id!, dealerId, form);
      return purchaseOrderService.create(dealerId, form);
    },
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      toast.success(isEdit ? "Purchase order updated" : "Purchase order saved as draft");
      navigate(`/purchase-orders/${row.id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-4 lg:p-6 max-w-4xl mx-auto space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{isEdit ? "Edit Purchase Order" : "New Purchase Order"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="relative">
              <label className="text-sm font-medium mb-1 block">Supplier</label>
              {selectedSupplier ? (
                <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                  <span>{selectedSupplier.name}</span>
                  <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => setSupplierId("")}>
                    Change
                  </button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Search a supplier…"
                      value={supplierSearch}
                      onChange={(e) => setSupplierSearch(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  {supplierSearch.trim().length > 1 && supplierResults.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-md max-h-56 overflow-y-auto">
                      {supplierResults.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          className="block w-full text-left px-3 py-2 text-sm hover:bg-accent"
                          onClick={() => { setSupplierId(s.id); setSupplierSearch(""); }}
                        >
                          {s.name}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Order Date</label>
              <Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium mb-1 block">Expected Delivery Date</label>
              <Input type="date" value={expectedDeliveryDate} onChange={(e) => setExpectedDeliveryDate(e.target.value)} />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium mb-1 block">Notes</label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Terms</label>
            <Textarea rows={2} placeholder="Payment terms, delivery terms…" value={termsText} onChange={(e) => setTermsText(e.target.value)} />
          </div>
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
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              className="pl-9"
            />
            {productSearch.trim().length > 1 && productResults.length > 0 && (
              <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-md max-h-56 overflow-y-auto">
                {productResults.map((p: any) => (
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
                  <TableHead className="w-28">Qty</TableHead>
                  <TableHead className="w-32">Rate</TableHead>
                  <TableHead className="w-28 text-right">Line Total</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((it, idx) => (
                  <TableRow key={idx}>
                    <TableCell>
                      {it.product_name_snapshot}
                      {it.product_id && lastRateByProduct[it.product_id] != null && (
                        <div className="text-xs text-muted-foreground">
                          Last price: {formatCurrency(lastRateByProduct[it.product_id]!)}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Input type="number" min={0.01} step="0.01" value={it.ordered_qty} onChange={(e) => updateItem(idx, { ordered_qty: Number(e.target.value) })} />
                    </TableCell>
                    <TableCell>
                      <Input type="number" min={0} step="0.01" value={it.rate} onChange={(e) => updateItem(idx, { rate: Number(e.target.value) })} />
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">{formatCurrency(it.ordered_qty * it.rate)}</TableCell>
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

          <div className="flex flex-col items-end gap-2 pt-2 border-t">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Subtotal</span>
              <span className="font-mono text-sm w-28 text-right">{formatCurrency(subtotal)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Discount</span>
              <Select value={discountType} onValueChange={(v: "flat" | "percent") => setDiscountType(v)}>
                <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="flat">Flat</SelectItem>
                  <SelectItem value="percent">%</SelectItem>
                </SelectContent>
              </Select>
              <Input type="number" min={0} step="0.01" className="w-28" value={discountValue} onChange={(e) => setDiscountValue(Number(e.target.value))} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Total</span>
              <span className="font-mono text-sm w-28 text-right font-semibold">{formatCurrency(total)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? "Saving…" : isEdit ? "Save Changes" : "Save as Draft"}
        </Button>
        <Button type="button" variant="outline" onClick={() => navigate("/purchase-orders")}>
          Cancel
        </Button>
      </div>
    </div>
  );
};

export default CreatePurchaseOrder;
