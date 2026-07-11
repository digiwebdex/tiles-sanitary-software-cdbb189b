import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Plus, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { useDealerId } from "@/hooks/useDealerId";
import { productService } from "@/services/productService";
import { customerService } from "@/services/customerService";
import { warehouseService } from "@/services/warehouseService";
import { godownService } from "@/services/godownService";
import { rackService } from "@/services/rackService";
import {
  listReservations, createReservation, editReservation, releaseReservation,
  type ReservationKind, type Reservation,
} from "@/services/reservationService";

const STATUS_VARIANT: Record<string, "default" | "outline" | "secondary" | "destructive"> = {
  active: "default", released: "secondary", expired: "destructive", fulfilled: "outline",
};

const emptyForm = {
  product_id: "", product_name: "", product_sku: "", unit_type: "piece" as "box_sft" | "piece",
  customer_id: "", customer_name: "",
  reserved_qty: 0, reason: "", expires_at: "",
  priority: 0, warehouse_id: "", godown_id: "", rack_id: "",
};

/**
 * V2 Sprint 3C — shared list/CRUD for both Reservations and Allocations.
 * "Stock Allocation" reuses the exact same table/RPCs as Reservation,
 * distinguished only by `kind` (see reservations.ts) — so one component
 * serves both tabs, parameterized by `kind`.
 */
