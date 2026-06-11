import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { salesReturnSchema, type SalesReturnFormValues } from "@/modules/sales-returns/salesReturnSchema";
import { useQuery } from "@tanstack/react-query";
import { salesService } from "@/services/salesService";
import { salesReturnService } from "@/services/salesReturnService";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/utils";
import { Search, Package } from "lucide-react";

interface SalesReturnFormProps {
  dealerId: string;
  onSubmit: (values: SalesReturnFormValues) => Promise<void>;
  isLoading?: boolean;
}

const SalesReturnForm = ({ dealerId, onSubmit, isLoading }: SalesReturnFormProps) => {
  const [selectedSaleId, setSelectedSaleId] = useState<string>("");
  const [productSearch, setProductSearch] = useState("");

  const form = useForm<SalesReturnFormValues>({
    resolver: zodResolver(salesReturnSchema),
    defaultValues: {
      sale_id: "",
      product_id: "",
      qty: 0,
      reason: "",
      is_broken: false,
      refund_amount: 0,
      return_date: new Date().toISOString().split("T")[0],
    },
  });

  // Phase 3U-30: VPS GET /api/sales (most recent page; backend hydrates customers).
  const { data: sales = [] } = useQuery({
    queryKey: ["sales-for-return", dealerId],
    queryFn: async () => {
      const { data } = await salesService.list(dealerId, 1);
      return data as Array<{
        id: string;
        invoice_number: string;
        sale_date: string;
        customers?: { name: string } | null;
      }>;
    },
    enabled: !!dealerId,
  });

  const { data: saleItems = [] } = useQuery({
    queryKey: ["sale-items-return", selectedSaleId],
    queryFn: () => salesReturnService.getSaleItems(selectedSaleId),
    enabled: !!selectedSaleId,
  });

  const { data: saleBatches = [] } = useQuery({
    queryKey: ["sale-item-batches-return", selectedSaleId],
    queryFn: () => salesReturnService.getSaleItemBatches(selectedSaleId),
    enabled: !!selectedSaleId,
  });

  const handleSaleChange = (saleId: string) => {
    setSelectedSaleId(saleId);
    form.setValue("sale_id", saleId);
    form.setValue("product_id", "");
    form.setValue("qty", 0);
    form.setValue("refund_amount", 0);
  };

  const watchQty = form.watch("qty");
  const watchProductId = form.watch("product_id");
  const watchRefund = form.watch("refund_amount");
  const selectedItem = saleItems.find((i: any) => i.product_id === watchProductId);
  const itemBatches = saleBatches.filter(
    (b: any) => b.product_id === watchProductId && Number(b.allocated_qty) > 0,
  );
  const isTile = selectedItem?.products?.unit_type === "box_sft";
  const ppb = Math.max(1, Number(selectedItem?.products?.pieces_per_box ?? 1));
  const boxPart = Math.floor(watchQty || 0);
  const piecePart = Math.round(((watchQty || 0) - boxPart) * ppb);

  const setQtyFromBoxPiece = (box: number, piece: number) => {
    const total = (Number(box) || 0) + (Number(piece) || 0) / ppb;
    form.setValue("qty", total);
    if (selectedItem) {
      form.setValue("refund_amount", total * Number(selectedItem.sale_rate));
    }
  };

  const selectProduct = (productId: string) => {
    form.setValue("product_id", productId);
    setProductSearch("");
    const item = saleItems.find((i: any) => i.product_id === productId);
    if (item) {
      form.setValue("refund_amount", Number(item.sale_rate) * (form.getValues("qty") || 0));
    }
  };

  const filteredSaleItems = saleItems.filter((item: any) => {
    if (!productSearch.trim()) return true;
    const q = productSearch.toLowerCase();
    return (
      item.products?.name?.toLowerCase().includes(q) ||
      item.products?.sku?.toLowerCase().includes(q)
    );
  });

  const selectedSale = sales.find((s: any) => s.id === selectedSaleId);

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(async (values) => {
          // Phase T4b: enrich tile-SQFT product with qty_sqft + rate_unit.
          const prod: any = selectedItem?.products ?? {};
          if (prod?.stock_base_unit === "sqft") {
            const perBoxSft = Number(prod.per_box_sft) || (Number(prod.sqft_per_piece) * Math.max(1, Number(prod.pieces_per_box) || 1));
            if (perBoxSft > 0) {
              (values as any).qty_sqft = +((Number(values.qty) || 0) * perBoxSft).toFixed(4);
              (values as any).rate_unit = "per_sqft";
            }
          }
          await onSubmit(values);
        })}
        className="space-y-5"
      >
        {/* Top fields */}
        <Card>
          <CardContent className="pt-5">
            <p className="mb-4 text-sm text-muted-foreground">
              Please fill in the information below. The field labels marked with <span className="text-destructive">*</span> are required input fields.
            </p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <FormField
                control={form.control}
                name="return_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Return Date <span className="text-destructive">*</span></FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="sale_id"
                render={() => (
                  <FormItem>
                    <FormLabel>Sale / Invoice <span className="text-destructive">*</span></FormLabel>
                    <Select onValueChange={handleSaleChange} value={selectedSaleId}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select sale" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {sales.map((s: any) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.invoice_number} — {(s.customers as any)?.name ?? "Unknown"} ({s.sale_date})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {selectedSale && (
                <div className="flex flex-col justify-end">
                  <p className="text-sm text-muted-foreground">Customer</p>
                  <p className="font-medium text-foreground">{(selectedSale as any).customers?.name ?? "—"}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Select product prompt */}
        <Alert className="border-accent bg-accent/50">
          <AlertDescription className="text-accent-foreground">
            Please select a sale/invoice before adding a return product
          </AlertDescription>
        </Alert>

        {/* Product search */}
        <Card>
          <CardContent className="pt-5">
            <div className="relative">
              <div className="flex items-center gap-2 rounded-md border bg-background">
                <Package className="ml-3 h-5 w-5 text-muted-foreground" />
                <Input
                  placeholder="Search sold products by name or SKU..."
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  className="border-0 shadow-none focus-visible:ring-0"
                  disabled={!selectedSaleId}
                />
                <Search className="mr-3 h-4 w-4 text-muted-foreground" />
              </div>
              {productSearch.trim() && selectedSaleId && (
                <div className="absolute z-50 mt-1 max-h-48 w-full overflow-auto rounded-md border bg-popover shadow-lg">
                  {filteredSaleItems.length === 0 ? (
                    <div className="p-3 text-sm text-muted-foreground">No products found</div>
                  ) : (
                    filteredSaleItems.map((item: any) => (
                      <button
                        key={item.product_id}
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-50"
                        onClick={() => selectProduct(item.product_id)}
                        disabled={watchProductId === item.product_id}
                      >
                        <span className="font-medium">{item.products?.sku}</span>
                        <span className="text-muted-foreground">— {item.products?.name}</span>
                        <Badge variant="secondary" className="ml-auto text-xs">Sold: {item.quantity}</Badge>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            {!selectedSaleId && (
              <p className="mt-2 text-xs text-muted-foreground">Select a sale first to search products</p>
            )}
          </CardContent>
        </Card>

        {/* Order Items table */}
        <div>
          <h3 className="mb-2 text-sm font-semibold text-foreground">Order Items <span className="text-destructive">*</span></h3>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-primary text-primary-foreground [&>th]:text-primary-foreground">
                    <TableHead>Product (Code - Name)</TableHead>
                    <TableHead className="w-28">Net Unit Price</TableHead>
                    <TableHead className="w-28">Quantity</TableHead>
                    <TableHead className="w-28 text-right">Subtotal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedItem ? (
                    <TableRow>
                      <TableCell>
                        <div className="text-sm font-medium">{selectedItem.products?.name}</div>
                        <div className="text-xs text-muted-foreground">{selectedItem.products?.sku}</div>
                        {itemBatches.length > 0 && (
                          <div className="mt-1 space-y-0.5">
                            {itemBatches.map((b: any) => (
                              <Badge key={b.batch_id} variant="outline" className="mr-1 text-xs">
                                {b.batch_no}
                                {b.shade_code ? ` · ${b.shade_code}` : ""}
                                {b.caliber ? ` · ${b.caliber}` : ""}
                                {" "}({Number(b.allocated_qty)} left)
                              </Badge>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{formatCurrency(Number(selectedItem.sale_rate))}</TableCell>
                      <TableCell>
                        {isTile ? (
                          <div className="space-y-1">
                            <div className="flex items-center gap-1">
                              <Input
                                type="number"
                                min={0}
                                step="1"
                                className="h-8 w-16 text-sm"
                                value={boxPart}
                                onChange={(e) => setQtyFromBoxPiece(parseInt(e.target.value) || 0, piecePart)}
                              />
                              <span className="text-xs text-muted-foreground">box</span>
                              <Input
                                type="number"
                                min={0}
                                max={ppb - 1}
                                step="1"
                                className="h-8 w-16 text-sm"
                                value={piecePart}
                                onChange={(e) => setQtyFromBoxPiece(boxPart, parseInt(e.target.value) || 0)}
                              />
                              <span className="text-xs text-muted-foreground">pc</span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              = {(watchQty || 0).toFixed(3)} box · Max sold: {Number(selectedItem.quantity)}
                            </p>
                          </div>
                        ) : (
                          <FormField
                            control={form.control}
                            name="qty"
                            render={({ field }) => (
                              <FormItem className="space-y-0">
                                <FormControl>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    max={Number(selectedItem.quantity)}
                                    className="h-8 w-24 text-sm"
                                    {...field}
                                    onChange={(e) => {
                                      field.onChange(e);
                                      const qty = parseFloat(e.target.value) || 0;
                                      form.setValue("refund_amount", qty * Number(selectedItem.sale_rate));
                                    }}
                                  />
                                </FormControl>
                                <p className="text-xs text-muted-foreground mt-0.5">Max: {Number(selectedItem.quantity)}</p>
                              </FormItem>
                            )}
                          />
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium text-sm">
                        {formatCurrency(watchRefund || 0)}
                      </TableCell>
                    </TableRow>
                  ) : (
                    <TableRow>
                      <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                        No product selected. Use the search bar above.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        {/* Options: Broken toggle + Refund */}
        <Card>
          <CardContent className="pt-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <FormField
                control={form.control}
                name="is_broken"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-3 pt-2">
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                    <FormLabel className="!mt-0">Broken / Damaged (no restock)</FormLabel>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="refund_amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Refund Amount (৳)</FormLabel>
                    <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </CardContent>
        </Card>

        {/* Return Note */}
        <Card>
          <CardContent className="pt-5">
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Return Note</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Reason for return..." rows={4} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* Submit / Reset */}
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={isLoading}>
            {isLoading ? "Processing…" : "Submit"}
          </Button>
          <Button type="button" variant="destructive" onClick={() => { form.reset(); setSelectedSaleId(""); }} disabled={isLoading}>
            Reset
          </Button>
        </div>

        {/* Summary footer */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border bg-accent/30 px-4 py-3 text-sm">
          <span className="text-muted-foreground">Items <strong className="text-foreground">{selectedItem ? 1 : 0}</strong></span>
          <span className="text-muted-foreground">Total <strong className="text-foreground">{formatCurrency(watchRefund || 0)}</strong></span>
          <span className="ml-auto font-semibold text-foreground">Grand Total <strong>{formatCurrency(watchRefund || 0)}</strong></span>
        </div>
      </form>
    </Form>
  );
};

export default SalesReturnForm;
