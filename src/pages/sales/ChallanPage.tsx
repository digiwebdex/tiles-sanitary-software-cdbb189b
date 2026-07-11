import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { challanService } from "@/services/challanService";
import { salesService } from "@/services/salesService";
import { useDealerId } from "@/hooks/useDealerId";
import { useDealerInfo } from "@/hooks/useDealerInfo";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Printer, Truck, FileCheck, X, Layout, Eye, EyeOff, Pencil, PackageCheck, Send } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import { useState, useEffect } from "react";
import ModernChallanDocument from "@/components/challan/ModernChallanDocument";


const ChallanPage = () => {
  const { id: challanId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const dealerId = useDealerId();
  const queryClient = useQueryClient();
  const { isDealerAdmin } = useAuth();
  const [showPrices, setShowPrices] = useState(false);
  const [template, setTemplate] = useState<string>("classic");
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({ challan_date: "", driver_name: "", driver_phone: "", transport_name: "", vehicle_no: "", scheduled_delivery_date: "", notes: "" });
  const [editItems, setEditItems] = useState<{ id: string; product_id: string; quantity: number; sale_rate: number; product_name: string; product_sku: string; unit_type: string; per_box_sft: number }[]>([]);
  const { data: dealerInfo } = useDealerInfo();

  // Sync template from dealer settings
  useEffect(() => {
    if (dealerInfo?.challan_template) {
      setTemplate(dealerInfo.challan_template);
    }
  }, [dealerInfo?.challan_template]);

  // Fetch challan by ID
  const { data: challanData, isLoading: challanLoading } = useQuery({
    queryKey: ["challan", challanId],
    queryFn: () => challanService.getById(challanId!),
    enabled: !!challanId,
  });

  const saleId = (challanData as any)?.sale_id;

  const { data: sale, isLoading: saleLoading } = useQuery({
    queryKey: ["sale", saleId],
    queryFn: () => salesService.getById(saleId!),
    enabled: !!saleId,
  });

  // Wrap single challan into array for compatibility
  const challans = challanData ? [challanData] : [];

  // Sync showPrices from saved challan show_price
  useEffect(() => {
    const active = (challans ?? []).find((c: any) => c.status !== "cancelled");
    if (active) {
      setShowPrices(!!(active as any).show_price);
    }
  }, [challans]);

  // Persist show_price toggle to DB (dealer_admin only)
  const handleShowPriceToggle = async (checked: boolean) => {
    setShowPrices(checked);
    const active = (challans ?? []).find((c: any) => c.status !== "cancelled");
    if (active) {
      await supabase
        .from("challans")
        .update({ show_price: checked } as any)
        .eq("id", active.id);
      queryClient.invalidateQueries({ queryKey: ["challan", challanId] });
    }
  };

  const createChallanMutation = useMutation({
    mutationFn: () =>
      challanService.create({
        dealer_id: dealerId,
        sale_id: saleId!,
        challan_date: new Date().toISOString().split("T")[0],
        show_price: showPrices,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["challan", challanId] });
      queryClient.invalidateQueries({ queryKey: ["sale", saleId] });
      queryClient.invalidateQueries({ queryKey: ["stock"] });
      toast.success("Challan created & stock reserved");
    },
    onError: (e) => toast.error(e.message),
  });

  const deliverMutation = useMutation({
    mutationFn: (challanId: string) => challanService.markDelivered(challanId, dealerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["challan", challanId] });
      queryClient.invalidateQueries({ queryKey: ["sale", saleId] });
      toast.success("Challan marked as delivered");
    },
    onError: (e) => toast.error(e.message),
  });

  const deliveryStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      challanService.updateDeliveryStatus(id, dealerId, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["challan", challanId] });
      queryClient.invalidateQueries({ queryKey: ["sale", saleId] });
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      toast.success("Delivery status updated");
    },
    onError: (e) => toast.error(e.message),
  });

  const convertMutation = useMutation({
    mutationFn: () => challanService.convertToInvoice(saleId!, dealerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["sale", saleId] });
      queryClient.invalidateQueries({ queryKey: ["stock"] });
      toast.success("Converted to invoice successfully");
      navigate(`/sales/${saleId}/invoice`);
    },
    onError: (e) => toast.error(e.message),
  });

  const cancelMutation = useMutation({
    mutationFn: (challanId: string) => challanService.cancelChallan(challanId, dealerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["challan", challanId] });
      queryClient.invalidateQueries({ queryKey: ["sale", saleId] });
      queryClient.invalidateQueries({ queryKey: ["stock"] });
      toast.success("Challan cancelled & stock restored");
    },
    onError: (e) => toast.error(e.message),
  });

  const updateChallanMutation = useMutation({
    mutationFn: (params: { editData: typeof editData; editItems: typeof editItems }) =>
      challanService.update(challans.find((c: any) => c.status !== "cancelled")?.id ?? "", dealerId, {
        ...params.editData,
        items: params.editItems.map(i => ({ id: i.id, product_id: i.product_id, quantity: i.quantity, sale_rate: i.sale_rate })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["challan", challanId] });
      queryClient.invalidateQueries({ queryKey: ["sale", saleId] });
      queryClient.invalidateQueries({ queryKey: ["stock"] });
      setIsEditing(false);
      toast.success("Challan updated successfully");
    },
    onError: (e) => toast.error(e.message),
  });

  const startEditing = () => {
    const ac = challans.find((c: any) => c.status !== "cancelled");
    if (ac) {
      setEditData({
        challan_date: (ac as any).challan_date ?? "",
        driver_name: (ac as any).driver_name ?? "",
        driver_phone: (ac as any).driver_phone ?? "",
        transport_name: (ac as any).transport_name ?? "",
        vehicle_no: (ac as any).vehicle_no ?? "",
        scheduled_delivery_date: (ac as any).scheduled_delivery_date ?? "",
        notes: (ac as any).notes ?? "",
      });
      // Initialize editable items from sale items
      const saleItems = (sale as any)?.sale_items ?? [];
      setEditItems(saleItems.map((item: any) => ({
        id: item.id,
        product_id: item.product_id,
        quantity: Number(item.quantity),
        sale_rate: Number(item.sale_rate),
        product_name: item.products?.name ?? "",
        product_sku: item.products?.sku ?? "",
        unit_type: item.products?.unit_type ?? "piece",
        per_box_sft: Number(item.products?.per_box_sft ?? 0),
      })));
      setIsEditing(true);
    }
  };

  const handlePrint = () => window.print();

  if (saleLoading || challanLoading) return <p className="p-6 text-muted-foreground">Loading…</p>;
  if (!sale) return <p className="p-6 text-destructive">Sale not found</p>;

  const items = (sale as any).sale_items ?? [];
  const customer = (sale as any).customers;
  const saleStatus = (sale as any).sale_status;
  const activeChallan = challans.find((c: any) => c.status !== "cancelled");
  const deliveryStatus = (activeChallan as any)?.delivery_status ?? "pending";

  const deliveryStatusColor: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800 border-yellow-300",
    dispatched: "bg-blue-100 text-blue-800 border-blue-300",
    delivered: "bg-green-100 text-green-800 border-green-300",
    cancelled: "bg-red-100 text-red-800 border-red-300",
  };

  const statusColor: Record<string, string> = {
    draft: "bg-yellow-100 text-yellow-800 border-yellow-300",
    challan_created: "bg-blue-100 text-blue-800 border-blue-300",
    delivered: "bg-green-100 text-green-800 border-green-300",
    invoiced: "bg-primary/10 text-primary border-primary/30",
  };

  return (
    <>
      <style>{`
        @media print {
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            width: 210mm !important;
            min-height: 297mm !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          body * { visibility: hidden !important; }
          #challan-print-area, #challan-print-area * { visibility: visible !important; }
          #challan-print-area {
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            width: 100% !important;
            padding: 0 !important;
            margin: 0 !important;
            font-size: 12px !important;
          }
          .no-print { display: none !important; }
          @page {
            size: A4 portrait;
            margin: 15mm 15mm 20mm 15mm;
          }
          /* Page break control */
          table { page-break-inside: auto; }
          thead { display: table-header-group; }
          tr { page-break-inside: avoid; page-break-after: auto; }
          .challan-signature { page-break-inside: avoid; break-inside: avoid; }
          .challan-section { page-break-inside: avoid; break-inside: avoid; }
          .challan-header { page-break-after: avoid; break-after: avoid; }
          .challan-footer { page-break-before: avoid; break-before: avoid; }
          /* Orphan/widow control */
          p, li { orphans: 3; widows: 3; }
        }
      `}</style>

      {/* Toolbar */}
      <div className="no-print flex flex-wrap items-center justify-between gap-3 border-b bg-card px-6 py-3 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/challans")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <span className="font-semibold text-foreground text-lg">Challan</span>
          <Badge className={statusColor[saleStatus] ?? ""}>
            {saleStatus?.replace(/_/g, " ").toUpperCase()}
          </Badge>
          {/* Price visibility badge */}
          {activeChallan && (
            <Badge variant="outline" className={showPrices
              ? "bg-green-100 text-green-800 border-green-300"
              : "bg-amber-100 text-amber-800 border-amber-300"
            }>
              {showPrices ? <><Eye className="h-3 w-3 mr-1" /> Price Visible</> : <><EyeOff className="h-3 w-3 mr-1" /> Price Hidden</>}
            </Badge>
          )}
          {/* Delivery status badge */}
          {activeChallan && (
            <Badge variant="outline" className={deliveryStatusColor[deliveryStatus] ?? ""}>
              <Truck className="h-3 w-3 mr-1" />
              {deliveryStatus.charAt(0).toUpperCase() + deliveryStatus.slice(1)}
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Template selector */}
          <div className="flex items-center gap-1.5">
            <Layout className="h-4 w-4 text-muted-foreground" />
            <Select value={template} onValueChange={setTemplate}>
              <SelectTrigger className="h-8 w-[120px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="classic">Classic</SelectItem>
                <SelectItem value="modern">Modern</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Separator orientation="vertical" className="h-6 hidden sm:block" />

          {/* Show Prices toggle — dealer_admin only */}
          {isDealerAdmin && (
            <div className="flex items-center gap-2">
              <Switch checked={showPrices} onCheckedChange={handleShowPriceToggle} id="show-prices" />
              <label htmlFor="show-prices" className="text-sm text-muted-foreground cursor-pointer select-none">
                Show Prices
              </label>
            </div>
          )}

          <Separator orientation="vertical" className="h-6 hidden sm:block" />

          {saleStatus === "draft" && (
            <Button onClick={() => createChallanMutation.mutate()} disabled={createChallanMutation.isPending} size="sm">
              <Truck className="mr-1.5 h-4 w-4" /> Create Challan
            </Button>
          )}
          {activeChallan && (activeChallan as any).status === "pending" && !isEditing && (
            <>
              <Button variant="outline" size="sm" onClick={startEditing}>
                <Pencil className="mr-1.5 h-4 w-4" /> Edit
              </Button>
              {deliveryStatus === "pending" && (
                <Button variant="outline" size="sm" onClick={() => deliveryStatusMutation.mutate({ id: activeChallan.id, status: "dispatched" })} disabled={deliveryStatusMutation.isPending}>
                  <Send className="mr-1.5 h-4 w-4" /> Mark Dispatched
                </Button>
              )}
              {(deliveryStatus === "pending" || deliveryStatus === "dispatched") && (
                <Button variant="outline" size="sm" onClick={() => deliveryStatusMutation.mutate({ id: activeChallan.id, status: "delivered" })} disabled={deliveryStatusMutation.isPending}>
                  <PackageCheck className="mr-1.5 h-4 w-4" /> Mark Delivered
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => deliverMutation.mutate(activeChallan.id)} disabled={deliverMutation.isPending}>
                <Truck className="mr-1.5 h-4 w-4" /> Mark Delivered (Legacy)
              </Button>
              {deliveryStatus !== "delivered" && (
                <Button variant="destructive" size="sm" onClick={() => cancelMutation.mutate(activeChallan.id)} disabled={cancelMutation.isPending}>
                  <X className="mr-1.5 h-4 w-4" /> Cancel
                </Button>
              )}
            </>
          )}
          {activeChallan && (activeChallan as any).status === "delivered" && !isEditing && (
            <>
              <Button variant="outline" size="sm" onClick={startEditing}>
                <Pencil className="mr-1.5 h-4 w-4" /> Edit
              </Button>
              {deliveryStatus !== "delivered" && (
                <Button variant="destructive" size="sm" onClick={() => cancelMutation.mutate(activeChallan.id)} disabled={cancelMutation.isPending}>
                  <X className="mr-1.5 h-4 w-4" /> Cancel
                </Button>
              )}
            </>
          )}
          {isEditing && (
            <>
              <Button size="sm" onClick={() => updateChallanMutation.mutate({ editData, editItems })} disabled={updateChallanMutation.isPending}>
                {updateChallanMutation.isPending ? "Saving…" : "Save Changes"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setIsEditing(false)}>
                Cancel Edit
              </Button>
            </>
          )}
          {(saleStatus === "delivered" || saleStatus === "challan_created") && (
            <Button size="sm" onClick={() => convertMutation.mutate()} disabled={convertMutation.isPending}>
              <FileCheck className="mr-1.5 h-4 w-4" /> Convert to Invoice
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="mr-1.5 h-4 w-4" /> Print
          </Button>
        </div>
      </div>

      {/* Preview */}
      <div className="no-print min-h-screen bg-muted/40 py-8 px-4">
        <div id="challan-print-area" className="mx-auto max-w-[210mm] bg-background shadow-lg rounded-lg overflow-hidden">
          {template === "modern" ? (
            <ModernChallanDocument
              sale={sale}
              items={items}
              customer={customer}
              challan={activeChallan}
              showPrices={showPrices}
              dealerInfo={dealerInfo}
              isEditing={isEditing}
              editData={editData}
              onEditChange={setEditData}
              editItems={editItems}
              onEditItemChange={setEditItems}
            />
          ) : (
            <ChallanDocument
              sale={sale}
              items={items}
              customer={customer}
              challan={activeChallan}
              showPrices={showPrices}
              dealerInfo={dealerInfo}
              isEditing={isEditing}
              editData={editData}
              onEditChange={setEditData}
              editItems={editItems}
              onEditItemChange={setEditItems}
            />
          )}
        </div>
      </div>

      {/* Print-only version */}
      <div id="challan-print-area" className="hidden print:block">
        {template === "modern" ? (
          <ModernChallanDocument
            sale={sale}
            items={items}
            customer={customer}
            challan={activeChallan}
            showPrices={showPrices}
            dealerInfo={dealerInfo}
          />
        ) : (
          <ChallanDocument
            sale={sale}
            items={items}
            customer={customer}
            challan={activeChallan}
            showPrices={showPrices}
            dealerInfo={dealerInfo}
          />
        )}
      </div>
    </>
  );
};

/* ── Document Component ── */

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

interface ChallanDocumentProps {
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
}

const ChallanDocument = ({ sale, items, customer, challan, showPrices, dealerInfo, isEditing, editData, onEditChange, editItems, onEditItemChange }: ChallanDocumentProps) => {
  const challanDate = isEditing && editData ? editData.challan_date : (challan ? (challan as any).challan_date : sale.sale_date);
  const challanNo = challan ? (challan as any).challan_no : "—";
  const status = challan ? (challan as any).status : null;

  const displayItems = isEditing && editItems ? editItems : items;

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

      {/* ═══ HEADER ═══ */}
      <div className="challan-header text-center border-b-2 border-foreground pb-4 mb-1">
        <h1 className="text-2xl sm:text-3xl font-black tracking-tight uppercase text-foreground">
          {dealerInfo?.name ?? "Your Business Name"}
        </h1>
        <p className="text-[11px] text-muted-foreground mt-0.5">Tile & Sanitary Dealer</p>
        <div className="flex items-center justify-center gap-3 mt-1 text-[11px] text-muted-foreground">
          {dealerInfo?.phone && <span>📞 {dealerInfo.phone}</span>}
          {dealerInfo?.address && <span>📍 {dealerInfo.address}</span>}
        </div>
      </div>

      {/* ═══ TITLE BAR ═══ */}
      <div className="bg-foreground text-background py-2.5 px-5 flex items-center justify-between my-4 print:my-3">
        <h2 className="text-base font-bold tracking-[0.15em] uppercase">Delivery Challan</h2>
        <div className="text-right text-[11px] space-y-0.5">
          <p className="font-mono font-bold text-sm">{challanNo}</p>
          {isEditing && editData && onEditChange ? (
            <div><span className="mr-1">Date:</span><input type="date" value={editData.challan_date} onChange={(e) => onEditChange({ ...editData, challan_date: e.target.value })} className="bg-transparent border-b border-background/50 text-background text-[11px] outline-none" /></div>
          ) : (
            <p>Date: {challanDate}</p>
          )}
        </div>
      </div>

      {/* ═══ CUSTOMER & TRANSPORT ═══ */}
      <div className="challan-section grid grid-cols-1 sm:grid-cols-2 gap-0 border border-border mb-5 print:mb-4">
        {/* Deliver To */}
        <div className="p-4 sm:border-r border-border">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground mb-2 border-b border-border pb-1">
            Deliver To
          </p>
          <p className="font-bold text-[15px] text-foreground">{customer?.name ?? "—"}</p>
          {customer?.type && (
            <span className="inline-block mt-1 text-[9px] uppercase tracking-wider bg-muted text-muted-foreground px-2 py-0.5 rounded-sm font-semibold">
              {customer.type}
            </span>
          )}
          {customer?.phone && <p className="text-[11px] text-muted-foreground mt-1.5">📞 {customer.phone}</p>}
          {/* Site address overrides customer address when provided */}
          {(challan as any)?.project_sites?.address ? (
            <p className="text-[11px] text-muted-foreground leading-snug">📍 {(challan as any).project_sites.address}</p>
          ) : customer?.address ? (
            <p className="text-[11px] text-muted-foreground leading-snug">{customer.address}</p>
          ) : null}
          {/* Project / Site block */}
          {((challan as any)?.projects || (challan as any)?.project_sites) && (
            <div className="mt-2 pt-2 border-t border-border space-y-0.5">
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
        {/* Transport */}
        <div className="p-4 border-t sm:border-t-0 border-border">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground mb-2 border-b border-border pb-1">
            Transport Details
          </p>
          {challan ? (
            isEditing && editData && onEditChange ? (
              <div className="space-y-2 text-[12px]">
                {[
                  { label: "Driver", field: "driver_name" as const },
                  { label: "Driver Phone", field: "driver_phone" as const },
                  { label: "Transport", field: "transport_name" as const },
                  { label: "Vehicle", field: "vehicle_no" as const },
                ].map((t) => (
                  <div key={t.label} className="grid grid-cols-[80px_1fr] gap-1 items-center">
                    <span className="text-muted-foreground">{t.label}:</span>
                    <input
                      value={editData[t.field]}
                      onChange={(e) => onEditChange({ ...editData, [t.field]: e.target.value })}
                      className="border border-border rounded px-2 py-1 text-[12px] bg-background text-foreground outline-none focus:ring-1 focus:ring-primary"
                      placeholder={t.label}
                    />
                  </div>
                ))}
                <div className="grid grid-cols-[80px_1fr] gap-1 items-center">
                  <span className="text-muted-foreground">Scheduled:</span>
                  <input
                    type="date"
                    value={editData.scheduled_delivery_date}
                    onChange={(e) => onEditChange({ ...editData, scheduled_delivery_date: e.target.value })}
                    className="border border-border rounded px-2 py-1 text-[12px] bg-background text-foreground outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-1.5 text-[12px]">
                <div className="grid grid-cols-[80px_1fr] gap-1">
                  <span className="text-muted-foreground">Driver:</span>
                  <span className="font-medium text-foreground">{(challan as any).driver_name || "—"}</span>
                </div>
                {(challan as any).driver_phone && (
                  <div className="grid grid-cols-[80px_1fr] gap-1">
                    <span className="text-muted-foreground">Phone:</span>
                    <span className="font-medium text-foreground">{(challan as any).driver_phone}</span>
                  </div>
                )}
                <div className="grid grid-cols-[80px_1fr] gap-1">
                  <span className="text-muted-foreground">Transport:</span>
                  <span className="font-medium text-foreground">{(challan as any).transport_name || "—"}</span>
                </div>
                <div className="grid grid-cols-[80px_1fr] gap-1">
                  <span className="text-muted-foreground">Vehicle:</span>
                  <span className="font-medium text-foreground">{(challan as any).vehicle_no || "—"}</span>
                </div>
                {(challan as any).scheduled_delivery_date && (
                  <div className="grid grid-cols-[80px_1fr] gap-1">
                    <span className="text-muted-foreground">Scheduled:</span>
                    <span className="font-medium text-foreground">{(challan as any).scheduled_delivery_date}</span>
                  </div>
                )}
              </div>
            )
          ) : (
            <p className="text-[11px] text-muted-foreground italic">No challan created yet</p>
          )}
        </div>
      </div>

      {/* ═══ REFERENCE INFO ═══ */}
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px] mb-4 text-muted-foreground">
        <span><strong className="text-foreground">Invoice Ref:</strong> {sale.invoice_number ?? "—"}</span>
        {sale.client_reference && <span><strong className="text-foreground">Client Ref:</strong> {sale.client_reference}</span>}
        {sale.fitter_reference && <span><strong className="text-foreground">Fitter:</strong> {sale.fitter_reference}</span>}
        {status && (
          <span>
            <strong className="text-foreground">Status:</strong>{" "}
            <span className={`font-semibold ${
              status === "delivered" ? "text-green-700" : status === "cancelled" ? "text-destructive" : "text-blue-700"
            }`}>
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </span>
          </span>
        )}
      </div>

      {/* ═══ ITEMS TABLE ═══ */}
      <div className="mb-5 print:mb-4">
        <table className="w-full text-[12px] border-collapse">
          <thead>
            <tr className="bg-foreground text-background">
              <th className="px-3 py-2 text-left font-semibold w-8 border border-foreground">#</th>
              <th className="px-3 py-2 text-left font-semibold border border-foreground">Item Description</th>
              <th className="px-3 py-2 text-center font-semibold w-16 border border-foreground">Qty</th>
              <th className="px-3 py-2 text-center font-semibold w-14 border border-foreground">Unit</th>
              <th className="px-3 py-2 text-center font-semibold w-20 border border-foreground">SFT</th>
              {showPrices && <th className="px-3 py-2 text-right font-semibold w-24 border border-foreground">Rate</th>}
              {showPrices && <th className="px-3 py-2 text-right font-semibold w-28 border border-foreground">Amount</th>}
            </tr>
          </thead>
          <tbody>
            {isEditing && editItems ? (
              editItems.map((item, idx) => (
                <tr key={item.id} className={idx % 2 === 0 ? "bg-background" : "bg-muted/40"}>
                  <td className="px-3 py-2 border border-border text-muted-foreground text-center">{idx + 1}</td>
                  <td className="px-3 py-2 border border-border">
                    <p className="font-semibold text-foreground leading-tight">{item.product_name}</p>
                    <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{item.product_sku}</p>
                  </td>
                  <td className="px-3 py-2 border border-border text-center">
                    <input type="number" min={0.01} step="any" value={item.quantity} onChange={(e) => handleItemChange(idx, "quantity", Number(e.target.value))} className="w-14 text-center border border-border rounded px-1 py-0.5 text-[12px] bg-background text-foreground outline-none focus:ring-1 focus:ring-primary" />
                  </td>
                  <td className="px-3 py-2 border border-border text-center text-muted-foreground text-[11px]">
                    {item.unit_type === "box_sft" ? "Box" : "Pc"}
                  </td>
                  <td className="px-3 py-2 border border-border text-center text-foreground">{getItemSft(item)}</td>
                  {showPrices && (
                    <td className="px-3 py-2 border border-border text-right">
                      <input type="number" min={0} step="any" value={item.sale_rate} onChange={(e) => handleItemChange(idx, "sale_rate", Number(e.target.value))} className="w-20 text-right border border-border rounded px-1 py-0.5 text-[12px] bg-background text-foreground outline-none focus:ring-1 focus:ring-primary" />
                    </td>
                  )}
                  {showPrices && (
                    <td className="px-3 py-2 border border-border text-right font-bold text-foreground">{formatCurrency(getItemTotal(item))}</td>
                  )}
                </tr>
              ))
            ) : (
              items.map((item: any, idx: number) => (
                <tr key={item.id} className={idx % 2 === 0 ? "bg-background" : "bg-muted/40"}>
                  <td className="px-3 py-2 border border-border text-muted-foreground text-center">{idx + 1}</td>
                  <td className="px-3 py-2 border border-border">
                    <p className="font-semibold text-foreground leading-tight">{item.products?.name}</p>
                    <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{item.products?.sku}</p>
                  </td>
                  <td className="px-3 py-2 border border-border text-center font-semibold text-foreground">{item.quantity}</td>
                  <td className="px-3 py-2 border border-border text-center text-muted-foreground text-[11px]">
                    {item.products?.unit_type === "box_sft" ? "Box" : "Pc"}
                  </td>
                  <td className="px-3 py-2 border border-border text-center text-foreground">
                    {item.total_sft ? Number(item.total_sft).toFixed(2) : "—"}
                  </td>
                  {showPrices && (
                    <td className="px-3 py-2 border border-border text-right text-foreground">{formatCurrency(item.sale_rate)}</td>
                  )}
                  {showPrices && (
                    <td className="px-3 py-2 border border-border text-right font-bold text-foreground">{formatCurrency(item.total)}</td>
                  )}
                </tr>
              ))
            )}
            {/* Empty rows for print alignment */}
            {items.length < 5 && Array.from({ length: 5 - items.length }).map((_, i) => (
              <tr key={`empty-${i}`} className="print:table-row hidden">
                <td className="px-3 py-2 border border-border">&nbsp;</td>
                <td className="px-3 py-2 border border-border"></td>
                <td className="px-3 py-2 border border-border"></td>
                <td className="px-3 py-2 border border-border"></td>
                <td className="px-3 py-2 border border-border"></td>
                {showPrices && <td className="px-3 py-2 border border-border"></td>}
                {showPrices && <td className="px-3 py-2 border border-border"></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ═══ QUANTITY SUMMARY ═══ */}
      <div className="challan-section mb-5 print:mb-4 border border-border">
        <div className="grid grid-cols-3 divide-x divide-border">
          {[
            { label: "Total Boxes", value: isEditing ? editTotalBox : Number(sale.total_box) },
            { label: "Total SFT", value: isEditing ? editTotalSft.toFixed(2) : Number(sale.total_sft).toFixed(2) },
            { label: "Total Pieces", value: isEditing ? editTotalPiece : Number(sale.total_piece) },
          ].map((s) => (
            <div key={s.label} className="py-3 px-4 text-center">
              <p className="text-[9px] uppercase tracking-[0.15em] font-bold text-muted-foreground">{s.label}</p>
              <p className="text-xl font-black text-foreground mt-0.5">{s.value}</p>
            </div>
          ))}
        </div>
        {showPrices && (
          <div className="border-t border-border py-3 px-4 text-center bg-muted/40">
            <p className="text-[9px] uppercase tracking-[0.15em] font-bold text-muted-foreground">Total Amount</p>
            <p className="text-xl font-black text-foreground mt-0.5">{formatCurrency(isEditing ? editTotalAmount - Number(sale.discount) : sale.total_amount)}</p>
          </div>
        )}
      </div>

      {/* ═══ NOTES ═══ */}
      {isEditing && editData && onEditChange ? (
        <div className="border border-border p-3 mb-5 print:mb-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground mb-1">Notes</p>
          <textarea
            value={editData.notes}
            onChange={(e) => onEditChange({ ...editData, notes: e.target.value })}
            className="w-full border border-border rounded px-2 py-1 text-[11px] bg-background text-foreground outline-none focus:ring-1 focus:ring-primary min-h-[60px]"
            placeholder="Add notes..."
          />
        </div>
      ) : challan && (challan as any).notes ? (
        <div className="border border-border p-3 mb-5 print:mb-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground mb-1">Notes</p>
          <p className="text-[11px] text-foreground">{(challan as any).notes}</p>
        </div>
      ) : null}

      {/* ═══ TERMS & CONDITIONS ═══ */}
      <div className="border border-border p-3 mb-8 print:mb-6">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground mb-1">Terms & Conditions</p>
        <ol className="text-[10px] text-muted-foreground list-decimal list-inside space-y-0.5">
          <li>Goods once delivered will not be taken back without prior written approval.</li>
          <li>Please check the goods thoroughly at the time of delivery.</li>
          <li>This is a delivery challan only — not a tax invoice.</li>
          <li>Any discrepancy must be reported within 24 hours of delivery.</li>
        </ol>
      </div>

      {/* ═══ SIGNATURES ═══ */}
      <div className="challan-signature grid grid-cols-3 gap-6 mt-6 mb-4">
        <div className="text-center">
          <div className="h-16 border-b border-foreground/30"></div>
          <p className="text-[10px] text-muted-foreground font-semibold mt-2">Prepared By</p>
        </div>
        <div className="text-center">
          <div className="h-16 border-b border-foreground/30"></div>
          <p className="text-[10px] text-muted-foreground font-semibold mt-2">Receiver's Signature & Stamp</p>
        </div>
        <div className="text-center">
          <div className="h-16 border-b border-foreground/30"></div>
          <p className="text-[10px] text-muted-foreground font-semibold mt-2">Authorized Signatory</p>
        </div>
      </div>

      {/* ═══ FOOTER ═══ */}
      <div className="challan-footer border-t border-border pt-2 mt-4 flex justify-between text-[9px] text-muted-foreground">
        <span>This document is a delivery challan and does not serve as a tax invoice.</span>
        <span className="font-mono">{challanNo} · {challanDate}</span>
      </div>
    </div>
  );
};

export default ChallanPage;
