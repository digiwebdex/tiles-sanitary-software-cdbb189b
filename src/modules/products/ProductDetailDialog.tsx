import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";
import { useQuery } from "@tanstack/react-query";
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import { Printer, Pencil, Barcode, ShoppingCart } from "lucide-react";

interface ProductDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: {
    id: string;
    sku: string;
    name: string;
    brand: string | null;
    category: string;
    unit_type: string;
    per_box_sft: number | null;
    default_sale_rate: number;
    reorder_level: number;
    size: string | null;
    color: string | null;
    active: boolean;
    // V2 Sprint 2 — Product Master taxonomy (optional; older/blank products
    // simply omit them from the details list below).
    product_group?: string | null;
    series?: string | null;
    collection_name?: string | null;
    tile_type?: string | null;
    finish?: string | null;
    surface?: string | null;
    shade_family?: string | null;
    caliber_spec?: string | null;
    thickness_mm?: number | null;
    country_of_origin?: string | null;
    default_rack?: string | null;
  } | null;
  cost: number;
  lastCost?: number;
  quantity: number;
  showCost?: boolean;
  /** V2 Sprint 2 — needed to fetch batch/shade-lot + backorder + display-sample info. */
  dealerId?: string;
  onEdit: () => void;
  onPrintBarcode?: () => void;
  onPurchase?: () => void;
}

interface ProductBatch {
  id: string;
  batch_no: string;
  lot_no: string | null;
  shade_code: string | null;
  caliber: string | null;
  box_qty: number;
  piece_qty: number;
  status: string;
}

