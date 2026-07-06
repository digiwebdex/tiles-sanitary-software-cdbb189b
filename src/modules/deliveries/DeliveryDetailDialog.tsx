import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { deliveryService } from "@/services/deliveryService";
import { useDealerInfo } from "@/hooks/useDealerInfo";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Printer, X, MessageCircle } from "lucide-react";
import SendWhatsAppDialog from "@/components/whatsapp/SendWhatsAppDialog";
import { buildDeliveryUpdateMessage } from "@/services/whatsappService";
import { formatStockUnit } from "@/lib/units";

interface Props {
  deliveryId: string | null;
  dealerId: string;
  onClose: () => void;
}

const DeliveryDetailDialog = ({ deliveryId, dealerId, onClose }: Props) => {
  const { data: dealerInfo } = useDealerInfo();
  const [waOpen, setWaOpen] = useState(false);

  const { data: delivery, isLoading } = useQuery({
    queryKey: ["delivery-detail", deliveryId],
    queryFn: () => deliveryService.getById(deliveryId!, dealerId),
    enabled: !!deliveryId,
  });

  // Get batch breakdowns for delivery items
  const { data: deliveryBatches = [] } = useQuery({
    queryKey: ["delivery-batches", deliveryId],
    queryFn: () => deliveryService.getDeliveryBatches(deliveryId!, dealerId),
    enabled: !!deliveryId,
  });

  // Get delivered qty for the whole sale (for progress)
  const saleId = (delivery as any)?.sale_id;
  const { data: deliveredQtyMap = {} } = useQuery({
    queryKey: ["delivered-qty", saleId],
    queryFn: () => deliveryService.getDeliveredQtyBySale(saleId, dealerId),
    enabled: !!saleId,
  });

  if (!deliveryId) return null;

  const sale = (delivery as any)?.sales;
  const customer = sale?.customers;
  const deliveryItems = (delivery as any)?.delivery_items ?? [];
  const saleItems = sale?.sale_items ?? [];
  const challanNo = (delivery as any)?.challans?.challan_no;
  const deliveryNo = (delivery as any)?.delivery_no;
  const invoiceNo = sale?.invoice_number;
  const project = (delivery as any)?.projects;
  const site = (delivery as any)?.project_sites;
  const address = delivery?.delivery_address || site?.address || customer?.address || "—";
  const phone = delivery?.receiver_phone || customer?.phone;
  const businessName = dealerInfo?.name ?? "Your Business";

  // Use delivery_items if available, fall back to sale_items
  const displayItems = deliveryItems.length > 0 ? deliveryItems : saleItems;
  const isPartialTracking = deliveryItems.length > 0;

  // Group delivery batches by delivery_item_id
  const batchesByItem: Record<string, any[]> = {};
  for (const db of deliveryBatches as any[]) {
    const key = db.delivery_item_id;
    if (!batchesByItem[key]) batchesByItem[key] = [];
    batchesByItem[key].push(db);
  }

  const statusLabel = delivery?.status === "delivered"
    ? "Delivered"
    : delivery?.status === "in_transit"
    ? "In Transit"
    : "Pending";

  return (
    <Dialog open={!!deliveryId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0">
        <div className="flex items-center justify-between px-6 pt-4 pb-2">
          <DialogTitle className="sr-only">Delivery Details</DialogTitle>
          <div />
          <div className="flex items-center gap-2">
            {(phone || customer?.phone) && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1"
                onClick={() => setWaOpen(true)}
                title="Send Delivery Update via WhatsApp"
              >
                <MessageCircle className="h-4 w-4" />
                <span className="hidden sm:inline">WhatsApp</span>
              </Button>
            )}
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => window.print()}>
              <Printer className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {isLoading ? (
          <p className="p-6 text-muted-foreground">Loading…</p>
        ) : !delivery ? (
          <p className="p-6 text-destructive">Delivery not found</p>
        ) : (
          <div className="px-6 pb-6 space-y-5 text-sm">
            {/* Company Header */}
            <div className="flex justify-center">
              <div className="text-center">
                <div className="mx-auto mb-1 h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                  <span className="text-xl font-black text-primary">{businessName.charAt(0)}</span>
                </div>
                <p className="font-bold text-foreground">{businessName}</p>
                <p className="text-xs text-muted-foreground">Tile & Sanitary Dealer</p>
              </div>
            </div>

            <Separator />

            {/* Info Table */}
            <table className="w-full text-sm">
              <tbody>
                <InfoRow label="Date" value={delivery.delivery_date} />
                <InfoRow label="Delivery No" value={deliveryNo || challanNo || `DO${delivery.id.slice(0, 12)}`} />
                <InfoRow label="Sale Reference No" value={invoiceNo || "—"} />
                <InfoRow label="Customer" value={customer?.name ?? delivery.receiver_name ?? "—"} />
                {project && (
                  <InfoRow
                    label="Project"
                    value={
                      <span>
                        <span className="font-medium">{project.project_name}</span>
                        <span className="text-xs text-muted-foreground ml-1 font-mono">({project.project_code})</span>
                      </span>
                    }
                  />
                )}
                {site && (
                  <InfoRow
                    label="Site"
                    value={
                      <div>
                        <p className="font-medium">{site.site_name}</p>
                        {site.address && <p className="text-xs text-muted-foreground">{site.address}</p>}
                        {(site.contact_person || site.contact_phone) && (
                          <p className="text-xs text-muted-foreground">
                            {site.contact_person}{site.contact_person && site.contact_phone ? " · " : ""}{site.contact_phone}
                          </p>
                        )}
                      </div>
                    }
                  />
                )}
                <InfoRow
                  label="Address"
                  value={
                    <div>
                      <p>{address}</p>
                      {phone && <p>Tel: {phone}</p>}
                    </div>
                  }
                />
                <InfoRow
                  label="Status"
                  value={
                    <Badge
                      className={
                        delivery.status === "delivered"
                          ? "bg-green-600 text-white text-xs"
                          : delivery.status === "in_transit"
                          ? "border-blue-500 text-blue-600 text-xs"
                          : "text-xs"
                      }
                      variant={delivery.status === "delivered" ? "default" : "outline"}
                    >
                      {statusLabel}
                    </Badge>
                  }
                />
              </tbody>
            </table>

            <Separator />

            {/* Items with Batch Breakdown */}
            <div>
              <p className="font-semibold text-foreground mb-2">
                {isPartialTracking ? "Delivery Items" : "Items"}
              </p>
              {displayItems.length === 0 ? (
                <p className="text-muted-foreground text-xs">No items linked to this delivery.</p>
              ) : (
                <div className="space-y-2">
                  {displayItems.map((item: any, idx: number) => {
                    const product = item.products;
                    const isBox = product?.unit_type === "box_sft";
                    const ppb = Number(product?.pieces_per_box) || 1;
                    const qty = Number(item.quantity);
                    const boxPcs = formatStockUnit(qty, ppb, isBox);
                    const itemBatches = batchesByItem[item.id] ?? [];

                    return (
                      <div key={item.id} className="rounded-md border p-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="text-xs text-muted-foreground mr-2">#{idx + 1}</span>
                            <span className="font-medium">{product?.name}</span>
                            {product?.sku && (
                              <span className="text-xs text-muted-foreground ml-1">({product.sku})</span>
                            )}
                          </div>
                          <span className="font-bold">{boxPcs}</span>
                        </div>
                        {/* Batch breakdown */}
                        {itemBatches.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {itemBatches.map((db: any, bi: number) => {
                              const pb = db.product_batches;
                              return (
                                <span key={bi} className="inline-flex items-center gap-1 text-[10px] bg-primary/5 border border-primary/20 text-foreground px-2 py-0.5 rounded-full">
                                  <span className="font-mono font-semibold">{pb?.batch_no ?? "—"}</span>
                                  {pb?.shade_code && <span className="text-muted-foreground">S:{pb.shade_code}</span>}
                                  {pb?.caliber && <span className="text-muted-foreground">C:{pb.caliber}</span>}
                                  <span className="font-bold">×{Number(db.delivered_qty)}</span>
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Delivery Progress Section */}
            {saleItems.length > 0 && (
              <>
                <Separator />
                <div>
                  <p className="font-semibold text-foreground mb-2">Delivery Progress</p>
                  <div className="space-y-2">
                    {saleItems.map((si: any) => {
                      const product = si.products;
                      const isBox = product?.unit_type === "box_sft";
                      const ppb = Number(product?.pieces_per_box) || 1;
                      const ordered = Number(si.quantity);
                      const delivered = deliveredQtyMap[si.id] || 0;
                      const remaining = Math.max(0, ordered - delivered);
                      const progress = ordered > 0 ? (delivered / ordered) * 100 : 0;

                      return (
                        <div key={si.id} className="rounded-md border p-3 space-y-1">
                          <div className="flex items-center justify-between text-sm">
                            <span className="font-medium">{product?.name}</span>
                            <span className="text-muted-foreground">
                              {formatStockUnit(delivered, ppb, isBox)} / {formatStockUnit(ordered, ppb, isBox)}
                            </span>
                          </div>
                          <Progress value={Math.min(progress, 100)} className="h-2" />
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>Delivered: {formatStockUnit(delivered, ppb, isBox)}</span>
                            <span className={remaining > 0 ? "text-orange-600 font-medium" : "text-green-600 font-medium"}>
                              {remaining > 0 ? `Remaining: ${formatStockUnit(remaining, ppb, isBox)}` : "Complete ✓"}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}

            <Separator />

            {/* Footer signatures */}
            <div className="grid grid-cols-3 gap-4 text-xs text-muted-foreground pt-2">
              <div>
                <p className="font-medium text-foreground">Prepared by:</p>
                <p>{delivery.created_by ?? "—"}</p>
              </div>
              <div>
                <p className="font-medium text-foreground">Delivered by:</p>
                <p>{delivery.receiver_name ?? "—"}</p>
              </div>
              <div>
                <p className="font-medium text-foreground">Confirmed:</p>
                <p>
                  {delivery.confirmed_at
                    ? new Date(delivery.confirmed_at).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
                    : "—"}
                </p>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
      {delivery && (phone || customer?.phone) && (
        <SendWhatsAppDialog
          open={waOpen}
          onOpenChange={setWaOpen}
          dealerId={dealerId}
          messageType="delivery_update"
          sourceType="delivery"
          sourceId={delivery.id}
          templateKey="delivery_update"
          defaultPhone={(phone || customer?.phone) ?? ""}
          defaultName={customer?.name ?? delivery.receiver_name ?? null}
          defaultMessage={buildDeliveryUpdateMessage({
            dealerName: dealerInfo?.name ?? "Your Business",
            customerName: customer?.name ?? delivery.receiver_name ?? null,
            deliveryNo: deliveryNo || challanNo || `DO${delivery.id.slice(0, 8)}`,
            status: statusLabel,
            itemCount: displayItems.length,
            deliveryDate: delivery.delivery_date,
            invoiceNo: invoiceNo ?? null,
            receiverName: delivery.receiver_name ?? null,
          })}
          title="Send Delivery Update via WhatsApp"
        />
      )}
    </Dialog>
  );
};

const InfoRow = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <tr className="border-b last:border-0">
    <td className="py-2 pr-4 font-medium text-muted-foreground w-44">{label}</td>
    <td className="py-2 text-foreground">{value}</td>
  </tr>
);

export default DeliveryDetailDialog;
