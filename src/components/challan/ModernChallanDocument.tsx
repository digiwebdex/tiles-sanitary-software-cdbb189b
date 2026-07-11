import { Separator } from "@/components/ui/separator";
import { formatCurrency } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

interface EditDataType {
  challan_date: string;
  driver_name: string;
  driver_phone: string;
  transport_name: string;
  vehicle_no: string;
  scheduled_delivery_date: string;
  notes: string;
}

interface EditItemType {
  id: string;
  product_id: string;
  quantity: number;
  sale_rate: number;
  product_name: string;
  product_sku: string;
  unit_type: string;
  per_box_sft: number;
}

interface BatchBreakdown {
  batch_no: string;
  shade_code: string | null;
  caliber: string | null;
  lot_no: string | null;
  qty: number;
}

interface ModernChallanDocumentProps {
  sale: any;
  items: any[];
  customer: any;
  challan: any;
  showPrices: boolean;
  dealerInfo?: { name: string; phone: string | null; address: string | null } | null;
  isEditing?: boolean;
  editData?: EditDataType;
  onEditChange?: (data: EditDataType) => void;
  editItems?: EditItemType[];
  onEditItemChange?: (items: EditItemType[]) => void;
  /** Batch breakdown per sale_item_id for print display */
  batchBreakdowns?: Record<string, BatchBreakdown[]>;
}