const ProductDetailDialog = ({
  open, onOpenChange, product, cost, lastCost, quantity, showCost = true, dealerId, onEdit, onPrintBarcode, onPurchase,
}: ProductDetailDialogProps) => {
  const barcodeSvgRef = useRef<SVGSVGElement>(null);

  // V2 Sprint 2 — enrichment data not in the row already passed down: active
  // shade/lot batches, outstanding backorder qty, and showroom sample qty.
  // Reuses the same GET /:id/stock-summary endpoint (extended, additive) that
  // ProductForm/StockSummaryDialog already call.
  const { data: enrichment } = useQuery({
    queryKey: ["product-detail-enrichment", product?.id, dealerId],
    queryFn: async () => {
      const res = await vpsAuthedFetch(
        `/api/products/${product!.id}/stock-summary?dealerId=${encodeURIComponent(dealerId!)}`,
      );
      if (!res.ok) return null;
      const body = await res.json().catch(() => null as any);
      return body as {
        batches: ProductBatch[];
        backorderQty: number;
        displaySampleQty: number;
      } | null;
    },
    enabled: open && !!product?.id && !!dealerId,
  });

  useEffect(() => {
    if (barcodeSvgRef.current && product?.sku && open) {
      try {
        JsBarcode(barcodeSvgRef.current, product.sku, {
          format: "CODE128",
          width: 2,
          height: 50,
          displayValue: true,
          margin: 4,
          fontSize: 12,
        });
      } catch {
        // Invalid barcode
      }
    }
  }, [product?.sku, open]);

  if (!product) return null;

  const unitLabel = product.unit_type === "box_sft" ? "Square Feet (Sft)" : "Piece";
  const isBoxSft = product.unit_type === "box_sft";
  const perBoxSft = Number(product.per_box_sft) || 0;
  const safeCost = Math.max(0, cost);
  const safeLast = Math.max(0, lastCost ?? 0);
  const boxCost = isBoxSft && perBoxSft > 0 ? safeCost * perBoxSft : 0;
  const lastBoxCost = isBoxSft && perBoxSft > 0 ? safeLast * perBoxSft : 0;

  const details: { label: string; value: string }[] = [
    { label: "Name", value: product.name },
    { label: "Code", value: product.sku },
    { label: "Brand", value: product.brand || "—" },
    { label: "Category", value: product.category },
    { label: "Unit", value: unitLabel },
    { label: "Size", value: product.size || "—" },
    { label: "Color", value: product.color || "—" },
  ];

  // V2 Sprint 2 — Product Master taxonomy. Only shown when set, so products
  // that predate these fields don't show a wall of "—".
  const taxonomy: Array<[string, string | null | undefined]> = [
    ["Sub Category", product.product_group],
    ["Series", product.series],
    ["Collection", product.collection_name],
    [product.category === "sanitary" ? "Type" : "Tile Type", product.tile_type],
    ["Finish", product.finish],
    ["Surface", product.surface],
    ["Shade Family", product.shade_family],
    ["Caliber (spec)", product.caliber_spec],
    ["Thickness", product.thickness_mm ? `${product.thickness_mm} mm` : null],
    ["Country of Origin", product.country_of_origin],
    ["Default Rack", product.default_rack],
  ];
  for (const [label, value] of taxonomy) {
    if (value) details.push({ label, value });
  }

  if (isBoxSft && perBoxSft > 0) {
    details.push({ label: "Per Box (Sft)", value: String(perBoxSft) });
    if (showCost) {
      details.push({ label: "Avg Cost/Sft", value: formatCurrency(safeCost) });
      details.push({ label: "Avg Cost/Box", value: formatCurrency(boxCost) });
      if (safeLast > 0) {
        details.push({ label: "Last Cost/Sft", value: formatCurrency(safeLast) });
        details.push({ label: "Last Cost/Box", value: formatCurrency(lastBoxCost) });
      }
    }
  } else {
    if (showCost) {
      details.push({ label: "Avg Cost", value: formatCurrency(safeCost) });
      if (safeLast > 0) {
        details.push({ label: "Last Cost", value: formatCurrency(safeLast) });
      }
    }
  }

  details.push(
    { label: "Price", value: formatCurrency(product.default_sale_rate) },
    { label: "Alert Qty", value: product.reorder_level > 0 ? String(product.reorder_level) : "—" },
    { label: "Status", value: product.active ? "Active" : "Inactive" },
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg uppercase">{product.name}</DialogTitle>
        </DialogHeader>

        <div className="flex justify-center py-2">
          <div className="bg-white rounded p-3 border">
            <svg ref={barcodeSvgRef} />
          </div>
        </div>

        <Separator />

        <div className="rounded-md border">
          <Table>
            <TableBody>
              {details.map((d) => (
                <TableRow key={d.label}>
                  <TableCell className="font-medium text-muted-foreground w-1/3 py-2">{d.label}</TableCell>
                  <TableCell className="py-2">{d.value}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

         <div className="space-y-2">
           <h4 className="text-sm font-semibold text-muted-foreground uppercase">Stock</h4>
           <div className="rounded-md border">
             <Table>
               <TableHeader>
                 <TableRow>
                   <TableHead>Quantity</TableHead>
                   {showCost && <TableHead>{isBoxSft ? "Avg Cost/Sft" : "Avg Cost"}</TableHead>}
                   {showCost && isBoxSft && perBoxSft > 0 && <TableHead>Avg Cost/Box</TableHead>}
                 </TableRow>
               </TableHeader>
               <TableBody>
                 <TableRow>
                   <TableCell className={`font-medium ${quantity < 0 ? "text-destructive" : ""}`}>
                     {quantity.toFixed(2)}
                   </TableCell>
                   {showCost && <TableCell>{formatCurrency(safeCost)}</TableCell>}
                   {showCost && isBoxSft && perBoxSft > 0 && <TableCell>{formatCurrency(boxCost)}</TableCell>}
                 </TableRow>
               </TableBody>
             </Table>
           </div>
         </div>

        {/* V2 Sprint 2 — reserved / backorder / display-sample quick summary,
            plus active shade/lot batches (existing data, freshly surfaced). */}
        {enrichment && (
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-muted-foreground uppercase">Stock &amp; Location</h4>
            <div className="flex flex-wrap gap-2">
              {enrichment.backorderQty > 0 && (
                <Badge variant="destructive" className="font-normal">
                  Backorder: {enrichment.backorderQty.toFixed(2)}
                </Badge>
              )}
              {enrichment.displaySampleQty > 0 && (
                <Badge variant="secondary" className="font-normal">
                  Display sample: {enrichment.displaySampleQty.toFixed(2)}
                </Badge>
              )}
              {enrichment.backorderQty === 0 && enrichment.displaySampleQty === 0 && (
                <span className="text-xs text-muted-foreground">No backorder or display sample stock.</span>
              )}
            </div>

            {enrichment.batches?.some((b) => b.status === "active") && (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Batch / Lot</TableHead>
                      <TableHead>Shade</TableHead>
                      <TableHead>Caliber</TableHead>
                      <TableHead>Qty</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {enrichment.batches
                      .filter((b) => b.status === "active")
                      .map((b) => (
                        <TableRow key={b.id}>
                          <TableCell className="text-xs">
                            {b.batch_no}{b.lot_no ? ` / ${b.lot_no}` : ""}
                          </TableCell>
                          <TableCell className="text-xs">{b.shade_code || "—"}</TableCell>
                          <TableCell className="text-xs">{b.caliber || "—"}</TableCell>
                          <TableCell className="text-xs">
                            {isBoxSft ? `${b.box_qty} box` : `${b.piece_qty} pc`}
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2 pt-2">
          {onPrintBarcode && (
            <Button variant="outline" className="flex-1" onClick={onPrintBarcode}>
              <Barcode className="mr-2 h-4 w-4" /> Barcode
            </Button>
          )}
          {onPurchase && (
            <Button variant="outline" className="flex-1" onClick={onPurchase}>
              <ShoppingCart className="mr-2 h-4 w-4" /> Purchase
            </Button>
          )}
          <Button className="flex-1" onClick={onEdit}>
            <Pencil className="mr-2 h-4 w-4" /> Edit
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ProductDetailDialog;
