import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useDealerId } from "@/hooks/useDealerId";
import { purchaseOrderService, type PurchaseOrderStatus } from "@/services/purchaseOrderService";
import {
  goodsReceiptService,
  type GoodsReceiptItemInput,
  type PendingReceiptLine,
} from "@/services/goodsReceiptService";
import { warehouseService } from "@/services/warehouseService";
import { godownService } from "@/services/godownService";
import { rackService } from "@/services/rackService";
import { binService } from "@/services/binService";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Search } from "lucide-react";

const RECEIVABLE_STATUSES: PurchaseOrderStatus[] = ["approved", "sent", "partially_received"];

interface LineDraft extends GoodsReceiptItemInput {
  product_name_snapshot: string;
  pending_qty: number;
}

const CreateGoodsReceipt = () => {
  const dealerId = useDealerId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const isEdit = !!id;

  const [poId, setPoId] = useState(searchParams.get("fromPurchaseOrder") || "");
  const [poSearch, setPoSearch] = useState("");
  const [receiveDate, setReceiveDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([]);

  const { data: existing } = useQuery({
    queryKey: ["goods-receipt", id, dealerId],
    queryFn: () => goodsReceiptService.getById(id!, dealerId),
    enabled: isEdit && !!id && !!dealerId,
  });

  const hasPrefilled = useRef(false);
  useEffect(() => {
    if (!existing || hasPrefilled.current) return;
    if (existing.status !== "draft") {
      toast.error("Only a draft goods receipt can be edited.");
      navigate(`/goods-receipts/${existing.id}`);
      return;
    }
    hasPrefilled.current = true;
    setPoId(existing.purchase_order_id);
    setReceiveDate(existing.receive_date.slice(0, 10));
    setNotes(existing.notes ?? "");
    setLines(
      existing.items.map((it) => ({
        purchase_order_item_id: it.purchase_order_item_id,
        product_id: it.product_id,
        product_name_snapshot: it.product_sku ?? it.product_id,
        received_qty: it.received_qty,
        pending_qty: it.received_qty,
        batch_no: it.batch_no,
        lot_no: it.lot_no,
        shade_code: it.shade_code,
        caliber: it.caliber,
        manufacturing_date: it.manufacturing_date,
        warehouse_id: it.warehouse_id,
        godown_id: it.godown_id,
        rack_id: it.rack_id,
        bin_id: it.bin_id,
        notes: it.notes,
      })),
    );
  }, [existing, navigate]);

  const { data: poSearchResults = [] } = useQuery({
    queryKey: ["grn-po-search", dealerId, poSearch],
    queryFn: async () => {
      const { data } = await purchaseOrderService.list(dealerId, poSearch, 1);
      return data.filter((po) => RECEIVABLE_STATUSES.includes(po.status));
    },
    enabled: !!dealerId && poSearch.trim().length > 1 && !isEdit,
  });

  const { data: pending } = useQuery({
    queryKey: ["grn-pending", dealerId, poId],
    queryFn: () => goodsReceiptService.getPendingForPurchaseOrder(poId, dealerId),
    enabled: !!dealerId && !!poId && !isEdit,
  });

  const hasLoadedPending = useRef(false);
  useEffect(() => {
    if (!pending || hasLoadedPending.current || isEdit) return;
    hasLoadedPending.current = true;
    const withPending = pending.lines.filter((l) => l.pending_qty > 0);
    setLines(
      withPending.map((l: PendingReceiptLine) => ({
        purchase_order_item_id: l.purchase_order_item_id,
        product_id: l.product_id,
        product_name_snapshot: l.product_name_snapshot,
        received_qty: l.pending_qty,
        pending_qty: l.pending_qty,
        batch_no: null,
        lot_no: null,
        shade_code: null,
        caliber: null,
        manufacturing_date: null,
        warehouse_id: null,
        godown_id: null,
        rack_id: null,
        bin_id: null,
        notes: null,
      })),
    );
  }, [pending, isEdit]);

  const { data: warehouses = [] } = useQuery({
    queryKey: ["grn-warehouses", dealerId],
    queryFn: () => warehouseService.list(dealerId),
    enabled: !!dealerId,
  });

  const updateLine = (idx: number, patch: Partial<LineDraft>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!poId) throw new Error("Select a purchase order to receive against.");
      if (lines.length === 0) throw new Error("No pending lines to receive.");
      const form = {
        purchase_order_id: poId,
        receive_date: receiveDate,
        notes,
        items: lines.map((l) => ({
          purchase_order_item_id: l.purchase_order_item_id,
          product_id: l.product_id,
          received_qty: l.received_qty,
          batch_no: l.batch_no,
          lot_no: l.lot_no,
          shade_code: l.shade_code,
          caliber: l.caliber,
          manufacturing_date: l.manufacturing_date,
          warehouse_id: l.warehouse_id,
          godown_id: l.godown_id,
          rack_id: l.rack_id,
          bin_id: l.bin_id,
          notes: l.notes,
        })),
      };
      if (isEdit) return goodsReceiptService.update(id!, dealerId, form);
      return goodsReceiptService.create(dealerId, form);
    },
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: ["goods-receipts"] });
      toast.success(isEdit ? "Goods receipt updated" : "Goods receipt saved as draft");
      navigate(`/goods-receipts/${row.id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{isEdit ? "Edit Goods Receipt" : "Receive Purchase Order"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isEdit && (
            <div className="relative max-w-md">
              <label className="text-sm font-medium mb-1 block">Purchase Order</label>
              {poId ? (
                <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                  <span>{pending?.purchase_order.po_number ?? poId} — {pending?.purchase_order.supplier_name}</span>
                  <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => { setPoId(""); hasLoadedPending.current = false; setLines([]); }}>
                    Change
                  </button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input placeholder="Search a receivable purchase order…" value={poSearch} onChange={(e) => setPoSearch(e.target.value)} className="pl-9" />
                  </div>
                  {poSearch.trim().length > 1 && poSearchResults.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-md max-h-56 overflow-y-auto">
                      {poSearchResults.map((po) => (
                        <button key={po.id} type="button" className="block w-full text-left px-3 py-2 text-sm hover:bg-accent" onClick={() => { setPoId(po.id); setPoSearch(""); }}>
                          {po.po_number ?? "Draft"} — {po.supplier_name}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium mb-1 block">Receive Date</label>
              <Input type="date" value={receiveDate} onChange={(e) => setReceiveDate(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Notes</label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {poId && (
        <Card>
          <CardHeader><CardTitle className="text-base">Items to Receive</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {lines.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">Nothing pending — this purchase order is already fully received.</p>
            ) : (
              lines.map((line, idx) => (
                <ReceiveLineRow
                  key={line.purchase_order_item_id}
                  line={line}
                  warehouses={warehouses}
                  onChange={(patch) => updateLine(idx, patch)}
                />
              ))
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex gap-3">
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || lines.length === 0}>
          {saveMutation.isPending ? "Saving…" : isEdit ? "Save Changes" : "Save as Draft"}
        </Button>
        <Button type="button" variant="outline" onClick={() => navigate("/goods-receipts")}>
          Cancel
        </Button>
      </div>
    </div>
  );
};

function ReceiveLineRow({
  line,
  warehouses,
  onChange,
}: {
  line: LineDraft;
  warehouses: Array<{ id: string; name: string }>;
  onChange: (patch: Partial<LineDraft>) => void;
}) {
  const dealerId = useDealerId();
  const { data: godowns = [] } = useQuery({
    queryKey: ["grn-godowns", dealerId, line.warehouse_id],
    queryFn: () => godownService.list(dealerId, line.warehouse_id!),
    enabled: !!dealerId && !!line.warehouse_id,
  });
  const { data: racks = [] } = useQuery({
    queryKey: ["grn-racks", dealerId, line.godown_id],
    queryFn: () => rackService.list(dealerId, line.godown_id!),
    enabled: !!dealerId && !!line.godown_id,
  });
  const { data: bins = [] } = useQuery({
    queryKey: ["grn-bins", dealerId, line.rack_id],
    queryFn: () => binService.list(dealerId, line.rack_id!),
    enabled: !!dealerId && !!line.rack_id,
  });

  return (
    <div className="rounded-md border p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-medium text-sm">{line.product_name_snapshot}</span>
        <span className="text-xs text-muted-foreground">Pending: {line.pending_qty}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Received Qty</label>
          <Input type="number" min={0.001} max={line.pending_qty} step="0.001" value={line.received_qty} onChange={(e) => onChange({ received_qty: Number(e.target.value) })} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Batch No</label>
          <Input value={line.batch_no ?? ""} onChange={(e) => onChange({ batch_no: e.target.value })} placeholder="Auto-generated if blank" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Lot No</label>
          <Input value={line.lot_no ?? ""} onChange={(e) => onChange({ lot_no: e.target.value })} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Shade</label>
          <Input value={line.shade_code ?? ""} onChange={(e) => onChange({ shade_code: e.target.value })} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Caliber</label>
          <Input value={line.caliber ?? ""} onChange={(e) => onChange({ caliber: e.target.value })} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Manufacturing Date</label>
          <Input type="date" value={line.manufacturing_date ?? ""} onChange={(e) => onChange({ manufacturing_date: e.target.value })} />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Warehouse</label>
          <Select value={line.warehouse_id ?? undefined} onValueChange={(v) => onChange({ warehouse_id: v, godown_id: null, rack_id: null, bin_id: null })}>
            <SelectTrigger><SelectValue placeholder="Default warehouse" /></SelectTrigger>
            <SelectContent>
              {warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Godown</label>
          <Select value={line.godown_id ?? undefined} onValueChange={(v) => onChange({ godown_id: v, rack_id: null, bin_id: null })} disabled={!line.warehouse_id}>
            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              {godowns.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Rack</label>
          <Select value={line.rack_id ?? undefined} onValueChange={(v) => onChange({ rack_id: v, bin_id: null })} disabled={!line.godown_id}>
            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              {racks.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Bin</label>
          <Select value={line.bin_id ?? undefined} onValueChange={(v) => onChange({ bin_id: v })} disabled={!line.rack_id}>
            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              {bins.map((b) => <SelectItem key={b.id} value={b.id}>{b.bin_code}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

export default CreateGoodsReceipt;
