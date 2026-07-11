import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, ClipboardList, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";
import { useDealerId } from "@/hooks/useDealerId";
import { supplierService } from "@/services/supplierService";
import { productService } from "@/services/productService";
import {
  computePoTotals, purchaseOrderService, type PurchaseOrderItemInput,
} from "@/services/purchaseOrderService";

type Row = PurchaseOrderItemInput & { product_name: string };

export default function CreatePurchaseOrderPage() {
  const navigate = useNavigate();
  const dealerId = useDealerId();

  const [supplierId, setSupplierId] = useState("");
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [expectedDate, setExpectedDate] = useState("");
  const [advance, setAdvance] = useState("0");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [productSearch, setProductSearch] = useState("");

  const { data: suppliers } = useQuery({
    queryKey: ["po-suppliers", dealerId],
    queryFn: () => supplierService.list(dealerId!, "", 1),
    enabled: !!dealerId,
  });

  const { data: products } = useQuery({
    queryKey: ["po-products", dealerId, productSearch],
    queryFn: () => productService.list(dealerId!, productSearch, 1),
    enabled: !!dealerId,
  });

  const { total } = useMemo(() => computePoTotals(rows), [rows]);

  const addProduct = (productId: string) => {
    const p = (products?.data ?? []).find((x) => x.id === productId);
    if (!p) return;
    if (rows.some((r) => r.product_id === productId)) {
      toast.info("পণ্যটি ইতিমধ্যে তালিকায় আছে");
      return;
    }
    setRows((rs) => [
      ...rs,
      {
        product_id: p.id,
        product_name: p.name,
        quantity: 1,
        unit_price: Number(p.cost_price ?? 0),
      },
    ]);
  };

  const updateRow = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const removeRow = (i: number) => setRows((rs) => rs.filter((_, idx) => idx !== i));

  const createMut = useMutation({
    mutationFn: () =>
      purchaseOrderService.create({
        supplier_id: supplierId,
        order_date: orderDate,
        expected_delivery_date: expectedDate || null,
        advance_paid: Number(advance) || 0,
        notes: notes.trim() || null,
        items: rows.map(({ product_id, quantity, unit_price }) => ({
          product_id,
          quantity: Number(quantity),
          unit_price: Number(unit_price),
        })),
      }),
    onSuccess: (po) => {
      toast.success(`${po.po_number} তৈরি হয়েছে`);
      navigate("/purchases/orders");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canSubmit =
    !!supplierId && !!orderDate && rows.length > 0 &&
    rows.every((r) => Number(r.quantity) > 0 && Number(r.unit_price) >= 0);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate("/purchases/orders")} aria-label="Back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <ClipboardList className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Create Purchase Order <span className="text-muted-foreground font-normal">(ক্রয় আদেশ তৈরী)</span></h1>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3"><CardTitle className="text-base">Order Details (অর্ডারের তথ্য)</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Supplier* (সরবরাহকারী)</Label>
                <Select value={supplierId} onValueChange={setSupplierId}>
                  <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                  <SelectContent>
                    {(suppliers?.data ?? []).map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Order Date* (অর্ডারের তারিখ)</Label>
                <Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
              </div>
              <div>
                <Label>Expected Delivery (প্রত্যাশিত ডেলিভারি)</Label>
                <Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
              </div>
              <div>
                <Label>Advance Paid (অগ্রিম পরিশোধ)</Label>
                <Input type="number" min="0" value={advance} onChange={(e) => setAdvance(e.target.value)} />
              </div>
            </div>
            <div>
              <Label>Notes (মন্তব্য)</Label>
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Add Product (পণ্য যোগ করুন)</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="Search product… (পণ্য খুঁজুন)"
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  className="max-w-xs"
                />
                <Select value="" onValueChange={addProduct}>
                  <SelectTrigger className="max-w-xs">
                    <SelectValue placeholder={`Select from ${products?.total ?? 0} products`} />
                  </SelectTrigger>
                  <SelectContent>
                    {(products?.data ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="w-28 text-right">Qty</TableHead>
                  <TableHead className="w-32 text-right">Rate</TableHead>
                  <TableHead className="w-32 text-right">Total</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No items yet — add products above</TableCell></TableRow>
                ) : (
                  rows.map((r, i) => (
                    <TableRow key={r.product_id}>
                      <TableCell>{r.product_name}</TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number" min="0.01" step="any" className="h-8 text-right"
                          value={r.quantity}
                          onChange={(e) => updateRow(i, { quantity: Number(e.target.value) })}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number" min="0" step="any" className="h-8 text-right"
                          value={r.unit_price}
                          onChange={(e) => updateRow(i, { unit_price: Number(e.target.value) })}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency((Number(r.quantity) || 0) * (Number(r.unit_price) || 0))}
                      </TableCell>
                      <TableCell>
                        <Button size="icon" variant="ghost" onClick={() => removeRow(i)} aria-label="Remove">
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader className="pb-3"><CardTitle className="text-base">Summary (সারসংক্ষেপ)</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between"><span>Items (পণ্য)</span><span>{rows.length}</span></div>
            <div className="flex justify-between"><span>Total (মোট)</span><span className="font-semibold">{formatCurrency(total)}</span></div>
            <div className="flex justify-between"><span>Advance (অগ্রিম)</span><span>{formatCurrency(Number(advance) || 0)}</span></div>
            <div className="flex justify-between border-t pt-2"><span>Due on Delivery (ডেলিভারিতে প্রদেয়)</span><span className="font-semibold">{formatCurrency(Math.max(0, total - (Number(advance) || 0)))}</span></div>
            <Button
              className="w-full"
              onClick={() => createMut.mutate()}
              disabled={!canSubmit || createMut.isPending}
            >
              <Plus className="mr-1 h-4 w-4" />
              {createMut.isPending ? "Creating…" : "Create Purchase Order"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
