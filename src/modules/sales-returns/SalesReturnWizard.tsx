import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { salesService } from "@/services/salesService";
import { salesReturnService } from "@/services/salesReturnService";
import type { SalesReturnFormValues } from "@/modules/sales-returns/salesReturnSchema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/utils";
import { ArrowLeft, ArrowRight, Check, Package, Receipt, Layers } from "lucide-react";

const STEPS = ["Select Sale", "Select Item", "Batch / Shade", "Confirm"] as const;

interface SalesReturnWizardProps {
  dealerId: string;
  onSubmit: (values: SalesReturnFormValues) => Promise<void>;
  isLoading?: boolean;
}

export default function SalesReturnWizard({ dealerId, onSubmit, isLoading }: SalesReturnWizardProps) {
  const [step, setStep] = useState(0);
  const [saleId, setSaleId] = useState("");
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState(0);
  const [boxPart, setBoxPart] = useState(0);
  const [piecePart, setPiecePart] = useState(0);
  const [refundAmount, setRefundAmount] = useState(0);
  const [isBroken, setIsBroken] = useState(false);
  const [reason, setReason] = useState("");
  const [returnDate, setReturnDate] = useState(new Date().toISOString().slice(0, 10));
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);

  const { data: sales = [] } = useQuery({
    queryKey: ["sales-for-return-wizard", dealerId],
    queryFn: async () => {
      const { data } = await salesService.list(dealerId, 1);
      return data.filter((s: any) => (s.document_status ?? "posted") !== "reversed");
    },
    enabled: !!dealerId,
  });

  const { data: saleItems = [] } = useQuery({
    queryKey: ["sale-items-wizard", saleId],
    queryFn: () => salesReturnService.getSaleItems(saleId),
    enabled: !!saleId,
  });

  const { data: saleBatches = [] } = useQuery({
    queryKey: ["sale-batches-wizard", saleId],
    queryFn: () => salesReturnService.getSaleItemBatches(saleId),
    enabled: !!saleId && step >= 2,
  });

  const selectedSale = sales.find((s: any) => s.id === saleId);
  const selectedItem = saleItems.find((i: any) => i.product_id === productId);
  const isTile = selectedItem?.products?.unit_type === "box_sft";
  const ppb = Math.max(1, Number(selectedItem?.products?.pieces_per_box ?? 1));

  const itemBatches = useMemo(
    () =>
      saleBatches.filter(
        (b: any) => b.product_id === productId && Number(b.allocated_qty) > 0,
      ),
    [saleBatches, productId],
  );

  const setQtyFromBoxPiece = (box: number, piece: number) => {
    setBoxPart(box);
    setPiecePart(piece);
    const total = box + piece / ppb;
    setQty(total);
    if (selectedItem) {
      setRefundAmount(total * Number(selectedItem.sale_rate));
    }
  };

  const selectProduct = (pid: string) => {
    setProductId(pid);
    const item = saleItems.find((i: any) => i.product_id === pid);
    if (item) {
      setQty(Number(item.quantity));
      setRefundAmount(Number(item.sale_rate) * Number(item.quantity));
      if (item.products?.unit_type === "box_sft") {
        setBoxPart(Math.floor(Number(item.quantity)));
        setPiecePart(0);
      }
    }
    setSelectedBatchId(null);
  };

  const canNext = () => {
    if (step === 0) return !!saleId;
    if (step === 1) return !!productId && qty > 0;
    if (step === 2) return itemBatches.length === 0 || !!selectedBatchId;
    return true;
  };

  const handleSubmit = async () => {
    const values: SalesReturnFormValues = {
      sale_id: saleId,
      product_id: productId,
      qty,
      reason,
      is_broken: isBroken,
      refund_amount: refundAmount,
      return_date: returnDate,
    };
    if (isTile && selectedItem) {
      const perBoxSft = Number(selectedItem.products?.per_box_sft ?? 0);
      if (perBoxSft > 0) {
        (values as any).qty_sqft = +(qty * perBoxSft).toFixed(4);
        (values as any).rate_unit = "per_sqft";
      }
    }
    await onSubmit(values);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {STEPS.map((label, i) => (
          <Badge
            key={label}
            variant={i === step ? "default" : i < step ? "secondary" : "outline"}
            className="text-xs"
          >
            {i + 1}. {label}
          </Badge>
        ))}
      </div>

      {step === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Receipt className="h-4 w-4" /> Step 1 — Select sale / invoice
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>Return date</Label>
              <Input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} />
            </div>
            <div>
              <Label>Invoice</Label>
              <Select value={saleId} onValueChange={(v) => { setSaleId(v); setProductId(""); setStep(0); }}>
                <SelectTrigger><SelectValue placeholder="Choose a sale" /></SelectTrigger>
                <SelectContent>
                  {sales.map((s: any) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.invoice_number} — {s.customers?.name ?? "Customer"} ({s.sale_date})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 1 && selectedSale && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Package className="h-4 w-4" /> Step 2 — Select item to return
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Sold Qty</TableHead>
                  <TableHead>Rate</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {saleItems.map((item: any) => (
                  <TableRow key={item.id} className={productId === item.product_id ? "bg-primary/5" : ""}>
                    <TableCell>
                      <div className="font-medium">{item.products?.name}</div>
                      <div className="text-xs text-muted-foreground">{item.products?.sku}</div>
                    </TableCell>
                    <TableCell>{item.quantity}</TableCell>
                    <TableCell>{formatCurrency(item.sale_rate)}</TableCell>
                    <TableCell>
                      <Button size="sm" variant={productId === item.product_id ? "default" : "outline"} onClick={() => selectProduct(item.product_id)}>
                        Select
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {selectedItem && (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div>
                  <Label>Return quantity</Label>
                  {isTile ? (
                    <div className="flex items-center gap-2 mt-1">
                      <Input type="number" min={0} className="w-20" value={boxPart} onChange={(e) => setQtyFromBoxPiece(parseInt(e.target.value) || 0, piecePart)} />
                      <span className="text-xs">box</span>
                      <Input type="number" min={0} max={ppb - 1} className="w-20" value={piecePart} onChange={(e) => setQtyFromBoxPiece(boxPart, parseInt(e.target.value) || 0)} />
                      <span className="text-xs">pc</span>
                    </div>
                  ) : (
                    <Input type="number" min={0.01} max={Number(selectedItem.quantity)} value={qty || ""} onChange={(e) => {
                      const v = parseFloat(e.target.value) || 0;
                      setQty(v);
                      setRefundAmount(v * Number(selectedItem.sale_rate));
                    }} />
                  )}
                </div>
                <div>
                  <Label>Refund amount (৳)</Label>
                  <Input type="number" min={0} step={0.01} value={refundAmount} onChange={(e) => setRefundAmount(parseFloat(e.target.value) || 0)} />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {step === 2 && selectedItem && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Layers className="h-4 w-4" /> Step 3 — Batch / shade (FIFO restore)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {itemBatches.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No batch allocations on this line — stock will restore to aggregate inventory (unbatched).
              </p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Select the batch/shade to restore. The server applies LIFO batch restore; this records your intent.
                </p>
                <div className="flex flex-wrap gap-2">
                  {itemBatches.map((b: any) => (
                    <Button
                      key={b.batch_id}
                      type="button"
                      variant={selectedBatchId === b.batch_id ? "default" : "outline"}
                      size="sm"
                      onClick={() => setSelectedBatchId(b.batch_id)}
                    >
                      {b.batch_no}
                      {b.shade_code ? ` · ${b.shade_code}` : ""}
                      {b.caliber ? ` · ${b.caliber}` : ""}
                      {" "}({Number(b.allocated_qty)} avail)
                    </Button>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Check className="h-4 w-4" /> Step 4 — Confirm return
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-muted-foreground">Invoice</dt>
              <dd className="font-medium">{(selectedSale as any)?.invoice_number}</dd>
              <dt className="text-muted-foreground">Product</dt>
              <dd>{selectedItem?.products?.name}</dd>
              <dt className="text-muted-foreground">Quantity</dt>
              <dd>{qty}</dd>
              <dt className="text-muted-foreground">Refund</dt>
              <dd className="font-semibold">{formatCurrency(refundAmount)}</dd>
              {selectedBatchId && (
                <>
                  <dt className="text-muted-foreground">Batch</dt>
                  <dd>{itemBatches.find((b: any) => b.batch_id === selectedBatchId)?.batch_no ?? selectedBatchId}</dd>
                </>
              )}
            </dl>
            <div className="flex items-center gap-3">
              <Switch checked={isBroken} onCheckedChange={setIsBroken} />
              <Label>Broken / damaged (no restock)</Label>
            </div>
            <div>
              <Label>Return note</Label>
              <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for return…" />
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-between">
        <Button type="button" variant="outline" disabled={step === 0 || isLoading} onClick={() => setStep((s) => s - 1)}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
        {step < STEPS.length - 1 ? (
          <Button type="button" disabled={!canNext() || isLoading} onClick={() => setStep((s) => s + 1)}>
            Next <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        ) : (
          <Button type="button" disabled={isLoading} onClick={handleSubmit}>
            {isLoading ? "Processing…" : "Submit Return"}
          </Button>
        )}
      </div>
    </div>
  );
}