const ModernChallanDocument = ({ sale, items, customer, challan, showPrices, dealerInfo, isEditing, editData, onEditChange, editItems, onEditItemChange, batchBreakdowns }: ModernChallanDocumentProps) => {
  const challanDate = isEditing && editData ? editData.challan_date : (challan ? (challan as any).challan_date : sale.sale_date);
  const challanNo = challan ? (challan as any).challan_no : "—";
  const status = challan ? (challan as any).status : null;

  const handleItemChange = (idx: number, field: "quantity" | "sale_rate", value: number) => {
    if (!editItems || !onEditItemChange) return;
    const updated = [...editItems];
    updated[idx] = { ...updated[idx], [field]: value };
    onEditItemChange(updated);
  };

  const getItemSft = (item: EditItemType) => {
    if (item.unit_type === "box_sft") return (item.quantity * item.per_box_sft).toFixed(2);
    return "—";
  };

  const getItemTotal = (item: EditItemType) => {
    if (item.unit_type === "box_sft") return item.quantity * item.per_box_sft * item.sale_rate;
    return item.quantity * item.sale_rate;
  };

  const editTotalBox = editItems?.reduce((s, i) => s + (i.unit_type === "box_sft" ? i.quantity : 0), 0) ?? 0;
  const editTotalSft = editItems?.reduce((s, i) => s + (i.unit_type === "box_sft" ? i.quantity * i.per_box_sft : 0), 0) ?? 0;
  const editTotalPiece = editItems?.reduce((s, i) => s + (i.unit_type === "piece" ? i.quantity : 0), 0) ?? 0;
  const editTotalAmount = editItems?.reduce((s, i) => s + getItemTotal(i), 0) ?? 0;

  return (
    <div className="p-8 sm:p-10 font-sans text-[13px] leading-relaxed text-foreground print:p-6">

      {/* ═══ MODERN HEADER ═══ */}
      <div className="challan-header relative mb-6">
        <div className="h-2 bg-gradient-to-r from-primary via-primary/70 to-primary/30 rounded-t-md" />
        <div className="border border-t-0 border-border rounded-b-md px-6 py-5">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground">
                {dealerInfo?.name ?? "Your Business Name"}
              </h1>
              <p className="text-[11px] text-muted-foreground mt-0.5">Tile & Sanitary Dealer</p>
              <div className="flex flex-wrap gap-3 mt-2 text-[11px] text-muted-foreground">
                {dealerInfo?.phone && <span>📞 {dealerInfo.phone}</span>}
                {dealerInfo?.address && <span>📍 {dealerInfo.address}</span>}
              </div>
            </div>
            <div className="text-right space-y-1">
              <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider">
                Delivery Challan
              </div>
              <p className="font-mono font-bold text-lg text-foreground">{challanNo}</p>
              {isEditing && editData && onEditChange ? (
                <div className="text-[11px] text-muted-foreground"><span className="mr-1">Date:</span><input type="date" value={editData.challan_date} onChange={(e) => onEditChange({ ...editData, challan_date: e.target.value })} className="bg-transparent border-b border-muted-foreground/30 text-foreground text-[11px] outline-none" /></div>
              ) : (
                <p className="text-[11px] text-muted-foreground">Date: {challanDate}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ═══ STATUS + REF PILLS ═══ */}
      <div className="flex flex-wrap gap-2 mb-5">
        {sale.invoice_number && (
          <span className="text-[10px] bg-muted text-muted-foreground px-2.5 py-1 rounded-full font-medium">Invoice: {sale.invoice_number}</span>
        )}
        {sale.client_reference && (
          <span className="text-[10px] bg-muted text-muted-foreground px-2.5 py-1 rounded-full font-medium">Client: {sale.client_reference}</span>
        )}
        {sale.fitter_reference && (
          <span className="text-[10px] bg-muted text-muted-foreground px-2.5 py-1 rounded-full font-medium">Fitter: {sale.fitter_reference}</span>
        )}
        {status && (
          <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold uppercase ${
            status === "delivered" ? "bg-green-100 text-green-800" :
            status === "cancelled" ? "bg-destructive/10 text-destructive" :
            "bg-blue-100 text-blue-800"
          }`}>{status}</span>
        )}
      </div>

      {/* ═══ CUSTOMER & TRANSPORT ═══ */}
      <div className="challan-section grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6 print:mb-5">
        <div className="rounded-lg border border-border bg-muted/20 p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1 h-4 bg-primary rounded-full" />
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Deliver To</p>
          </div>
          <p className="font-bold text-[15px] text-foreground">{customer?.name ?? "—"}</p>
          {customer?.type && (
            <span className="inline-block mt-1.5 text-[9px] uppercase tracking-wider bg-primary/10 text-primary px-2 py-0.5 rounded-full font-semibold">{customer.type}</span>
          )}
          {customer?.phone && <p className="text-[11px] text-muted-foreground mt-2">📞 {customer.phone}</p>}
          {/* Site address overrides customer address when provided */}
          {(challan as any)?.project_sites?.address ? (
            <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">📍 {(challan as any).project_sites.address}</p>
          ) : customer?.address ? (
            <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">{customer.address}</p>
          ) : null}
          {/* Project / Site block */}
          {((challan as any)?.projects || (challan as any)?.project_sites) && (
            <div className="mt-3 pt-2 border-t border-border space-y-0.5">
              {(challan as any)?.projects && (
                <p className="text-[11px] text-foreground">
                  <span className="text-muted-foreground">Project:</span>{" "}
                  <span className="font-semibold">{(challan as any).projects.project_name}</span>
                  <span className="text-muted-foreground font-mono ml-1">({(challan as any).projects.project_code})</span>
                </p>
              )}
              {(challan as any)?.project_sites && (
                <p className="text-[11px] text-foreground">
                  <span className="text-muted-foreground">Site:</span>{" "}
                  <span className="font-semibold">{(challan as any).project_sites.site_name}</span>
                  {(challan as any).project_sites.contact_person && (
                    <span className="text-muted-foreground"> · {(challan as any).project_sites.contact_person}</span>
                  )}
                  {(challan as any).project_sites.contact_phone && (
                    <span className="text-muted-foreground"> · {(challan as any).project_sites.contact_phone}</span>
                  )}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border bg-muted/20 p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1 h-4 bg-primary rounded-full" />
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Transport Details</p>
          </div>
          {challan ? (
            isEditing && editData && onEditChange ? (
              <div className="space-y-2 text-[12px]">
                {([
                  { label: "Driver", field: "driver_name" as const },
                  { label: "Driver Phone", field: "driver_phone" as const },
                  { label: "Transport", field: "transport_name" as const },
                  { label: "Vehicle", field: "vehicle_no" as const },
                ] as const).map((t) => (
                  <div key={t.label} className="flex items-baseline gap-2">
                    <span className="text-muted-foreground w-[70px] shrink-0 text-[11px]">{t.label}:</span>
                    <input
                      value={editData[t.field]}
                      onChange={(e) => onEditChange({ ...editData, [t.field]: e.target.value })}
                      className="flex-1 border border-border rounded px-2 py-1 text-[12px] bg-background text-foreground outline-none focus:ring-1 focus:ring-primary"
                      placeholder={t.label}
                    />
                  </div>
                ))}
                <div className="flex items-baseline gap-2">
                  <span className="text-muted-foreground w-[70px] shrink-0 text-[11px]">Scheduled:</span>
                  <input
                    type="date"
                    value={editData.scheduled_delivery_date}
                    onChange={(e) => onEditChange({ ...editData, scheduled_delivery_date: e.target.value })}
                    className="flex-1 border border-border rounded px-2 py-1 text-[12px] bg-background text-foreground outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-2 text-[12px]">
                {[
                  { label: "Driver", value: (challan as any).driver_name },
                  { label: "Driver Phone", value: (challan as any).driver_phone },
                  { label: "Transport", value: (challan as any).transport_name },
                  { label: "Vehicle", value: (challan as any).vehicle_no },
                  { label: "Scheduled", value: (challan as any).scheduled_delivery_date },
                ].filter((t) => t.label !== "Driver Phone" && t.label !== "Scheduled" ? true : !!t.value).map((t) => (
                  <div key={t.label} className="flex items-baseline gap-2">
                    <span className="text-muted-foreground w-[70px] shrink-0 text-[11px]">{t.label}:</span>
                    <span className="font-medium text-foreground">{t.value || "—"}</span>
                  </div>
                ))}
              </div>
            )
          ) : (
            <p className="text-[11px] text-muted-foreground italic">No challan created yet</p>
          )}
        </div>
      </div>

      {/* ═══ ITEMS TABLE ═══ */}
      <div className="mb-6 print:mb-5 rounded-lg border border-border overflow-hidden">
        <table className="w-full text-[12px] border-collapse">
          <thead>
            <tr className="bg-primary text-primary-foreground">
              <th className="px-3 py-2.5 text-left font-semibold w-8">#</th>
              <th className="px-3 py-2.5 text-left font-semibold">Item Description</th>
              <th className="px-3 py-2.5 text-center font-semibold w-16">Qty</th>
              <th className="px-3 py-2.5 text-center font-semibold w-14">Unit</th>
              <th className="px-3 py-2.5 text-center font-semibold w-20">SFT</th>
              {showPrices && <th className="px-3 py-2.5 text-right font-semibold w-24">Rate</th>}
              {showPrices && <th className="px-3 py-2.5 text-right font-semibold w-28">Amount</th>}
            </tr>
          </thead>
          <tbody>
            {isEditing && editItems ? (
              editItems.map((item, idx) => (
                <tr key={item.id} className={`border-b border-border last:border-0 ${idx % 2 === 0 ? "bg-background" : "bg-muted/30"}`}>
                  <td className="px-3 py-2.5 text-muted-foreground text-center">{idx + 1}</td>
                  <td className="px-3 py-2.5">
                    <p className="font-semibold text-foreground leading-tight">{item.product_name}</p>
                    <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{item.product_sku}</p>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <input type="number" min={0.01} step="any" value={item.quantity} onChange={(e) => handleItemChange(idx, "quantity", Number(e.target.value))} className="w-14 text-center border border-border rounded px-1 py-0.5 text-[12px] bg-background text-foreground outline-none focus:ring-1 focus:ring-primary" />
                  </td>
                  <td className="px-3 py-2.5 text-center text-muted-foreground text-[11px]">{item.unit_type === "box_sft" ? "Box" : "Pc"}</td>
                  <td className="px-3 py-2.5 text-center text-foreground">{getItemSft(item)}</td>
                  {showPrices && (
                    <td className="px-3 py-2.5 text-right">
                      <input type="number" min={0} step="any" value={item.sale_rate} onChange={(e) => handleItemChange(idx, "sale_rate", Number(e.target.value))} className="w-20 text-right border border-border rounded px-1 py-0.5 text-[12px] bg-background text-foreground outline-none focus:ring-1 focus:ring-primary" />
                    </td>
                  )}
                  {showPrices && (
                    <td className="px-3 py-2.5 text-right font-bold text-foreground">{formatCurrency(getItemTotal(item))}</td>
                  )}
                </tr>
              ))
            ) : (
              items.map((item: any, idx: number) => {
                const itemBatches = batchBreakdowns?.[item.id] ?? [];
                return (
                  <>
                    <tr key={item.id} className={`border-b border-border last:border-0 ${idx % 2 === 0 ? "bg-background" : "bg-muted/30"}`}>
                      <td className="px-3 py-2.5 text-muted-foreground text-center">{idx + 1}</td>
                      <td className="px-3 py-2.5">
                        <p className="font-semibold text-foreground leading-tight">{item.products?.name}</p>
                        <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{item.products?.sku}</p>
                      </td>
                      <td className="px-3 py-2.5 text-center font-bold text-foreground">
                        {item.products?.unit_type === "box_sft" && (item.box_qty != null || item.piece_qty != null) ? (
                          <span>
                            {Number(item.box_qty) || 0}
                            <span className="text-[10px] font-normal text-muted-foreground"> box</span>
                            {Number(item.piece_qty) > 0 && (
                              <>
                                {" "}
                                {Number(item.piece_qty)}
                                <span className="text-[10px] font-normal text-muted-foreground"> pc</span>
                              </>
                            )}
                          </span>
                        ) : (
                          item.quantity
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center text-muted-foreground text-[11px]">{item.products?.unit_type === "box_sft" ? "Box+Pc" : "Pc"}</td>
                      <td className="px-3 py-2.5 text-center text-foreground">{item.total_sft ? Number(item.total_sft).toFixed(2) : "—"}</td>
                      {showPrices && (
                        <td className="px-3 py-2.5 text-right text-foreground">{formatCurrency(item.sale_rate)}</td>
                      )}
                      {showPrices && (
                        <td className="px-3 py-2.5 text-right font-bold text-foreground">{formatCurrency(item.total)}</td>
                      )}
                    </tr>
                    {/* Batch breakdown sub-rows */}
                    {itemBatches.length > 0 && (
                      <tr key={`${item.id}-batches`} className="bg-muted/10">
                        <td></td>
                        <td colSpan={showPrices ? 6 : 4} className="px-3 py-1.5">
                          <div className="flex flex-wrap gap-2 text-[10px]">
                            {itemBatches.map((b, bi) => (
                              <span key={bi} className="inline-flex items-center gap-1 bg-primary/5 border border-primary/20 text-foreground px-2 py-0.5 rounded-full">
                                <span className="font-mono font-semibold">{b.batch_no}</span>
                                {b.shade_code && <span className="text-muted-foreground">S:{b.shade_code}</span>}
                                {b.caliber && <span className="text-muted-foreground">C:{b.caliber}</span>}
                                <span className="font-bold">×{b.qty}</span>
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ═══ QUANTITY SUMMARY ═══ */}
      <div className="challan-section grid grid-cols-3 gap-3 mb-6 print:mb-5">
        {[
          { label: "Total Boxes", value: isEditing ? editTotalBox : Number(sale.total_box), color: "bg-blue-50 border-blue-200 text-blue-900" },
          { label: "Total SFT", value: isEditing ? editTotalSft.toFixed(2) : Number(sale.total_sft).toFixed(2), color: "bg-green-50 border-green-200 text-green-900" },
          { label: "Total Pieces", value: isEditing ? editTotalPiece : Number(sale.total_piece), color: "bg-amber-50 border-amber-200 text-amber-900" },
        ].map((s) => (
          <div key={s.label} className={`rounded-lg border px-3 py-3 text-center ${s.color}`}>
            <p className="text-[9px] uppercase tracking-[0.15em] font-bold opacity-70">{s.label}</p>
            <p className="text-xl font-black mt-0.5">{s.value}</p>
          </div>
        ))}
      </div>
      {showPrices && (
        <div className="mb-6 print:mb-5 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-center">
          <p className="text-[9px] uppercase tracking-[0.15em] font-bold text-primary/70">Total Amount</p>
          <p className="text-2xl font-black text-primary mt-0.5">{formatCurrency(isEditing ? editTotalAmount - Number(sale.discount) : sale.total_amount)}</p>
        </div>
      )}

      {/* ═══ NOTES ═══ */}
      {isEditing && editData && onEditChange ? (
        <div className="rounded-lg border border-border bg-muted/20 p-4 mb-5 print:mb-4">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-1 h-3 bg-primary rounded-full" />
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Notes</p>
          </div>
          <textarea
            value={editData.notes}
            onChange={(e) => onEditChange({ ...editData, notes: e.target.value })}
            className="w-full border border-border rounded px-2 py-1 text-[11px] bg-background text-foreground outline-none focus:ring-1 focus:ring-primary min-h-[60px] ml-3"
            placeholder="Add notes..."
          />
        </div>
      ) : challan && (challan as any).notes ? (
        <div className="rounded-lg border border-border bg-muted/20 p-4 mb-5 print:mb-4">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-1 h-3 bg-primary rounded-full" />
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Notes</p>
          </div>
          <p className="text-[11px] text-foreground ml-3">{(challan as any).notes}</p>
        </div>
      ) : null}

      {/* ═══ TERMS ═══ */}
      <div className="rounded-lg border border-border p-4 mb-8 print:mb-6 bg-muted/10">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-1 h-3 bg-muted-foreground/30 rounded-full" />
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Terms & Conditions</p>
        </div>
        <ol className="text-[10px] text-muted-foreground list-decimal list-inside space-y-0.5 ml-3">
          <li>Goods once delivered will not be taken back without prior written approval.</li>
          <li>Please check the goods thoroughly at the time of delivery.</li>
          <li>This is a delivery challan only — not a tax invoice.</li>
          <li>Any discrepancy must be reported within 24 hours of delivery.</li>
        </ol>
      </div>

      {/* ═══ SIGNATURES ═══ */}
      <div className="challan-signature grid grid-cols-3 gap-8 mt-8 mb-4">
        {["Prepared By", "Receiver's Signature", "Authorized Signatory"].map((label) => (
          <div key={label} className="text-center">
            <div className="h-16 border-b-2 border-dashed border-muted-foreground/30" />
            <p className="text-[10px] text-muted-foreground font-semibold mt-2">{label}</p>
          </div>
        ))}
      </div>

      {/* ═══ FOOTER ═══ */}
      <div className="challan-footer mt-6">
        <div className="h-1 bg-gradient-to-r from-primary via-primary/70 to-primary/30 rounded-full mb-2" />
        <div className="flex justify-between text-[9px] text-muted-foreground">
          <span>This document is a delivery challan and does not serve as a tax invoice.</span>
          <span className="font-mono">{challanNo} · {challanDate}</span>
        </div>
      </div>
    </div>
  );
};

export default ModernChallanDocument;
