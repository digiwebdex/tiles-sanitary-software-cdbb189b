import { formatCurrency, CURRENCY_CODE } from "@/lib/utils";
import { formatStockUnit } from "@/lib/units";
import { Separator } from "@/components/ui/separator";
import { TrendingUp } from "lucide-react";
import SaleInvoiceBarcode from "./SaleInvoiceBarcode";
import RateSourceBadge from "@/components/RateSourceBadge";
import VatTaxInvoiceDocument from "./VatTaxInvoiceDocument";

interface SaleInvoiceDocumentProps {
  sale: any;
  items: any[];
  customer: any;
  subtotal: number;
  totalAmount: number;
  discountAmount: number;
  paidAmount: number;
  dueAmount: number;
  isDealerAdmin: boolean;
  dealerInfo?: {
    name: string;
    phone: string | null;
    address: string | null;
    tax_id?: string | null;
  } | null;
  salesReturns?: any[];
  /** Optional Project link details (Project / Site-wise Sales). */
  project?: { project_name: string; project_code: string } | null;
  /** Optional delivery Site under the project. Address overrides billing address when present. */
  site?: { site_name: string; address: string | null; contact_person: string | null; contact_phone: string | null } | null;
}

const SaleInvoiceDocument = ({
  sale,
  items,
  customer,
  subtotal,
  totalAmount,
  discountAmount,
  paidAmount,
  dueAmount,
  isDealerAdmin,
  dealerInfo,
  salesReturns = [],
  project,
  site,
}: SaleInvoiceDocumentProps) => {
  const paymentStatus =
    dueAmount <= 0 ? "Paid" : paidAmount > 0 ? "Partial" : "Pending";

  const vatAmount = Number(sale?.vat_amount ?? 0);
  const sdAmount = Number(sale?.sd_amount ?? 0);
  const showVat = vatAmount > 0 || sdAmount > 0;

  const businessName = dealerInfo?.name ?? "Your Business Name";
  // When a site address is present, use it as the delivery address override.
  const billingAddress = site?.address ?? customer?.address ?? null;

  if (showVat) {
    return (
      <div className="text-sm text-foreground">
        <VatTaxInvoiceDocument
          sale={sale}
          items={items}
          customer={customer}
          subtotal={subtotal}
          totalAmount={totalAmount}
          discountAmount={discountAmount}
          paidAmount={paidAmount}
          dueAmount={dueAmount}
          dealerInfo={dealerInfo}
          project={project}
          site={site}
        />
        {salesReturns.length > 0 && (
          <div className="px-6 mb-4 mt-4 border-t pt-4">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
              Returns & Refunds
            </p>
            <div className="rounded-md border text-xs">
              <table className="w-full">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="px-2 py-1.5 text-left font-semibold">Product</th>
                    <th className="px-2 py-1.5 text-center font-semibold">Qty</th>
                    <th className="px-2 py-1.5 text-right font-semibold">Refund</th>
                  </tr>
                </thead>
                <tbody>
                  {salesReturns.map((r: any) => (
                    <tr key={r.id} className="border-t">
                      <td className="px-2 py-1.5">{r.products?.name ?? "—"}</td>
                      <td className="px-2 py-1.5 text-center">{r.qty}</td>
                      <td className="px-2 py-1.5 text-right font-semibold text-destructive">
                        {formatCurrency(r.refund_amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {isDealerAdmin && (
          <div className="no-print mx-6 mb-4 rounded border border-blue-200 bg-blue-50 p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="h-4 w-4 text-blue-700" />
              <p className="text-xs font-bold uppercase tracking-wider text-blue-700">
                Profit Breakdown (Owner Only — Not Printed)
              </p>
            </div>
            <div className="grid grid-cols-4 gap-3 text-center text-sm">
              <ProfitCard label="COGS" value={formatCurrency(Number((sale as any).cogs) || 0)} color="text-destructive" />
              <ProfitCard label="Gross Profit" value={formatCurrency(Number((sale as any).gross_profit) || 0)} color={Number((sale as any).gross_profit) >= 0 ? "text-green-700" : "text-destructive"} />
              <ProfitCard label="Net Profit" value={formatCurrency(Number((sale as any).net_profit) || 0)} color={Number((sale as any).net_profit) >= 0 ? "text-green-700" : "text-destructive"} />
              <ProfitCard
                label="Margin %"
                value={Number(sale.total_amount) > 0 ? `${((Number((sale as any).net_profit) / Number(sale.total_amount)) * 100).toFixed(1)}%` : "—"}
                color={Number(sale.total_amount) > 0 && Number((sale as any).net_profit) >= 0 ? "text-green-700" : "text-destructive"}
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="text-sm text-foreground">
      {/* Company Header */}
      <div className="flex items-center justify-between px-6 pt-6 pb-4">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
            <span className="text-xl font-black text-primary">
              {businessName.charAt(0)}
            </span>
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground">{businessName}</h1>
            <p className="text-xs text-muted-foreground">Tile & Sanitary Dealer</p>
          </div>
        </div>
      </div>

      <Separator />

      {/* Sale Info Bar */}
      <div className="mx-6 my-4 rounded-md border bg-muted/30 px-4 py-3 grid grid-cols-2 gap-y-1 text-xs">
        <div className="flex items-center gap-3">
          <SaleInvoiceBarcode value={sale.invoice_number ?? "N/A"} />
        </div>
        <div className="text-right space-y-0.5">
          {/* empty for alignment */}
        </div>
        <div>
          <span className="text-muted-foreground">Date: </span>
          <span className="font-medium">{sale.sale_date}</span>
        </div>
        <div className="text-right">
          <span className="text-muted-foreground">Sale Status: </span>
          <span className="font-medium capitalize">{(sale.sale_status ?? "invoiced").replace(/_/g, " ")}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Reference: </span>
          <span className="font-mono font-medium">{sale.invoice_number ?? "—"}</span>
        </div>
        <div className="text-right">
          <span className="text-muted-foreground">Payment Status: </span>
          <span className={`font-semibold ${dueAmount <= 0 ? "text-green-600" : dueAmount > 0 && paidAmount > 0 ? "text-yellow-600" : "text-destructive"}`}>
            {paymentStatus}
          </span>
        </div>
      </div>

      {/* To / From */}
      <div className="grid grid-cols-2 gap-6 px-6 mb-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">To:</p>
          <p className="font-bold text-foreground">{customer?.name ?? "—"}</p>
          {project && (
            <p className="text-xs text-foreground mt-0.5">
              <span className="text-muted-foreground">Project: </span>
              <span className="font-mono">{project.project_code}</span> · {project.project_name}
            </p>
          )}
          {site && (
            <p className="text-xs text-foreground mt-0.5">
              <span className="text-muted-foreground">Site: </span>
              <span className="font-medium">{site.site_name}</span>
              {site.contact_person ? ` · ${site.contact_person}` : ""}
              {site.contact_phone ? ` · ${site.contact_phone}` : ""}
            </p>
          )}
          {billingAddress && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {site?.address ? "Delivery: " : ""}{billingAddress}
            </p>
          )}
          {customer?.phone && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Tel: {customer.phone}
            </p>
          )}
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">From:</p>
          <p className="font-bold text-foreground">{businessName}</p>
          {dealerInfo?.address && <p className="text-xs text-muted-foreground mt-0.5">{dealerInfo.address}</p>}
          {dealerInfo?.phone && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Tel: {dealerInfo.phone}
            </p>
          )}
        </div>
      </div>

      {/* Items Table */}
      <div className="px-6 mb-4">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-primary text-primary-foreground">
              <th className="px-3 py-2 text-left font-semibold w-10">No.</th>
              <th className="px-3 py-2 text-left font-semibold">Description</th>
              <th className="px-3 py-2 text-center font-semibold">Quantity</th>
              <th className="px-3 py-2 text-right font-semibold">Unit Price</th>
              <th className="px-3 py-2 text-right font-semibold">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item: any, idx: number) => {
              const unitType = item.products?.unit_type;
              const ppb = Math.max(1, Number(item.products?.pieces_per_box ?? 1));
              const qtyDisplay = formatStockUnit(Number(item.quantity) || 0, ppb, unitType === "box_sft");
              const sftDisplay = item.total_sft ? ` (${Number(item.total_sft).toFixed(2)} Sft)` : "";

              return (
                <tr key={item.id} className={idx % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                  <td className="px-3 py-2 text-muted-foreground border-b">{idx + 1}</td>
                  <td className="px-3 py-2 border-b">
                    <p className="font-medium text-foreground">{item.products?.name}</p>
                    <p className="text-xs text-muted-foreground">{item.products?.sku}</p>
                  </td>
                  <td className="px-3 py-2 text-center border-b">
                    {qtyDisplay}{sftDisplay}
                  </td>
                  <td className="px-3 py-2 text-right border-b">
                    <div className="flex items-center justify-end gap-1.5">
                      <span>{formatCurrency(item.sale_rate)}</span>
                      <RateSourceBadge
                        source={item.rate_source ?? "default"}
                        className="text-[9px] px-1 py-0 h-4 print:border print:bg-transparent"
                      />
                    </div>
                    {item.rate_source === "manual" && item.original_resolved_rate != null && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        was {formatCurrency(Number(item.original_resolved_rate))}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold border-b">{formatCurrency(item.total)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Box/Piece/SFT Summary */}
        {(Number(sale.total_box) > 0 || Number(sale.total_piece) > 0) && (
          <div className="flex gap-3 mt-2 text-xs font-medium text-muted-foreground justify-end">
            {Number(sale.total_box) > 0 && <span>Total Box: <strong className="text-foreground">{Number(sale.total_box)}</strong></span>}
            {Number(sale.total_sft) > 0 && <span>Total Sft: <strong className="text-foreground">{Number(sale.total_sft).toFixed(2)}</strong></span>}
            {Number(sale.total_piece) > 0 && <span>Total Pcs: <strong className="text-foreground">{Number(sale.total_piece)}</strong></span>}
          </div>
        )}

        {/* Backorder / Fulfillment Status */}
        {sale.has_backorder && (
          <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3">
            <p className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400 mb-2">
              Backorder / Fulfillment Status
            </p>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-amber-800 dark:text-amber-300">
                  <th className="text-left py-1 font-semibold">Product</th>
                  <th className="text-center py-1 font-semibold">Ordered</th>
                  <th className="text-center py-1 font-semibold">Available at Sale</th>
                  <th className="text-center py-1 font-semibold">Backorder</th>
                  <th className="text-center py-1 font-semibold">Allocated</th>
                  <th className="text-center py-1 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {items.filter((i: any) => Number(i.backorder_qty) > 0 || !["in_stock", "fulfilled"].includes(i.fulfillment_status)).map((item: any) => {
                  const statusLabels: Record<string, string> = {
                    in_stock: "In Stock",
                    fulfilled: "Fulfilled",
                    pending: "Backordered",
                    partially_allocated: "Partially Allocated",
                    ready_for_delivery: "Ready for Delivery",
                    partially_delivered: "Partially Delivered",
                    cancelled: "Cancelled",
                  };
                  const statusColors: Record<string, string> = {
                    in_stock: "text-green-600",
                    fulfilled: "text-green-700",
                    pending: "text-red-600",
                    partially_allocated: "text-amber-600",
                    ready_for_delivery: "text-blue-600",
                    partially_delivered: "text-orange-600",
                    cancelled: "text-muted-foreground",
                  };
                  return (
                    <tr key={item.id} className="border-t border-amber-200">
                      <td className="py-1 text-foreground font-medium">{item.products?.name}</td>
                      <td className="py-1 text-center">{item.quantity}</td>
                      <td className="py-1 text-center">{item.available_qty_at_sale ?? "—"}</td>
                      <td className="py-1 text-center font-semibold text-amber-700">{item.backorder_qty ?? 0}</td>
                      <td className="py-1 text-center font-semibold text-blue-700">{item.allocated_qty ?? 0}</td>
                      <td className={`py-1 text-center font-semibold ${statusColors[item.fulfillment_status] ?? ""}`}>
                        {statusLabels[item.fulfillment_status] ?? item.fulfillment_status}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Totals */}
      <div className="px-6 mb-4">
        <div className="ml-auto w-72 space-y-1 text-sm">
          <Row label={`Total(${CURRENCY_CODE})`} value={formatCurrency(subtotal)} />
          {discountAmount > 0 && (
            <Row label={`Order Discount (${CURRENCY_CODE})`} value={`(${formatCurrency(discountAmount)})`} className="text-destructive" />
          )}
          <Separator className="my-1" />
          <Row label={`Amount(${CURRENCY_CODE})`} value={formatCurrency(totalAmount)} bold />
          <Row label={`Paid(${CURRENCY_CODE})`} value={formatCurrency(paidAmount)} />
          <Separator className="my-1" />
          <Row
            label={`Balance (${CURRENCY_CODE})`}
            value={formatCurrency(dueAmount)}
            bold
            className={dueAmount > 0 ? "text-destructive" : "text-green-600"}
          />
        </div>
      </div>

      {/* Returns / Refunds */}
      {salesReturns.length > 0 && (
        <div className="px-6 mb-4">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Returns & Refunds</p>
          <div className="rounded-md border text-xs">
            <table className="w-full">
              <thead>
                <tr className="bg-muted/50">
                  <th className="px-2 py-1.5 text-left font-semibold">Product</th>
                  <th className="px-2 py-1.5 text-center font-semibold">Qty</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Refund</th>
                  <th className="px-2 py-1.5 text-left font-semibold">Type</th>
                </tr>
              </thead>
              <tbody>
                {salesReturns.map((r: any) => (
                  <tr key={r.id} className="border-t">
                    <td className="px-2 py-1.5">{r.products?.name ?? "—"}</td>
                    <td className="px-2 py-1.5 text-center">{r.qty}</td>
                    <td className="px-2 py-1.5 text-right font-semibold text-destructive">{formatCurrency(r.refund_amount)}</td>
                    <td className="px-2 py-1.5">{r.is_broken ? "Broken" : "Return"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-right mt-1 text-xs">
            <span className="text-muted-foreground">Total Refund: </span>
            <span className="font-bold text-destructive">{formatCurrency(salesReturns.reduce((s: number, r: any) => s + Number(r.refund_amount), 0))}</span>
          </div>
        </div>
      )}

      <div className="px-6 pb-4 text-xs text-primary">
        <p>Created by: {sale.created_by ?? "—"}</p>
        <p>Date: {sale.sale_date}</p>
      </div>

      {/* Profit Breakdown — Owner only, hidden from print */}
      {isDealerAdmin && (
        <div className="no-print mx-6 mb-4 rounded border border-blue-200 bg-blue-50 p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="h-4 w-4 text-blue-700" />
            <p className="text-xs font-bold uppercase tracking-wider text-blue-700">Profit Breakdown (Owner Only — Not Printed)</p>
          </div>

          {/* Detailed Breakdown Table */}
          <div className="rounded-md border border-blue-100 bg-white mb-3 text-sm">
            <table className="w-full">
              <tbody>
                <ProfitRow label="Sale Amount" value={formatCurrency(totalAmount)} />
                <ProfitRow label="(-) Discount" value={discountAmount > 0 ? `(${formatCurrency(discountAmount)})` : "—"} muted={discountAmount <= 0} />
                <ProfitRow label="Net Sale Amount" value={formatCurrency(totalAmount - discountAmount)} bold />
                <ProfitRow label="(-) Cost Amount (COGS)" value={formatCurrency(Number((sale as any).cogs) || 0)} sub />
                <ProfitRow
                  label="= Gross Profit"
                  value={formatCurrency(Number((sale as any).gross_profit) || 0)}
                  bold
                  color={Number((sale as any).gross_profit) >= 0 ? "text-green-700" : "text-destructive"}
                />
                <ProfitRow
                  label="(-) Expense Impact"
                  value={formatCurrency(Math.max(0, (Number((sale as any).gross_profit) || 0) - (Number((sale as any).net_profit) || 0)))}
                  sub
                />
                <ProfitRow
                  label="= Net Profit"
                  value={formatCurrency(Number((sale as any).net_profit) || 0)}
                  bold
                  color={Number((sale as any).net_profit) >= 0 ? "text-green-700" : "text-destructive"}
                />
              </tbody>
            </table>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-4 gap-3 text-center text-sm">
            <ProfitCard label="COGS" value={formatCurrency(Number((sale as any).cogs) || 0)} color="text-destructive" />
            <ProfitCard label="Gross Profit" value={formatCurrency(Number((sale as any).gross_profit) || 0)} color={Number((sale as any).gross_profit) >= 0 ? "text-green-700" : "text-destructive"} />
            <ProfitCard label="Net Profit" value={formatCurrency(Number((sale as any).net_profit) || 0)} color={Number((sale as any).net_profit) >= 0 ? "text-green-700" : "text-destructive"} />
            <ProfitCard
              label="Margin %"
              value={Number(sale.total_amount) > 0 ? `${((Number((sale as any).net_profit) / Number(sale.total_amount)) * 100).toFixed(1)}%` : "—"}
              color={Number(sale.total_amount) > 0 && Number((sale as any).net_profit) >= 0 ? "text-green-700" : "text-destructive"}
            />
          </div>

          <p className="text-[10px] text-blue-500 mt-2">* Cost calculated using weighted average cost per SFT for tile products</p>
        </div>
      )}

      {/* Footer */}
      <div className="px-6 pb-4 flex justify-between text-xs text-muted-foreground border-t pt-3 mx-6">
        <span>{businessName}</span>
        <span>Invoice #{sale.invoice_number} · {sale.sale_date}</span>
      </div>
    </div>
  );
};

/* ---------- helpers ---------- */

const Row = ({ label, value, bold, className }: { label: string; value: string; bold?: boolean; className?: string }) => (
  <div className={`flex justify-between py-0.5 ${bold ? "font-bold" : ""} ${className ?? ""}`}>
    <span>{label}</span>
    <span>{value}</span>
  </div>
);

const ProfitCard = ({ label, value, color }: { label: string; value: string; color: string }) => (
  <div className="rounded bg-white p-2 border border-blue-100">
    <p className="text-xs text-muted-foreground uppercase mb-1">{label}</p>
    <p className={`font-bold ${color}`}>{value}</p>
  </div>
);

const ProfitRow = ({ label, value, bold, sub, muted, color }: { label: string; value: string; bold?: boolean; sub?: boolean; muted?: boolean; color?: string }) => (
  <tr className={bold ? "bg-blue-50/50 font-semibold" : ""}>
    <td className={`px-3 py-1.5 ${sub ? "pl-6 text-muted-foreground" : ""} ${muted ? "text-muted-foreground" : ""}`}>{label}</td>
    <td className={`px-3 py-1.5 text-right ${color ?? ""} ${bold ? "font-bold" : ""} ${muted ? "text-muted-foreground" : ""}`}>{value}</td>
  </tr>
);

export default SaleInvoiceDocument;
