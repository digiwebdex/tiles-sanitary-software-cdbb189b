/**
 * P5-05 — Mushak-6.3 style VAT tax invoice (Bangla + English) for print.
 */
import { formatCurrency, CURRENCY_CODE } from "@/lib/utils";
import { formatStockUnit } from "@/lib/units";
import { amountInWordsBdt } from "@/lib/amountInWords";
import SaleInvoiceBarcode from "./SaleInvoiceBarcode";

export interface VatInvoiceDealerInfo {
  name: string;
  phone: string | null;
  address: string | null;
  tax_id?: string | null;
}

interface VatTaxInvoiceDocumentProps {
  sale: any;
  items: any[];
  customer: any;
  subtotal: number;
  totalAmount: number;
  discountAmount: number;
  paidAmount: number;
  dueAmount: number;
  dealerInfo?: VatInvoiceDealerInfo | null;
  project?: { project_name: string; project_code: string } | null;
  site?: {
    site_name: string;
    address: string | null;
    contact_person: string | null;
    contact_phone: string | null;
  } | null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Allocate header VAT across lines proportionally for Mushak line display. */
function lineVatAllocations(
  items: any[],
  taxableAmount: number,
  vatAmount: number,
): number[] {
  if (taxableAmount <= 0 || vatAmount <= 0) {
    return items.map(() => 0);
  }
  const raw = items.map((it) => round2((Number(it.total) / taxableAmount) * vatAmount));
  const sum = raw.reduce((s, v) => s + v, 0);
  const drift = round2(vatAmount - sum);
  if (raw.length > 0 && drift !== 0) {
    raw[raw.length - 1] = round2(raw[raw.length - 1] + drift);
  }
  return raw;
}

const VatTaxInvoiceDocument = ({
  sale,
  items,
  customer,
  subtotal,
  totalAmount,
  discountAmount,
  paidAmount,
  dueAmount,
  dealerInfo,
  project,
  site,
}: VatTaxInvoiceDocumentProps) => {
  const vatAmount = Number(sale?.vat_amount ?? 0);
  const taxableAmount = Number(sale?.taxable_amount ?? 0) || Math.max(0, subtotal - discountAmount);
  const sdAmount = Number(sale?.sd_amount ?? 0);
  const vatRate = Number(sale?.vat_rate ?? 0);
  const lineVats = lineVatAllocations(items, taxableAmount, vatAmount);
  const billingAddress = site?.address ?? customer?.address ?? null;
  const businessName = dealerInfo?.name ?? "Your Business Name";
  const paymentStatus =
    dueAmount <= 0 ? "Paid / পরিশোধিত" : paidAmount > 0 ? "Partial / আংশিক" : "Due / বকেয়া";

  return (
    <div className="vat-tax-invoice text-[11px] leading-snug text-foreground print:text-black">
      {/* NBR-style header band */}
      <div className="border-2 border-foreground px-4 py-3 text-center">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground print:text-gray-700">
          Government of the People&apos;s Republic of Bangladesh
        </p>
        <p className="text-[10px] text-muted-foreground print:text-gray-700">
          National Board of Revenue · জাতীয় রাজস্ব বোর্ড
        </p>
        <h1 className="text-lg font-bold mt-1 bangla-text">মূল্য সংযোজন কর চালান</h1>
        <h2 className="text-sm font-semibold tracking-wide">VAT Tax Invoice</h2>
        <p className="text-xs font-mono mt-1">Form: Mushak-6.3</p>
      </div>

      {/* Meta row */}
      <div className="grid grid-cols-2 gap-0 border-x-2 border-b-2 border-foreground">
        <div className="border-r border-foreground p-3 space-y-1">
          <p>
            <span className="font-semibold bangla-text">চালান নং / Invoice No:</span>{" "}
            <span className="font-mono font-bold">{sale.invoice_number ?? "—"}</span>
          </p>
          <p>
            <span className="font-semibold bangla-text">তারিখ / Date:</span>{" "}
            <span className="font-medium">{sale.sale_date}</span>
          </p>
          {sale.payment_mode && (
            <p>
              <span className="font-semibold">Payment mode:</span> {sale.payment_mode}
            </p>
          )}
        </div>
        <div className="p-3 flex flex-col items-end justify-center">
          <SaleInvoiceBarcode value={sale.invoice_number ?? "N/A"} />
          <p className="mt-2 text-xs">
            <span className="text-muted-foreground">Status:</span>{" "}
            <span className="font-semibold">{paymentStatus}</span>
          </p>
        </div>
      </div>

      {/* Seller / Buyer */}
      <div className="grid grid-cols-2 gap-0 border-x-2 border-b-2 border-foreground">
        <div className="border-r border-foreground p-3">
          <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1 bangla-text">
            মূল্য যোগকারী / Registered Supplier (Seller)
          </p>
          <p className="font-bold text-sm">{businessName}</p>
          {dealerInfo?.address && <p className="mt-0.5">{dealerInfo.address}</p>}
          {dealerInfo?.phone && <p>Tel: {dealerInfo.phone}</p>}
          <p className="mt-1">
            <span className="font-semibold bangla-text">বিন (BIN):</span>{" "}
            <span className="font-mono">{dealerInfo?.tax_id?.trim() || "—"}</span>
          </p>
        </div>
        <div className="p-3">
          <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1 bangla-text">
            ক্রেতা / Purchaser (Buyer)
          </p>
          <p className="font-bold text-sm">{customer?.name ?? "—"}</p>
          {project && (
            <p className="text-xs">
              Project: <span className="font-mono">{project.project_code}</span> · {project.project_name}
            </p>
          )}
          {site && (
            <p className="text-xs">
              Site: {site.site_name}
              {site.contact_person ? ` · ${site.contact_person}` : ""}
            </p>
          )}
          {billingAddress && <p className="mt-0.5">{billingAddress}</p>}
          {customer?.phone && <p>Tel: {customer.phone}</p>}
          <p className="mt-1">
            <span className="font-semibold bangla-text">বিন/টিন (BIN/TIN):</span>{" "}
            <span className="font-mono">{customer?.tax_id?.trim() || "—"}</span>
          </p>
        </div>
      </div>

      {/* Line items — Mushak columns */}
      <div className="border-x-2 border-b-2 border-foreground overflow-x-auto">
        <table className="w-full border-collapse text-[10px]">
          <thead>
            <tr className="bg-muted/60 print:bg-gray-100">
              <th className="border border-foreground px-1 py-1.5 w-8 text-center">ক্রম<br />SL</th>
              <th className="border border-foreground px-2 py-1.5 text-left min-w-[120px]">
                পণ্যের বিবরণ<br />Description
              </th>
              <th className="border border-foreground px-1 py-1.5 text-center">পরিমাণ<br />Qty</th>
              <th className="border border-foreground px-1 py-1.5 text-right">একক মূল্য<br />Rate</th>
              <th className="border border-foreground px-1 py-1.5 text-right">মূল্য<br />Value</th>
              <th className="border border-foreground px-1 py-1.5 text-center">ভ্যাট %<br />VAT</th>
              <th className="border border-foreground px-1 py-1.5 text-right">ভ্যাট টাকা<br />VAT Amt</th>
              <th className="border border-foreground px-1 py-1.5 text-right">মোট<br />Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item: any, idx: number) => {
              const unitType = item.products?.unit_type;
              const ppb = Math.max(1, Number(item.products?.pieces_per_box ?? 1));
              const qtyDisplay = formatStockUnit(Number(item.quantity) || 0, ppb, unitType === "box_sft");
              const lineValue = Number(item.total) || 0;
              const lineVat = lineVats[idx] ?? 0;
              const lineTotal = round2(lineValue + lineVat);

              return (
                <tr key={item.id}>
                  <td className="border border-foreground px-1 py-1 text-center">{idx + 1}</td>
                  <td className="border border-foreground px-2 py-1">
                    <span className="font-medium">{item.products?.name}</span>
                    {item.products?.sku && (
                      <span className="block text-muted-foreground text-[9px]">{item.products.sku}</span>
                    )}
                  </td>
                  <td className="border border-foreground px-1 py-1 text-center whitespace-nowrap">
                    {qtyDisplay}
                  </td>
                  <td className="border border-foreground px-1 py-1 text-right">
                    {formatCurrency(item.sale_rate)}
                  </td>
                  <td className="border border-foreground px-1 py-1 text-right">
                    {formatCurrency(lineValue)}
                  </td>
                  <td className="border border-foreground px-1 py-1 text-center">{vatRate}%</td>
                  <td className="border border-foreground px-1 py-1 text-right">
                    {formatCurrency(lineVat)}
                  </td>
                  <td className="border border-foreground px-1 py-1 text-right font-semibold">
                    {formatCurrency(lineTotal)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-0 border-x-2 border-b-2 border-foreground">
        <div className="border-r border-foreground p-3 space-y-2">
          <p className="bangla-text font-semibold text-xs">কথায় / In words:</p>
          <p className="italic text-sm leading-relaxed">{amountInWordsBdt(totalAmount)}</p>
          <p className="text-[10px] text-muted-foreground mt-2 bangla-text leading-relaxed">
            আমি স্বীকার করছি যে উপরোক্ত পণ্য/সেবা প্রাপ্ত হয়েছে এবং প্রদত্ত মূল্য সঠিক।
            <br />
            I acknowledge receipt of the goods/services and confirm the amounts stated above.
          </p>
        </div>
        <div className="p-3">
          <table className="w-full text-xs">
            <tbody>
              <SumRow label="মোট মূল্য / Subtotal" value={formatCurrency(subtotal)} />
              {discountAmount > 0 && (
                <SumRow
                  label="ছাড় / Discount"
                  value={`(${formatCurrency(discountAmount)})`}
                  className="text-destructive"
                />
              )}
              <SumRow label="করযোগ্য মূল্য / Taxable value" value={formatCurrency(taxableAmount)} bold />
              <SumRow label={`ভ্যাট @ ${vatRate}% / VAT`} value={formatCurrency(vatAmount)} />
              {sdAmount > 0 && (
                <SumRow label="আনুষঙ্গিক শুল্ক / SD" value={formatCurrency(sdAmount)} />
              )}
              <tr>
                <td colSpan={2} className="border-t border-foreground pt-1" />
              </tr>
              <SumRow
                label={`সর্বমোট (${CURRENCY_CODE}) / Grand Total`}
                value={formatCurrency(totalAmount)}
                bold
                large
              />
              <SumRow label="প্রদত্ত / Paid" value={formatCurrency(paidAmount)} />
              <SumRow
                label="বকেয়া / Balance Due"
                value={formatCurrency(dueAmount)}
                bold
                className={dueAmount > 0 ? "text-destructive" : "text-green-700"}
              />
            </tbody>
          </table>
        </div>
      </div>

      {/* Signatures */}
      <div className="grid grid-cols-3 gap-4 border-x-2 border-b-2 border-foreground p-4 text-center text-[10px]">
        <div>
          <div className="border-t border-foreground mt-10 pt-1 mx-4">
            <p className="bangla-text font-semibold">প্রস্তুতকারী</p>
            <p>Prepared by</p>
          </div>
        </div>
        <div>
          <div className="border-t border-foreground mt-10 pt-1 mx-4">
            <p className="bangla-text font-semibold">অনুমোদনকারী</p>
            <p>Authorized Signature</p>
          </div>
        </div>
        <div>
          <div className="border-t border-foreground mt-10 pt-1 mx-4">
            <p className="bangla-text font-semibold">ক্রেতার স্বাক্ষর</p>
            <p>Buyer&apos;s Signature</p>
          </div>
        </div>
      </div>

      {/* Footer disclaimer */}
      <div className="px-4 py-2 text-[9px] text-muted-foreground print:text-gray-600 text-center border-x-2 border-b-2 border-foreground">
        <p className="bangla-text">
          এটি মূল্য সংযোজন কর আইন, ১৯৯১ ও বিধিমালা অনুযায়ী প্রস্তুতকৃত কর চালান (মুসক-৬.৩)।
        </p>
        <p>
          This is a VAT tax invoice prepared under the Value Added Tax Act, 1991 (Mushak-6.3).
          · {businessName} · Invoice #{sale.invoice_number}
        </p>
      </div>
    </div>
  );
};

function SumRow({
  label,
  value,
  bold,
  large,
  className,
}: {
  label: string;
  value: string;
  bold?: boolean;
  large?: boolean;
  className?: string;
}) {
  return (
    <tr className={bold ? "font-semibold" : ""}>
      <td className={`py-0.5 pr-2 align-top ${large ? "text-sm" : ""}`}>{label}</td>
      <td className={`py-0.5 text-right whitespace-nowrap ${large ? "text-sm" : ""} ${className ?? ""}`}>
        {value}
      </td>
    </tr>
  );
}

export default VatTaxInvoiceDocument;