const ReservationsTab = ({ kind }: { kind: ReservationKind }) => {
  const dealerId = useDealerId();
  const qc = useQueryClient();
  const label = kind === "allocation" ? "Allocation" : "Reservation";
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Reservation | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [productSearch, setProductSearch] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");

  const { data: rows = [] } = useQuery({
    queryKey: ["reservations", dealerId, kind],
    queryFn: () => listReservations(dealerId, { kind }),
    enabled: !!dealerId,
  });
  const { data: warehouses = [] } = useQuery({
    queryKey: ["warehouses", dealerId], queryFn: () => warehouseService.list(dealerId), enabled: !!dealerId && open,
  });
  const { data: godowns = [] } = useQuery({
    queryKey: ["godowns", dealerId, form.warehouse_id], queryFn: () => godownService.list(dealerId, form.warehouse_id || undefined),
    enabled: !!dealerId && open && !!form.warehouse_id,
  });
  const { data: racks = [] } = useQuery({
    queryKey: ["racks", dealerId, form.godown_id], queryFn: () => rackService.list(dealerId, form.godown_id || undefined),
    enabled: !!dealerId && open && !!form.godown_id,
  });
  const { data: productResults } = useQuery({
    queryKey: ["reservation-product-search", dealerId, productSearch],
    queryFn: () => productService.list(dealerId, productSearch, 1),
    enabled: !!dealerId && productSearch.trim().length > 1,
  });
  const { data: customerResults } = useQuery({
    queryKey: ["reservation-customer-search", dealerId, customerSearch],
    queryFn: () => customerService.list(dealerId, customerSearch, "", 1),
    enabled: !!dealerId && customerSearch.trim().length > 1,
  });

  const saveMut = useMutation({
    mutationFn: () => {
      const payload = {
        dealer_id: dealerId,
        product_id: form.product_id,
        customer_id: form.customer_id,
        reserved_qty: form.reserved_qty,
        unit_type: form.unit_type,
        reason: form.reason || undefined,
        expires_at: form.expires_at || null,
        kind,
        priority: form.priority,
        warehouse_id: form.warehouse_id || null,
        godown_id: form.godown_id || null,
        rack_id: form.rack_id || null,
      };
      return editing
        ? editReservation(editing.id, dealerId, {
            reserved_qty: form.reserved_qty, reason: form.reason || null, expires_at: form.expires_at || null,
            priority: form.priority, warehouse_id: form.warehouse_id || null, godown_id: form.godown_id || null, rack_id: form.rack_id || null,
          })
        : createReservation(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reservations"] });
      setOpen(false); setEditing(null); setForm(emptyForm);
      toast.success(editing ? `${label} updated` : `${label} created`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const releaseMut = useMutation({
    mutationFn: (id: string) => releaseReservation(id, dealerId, window.prompt(`Reason for releasing this ${label.toLowerCase()}?`) ?? ""),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["reservations"] }); toast.success(`${label} released`); },
    onError: (e: any) => toast.error(e.message),
  });

  const startCreate = () => { setEditing(null); setForm(emptyForm); setOpen(true); };
  const startEdit = (r: Reservation) => {
    setEditing(r);
    setForm({
      ...emptyForm,
      product_id: r.product_id, product_name: r.products?.name ?? "", product_sku: r.products?.sku ?? "",
      unit_type: (r.products?.unit_type as any) ?? "piece",
      customer_id: r.customer_id, customer_name: r.customers?.name ?? "",
      reserved_qty: Number(r.reserved_qty) - Number(r.fulfilled_qty) - Number(r.released_qty),
      reason: r.reason ?? "", expires_at: r.expires_at ? r.expires_at.slice(0, 16) : "",
      priority: r.priority ?? 0, warehouse_id: r.warehouse_id ?? "", godown_id: r.godown_id ?? "", rack_id: r.rack_id ?? "",
    });
    setOpen(true);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{label}s</CardTitle>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setEditing(null); setForm(emptyForm); setProductSearch(""); setCustomerSearch(""); } }}>
          <DialogTrigger asChild><Button onClick={startCreate}><Plus className="h-4 w-4 mr-2" />New {label}</Button></DialogTrigger>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{editing ? `Edit ${label}` : `New ${label}`}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              {!editing && (
                <>
                  <div>
                    <Label>Product *</Label>
                    <Input
                      placeholder="Search by name or SKU…"
                      value={form.product_id ? `${form.product_name} (${form.product_sku})` : productSearch}
                      onChange={e => { setForm({ ...form, product_id: "" }); setProductSearch(e.target.value); }}
                    />
                    {!form.product_id && !!productResults?.data?.length && (
                      <div className="border rounded-md divide-y mt-1 max-h-40 overflow-y-auto">
                        {productResults.data.slice(0, 8).map((p: any) => (
                          <button key={p.id} type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-muted"
                            onClick={() => { setForm({ ...form, product_id: p.id, product_name: p.name, product_sku: p.sku, unit_type: p.unit_type }); setProductSearch(""); }}>
                            {p.name} <span className="text-xs text-muted-foreground">{p.sku}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <Label>Customer *</Label>
                    <Input
                      placeholder="Search by name…"
                      value={form.customer_id ? form.customer_name : customerSearch}
                      onChange={e => { setForm({ ...form, customer_id: "" }); setCustomerSearch(e.target.value); }}
                    />
                    {!form.customer_id && !!customerResults?.data?.length && (
                      <div className="border rounded-md divide-y mt-1 max-h-40 overflow-y-auto">
                        {customerResults.data.slice(0, 8).map((c: any) => (
                          <button key={c.id} type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-muted"
                            onClick={() => { setForm({ ...form, customer_id: c.id, customer_name: c.name }); setCustomerSearch(""); }}>
                            {c.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Quantity *</Label><Input type="number" value={form.reserved_qty} onChange={e => setForm({ ...form, reserved_qty: Number(e.target.value) })} /></div>
                <div><Label>Priority</Label><Input type="number" min={0} max={100} value={form.priority} onChange={e => setForm({ ...form, priority: Number(e.target.value) })} /></div>
                <div className="col-span-2"><Label>Expires At</Label><Input type="datetime-local" value={form.expires_at} onChange={e => setForm({ ...form, expires_at: e.target.value })} /></div>
                <div className="col-span-2"><Label>Reason</Label><Input value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} /></div>
                <div className="col-span-2">
                  <Label>Warehouse (optional)</Label>
                  <Select value={form.warehouse_id} onValueChange={(v) => setForm({ ...form, warehouse_id: v, godown_id: "", rack_id: "" })}>
                    <SelectTrigger><SelectValue placeholder="— dealer-wide —" /></SelectTrigger>
                    <SelectContent>{warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                {form.warehouse_id && (
                  <div className="col-span-2">
                    <Label>Godown (optional)</Label>
                    <Select value={form.godown_id} onValueChange={(v) => setForm({ ...form, godown_id: v, rack_id: "" })}>
                      <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>{godowns.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                )}
                {form.godown_id && (
                  <div className="col-span-2">
                    <Label>Rack (optional)</Label>
                    <Select value={form.rack_id} onValueChange={(v) => setForm({ ...form, rack_id: v })}>
                      <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>{racks.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              <Button className="w-full" onClick={() => saveMut.mutate()}
                disabled={saveMut.isPending || (!editing && (!form.product_id || !form.customer_id)) || form.reserved_qty <= 0}>
                Save
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Product</TableHead><TableHead>Customer</TableHead>
            <TableHead className="text-right">Qty</TableHead><TableHead>Location</TableHead>
            <TableHead>Batch</TableHead><TableHead>Expires</TableHead>
            <TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.map(r => {
              const remaining = Number(r.reserved_qty) - Number(r.fulfilled_qty) - Number(r.released_qty);
              const location = [r.warehouse_name, r.godown_name, r.rack_name].filter(Boolean).join(" → ");
              return (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.products?.name ?? "—"} <span className="text-xs text-muted-foreground">{r.products?.sku}</span></TableCell>
                  <TableCell>{r.customers?.name ?? "—"}</TableCell>
                  <TableCell className="text-right">{remaining}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{location || "—"}</TableCell>
                  <TableCell className="text-xs">{r.product_batches?.batch_no ?? "—"}</TableCell>
                  <TableCell className="text-xs">{r.expires_at ? new Date(r.expires_at).toLocaleString() : "—"}</TableCell>
                  <TableCell><Badge variant={STATUS_VARIANT[r.status] ?? "outline"}>{r.status}</Badge></TableCell>
                  <TableCell className="text-right">
                    {r.status === "active" && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => startEdit(r)}>Edit</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => releaseMut.mutate(r.id)}>Release</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {!rows.length && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">No {label.toLowerCase()}s yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};

export default ReservationsTab;
