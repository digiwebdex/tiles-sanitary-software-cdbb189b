import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useDealerId } from "@/hooks/useDealerId";
import { warehouseService, type TransferLevel } from "@/services/warehouseService";
import { godownService } from "@/services/godownService";
import { rackService } from "@/services/rackService";
import { bankAccountService } from "@/services/bankAccountService";
import { formatCurrency } from "@/lib/utils";
import { Plus, Warehouse as WhIcon, ArrowRightLeft, MoreHorizontal, Boxes, LayoutDashboard } from "lucide-react";
import { toast } from "sonner";
import GodownsTab from "@/modules/warehouses/GodownsTab";
import RacksTab from "@/modules/warehouses/RacksTab";
import BinsTab from "@/modules/warehouses/BinsTab";
import BatchesTab from "@/modules/warehouses/BatchesTab";
import LocationStockDialog from "@/modules/warehouses/LocationStockDialog";

const emptyTransfer = {
  transfer_no: "", transfer_level: "warehouse" as TransferLevel,
  from_warehouse_id: "", to_warehouse_id: "",
  from_godown_id: "", to_godown_id: "",
  from_rack_id: "", to_rack_id: "",
  product_name_snapshot: "", quantity: 0, qty_sqft: 0, unit: "pc",
  transport_cost: 0, payment_method: "cash" as "cash" | "bank",
  bank_account_id: "", notes: "",
};

const WarehousesPage = () => {
  const dealerId = useDealerId();
  const qc = useQueryClient();
  const [tab, setTab] = useState("warehouses");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", code: "", address: "", manager_name: "", manager_phone: "", is_default: false, notes: "" });
  const [trOpen, setTrOpen] = useState(false);
  const [trMode, setTrMode] = useState<"request" | "immediate">("request");
  const [tr, setTr] = useState(emptyTransfer);
  const [stockFor, setStockFor] = useState<{ id: string; name: string } | null>(null);

  const { data: warehouses = [] } = useQuery({
    queryKey: ["warehouses", dealerId], queryFn: () => warehouseService.list(dealerId), enabled: !!dealerId,
  });
  const { data: godowns = [] } = useQuery({
    queryKey: ["godowns", dealerId], queryFn: () => godownService.list(dealerId), enabled: !!dealerId,
  });
  const { data: racks = [] } = useQuery({
    queryKey: ["racks", dealerId], queryFn: () => rackService.list(dealerId), enabled: !!dealerId,
  });
  const { data: transfers = [] } = useQuery({
    queryKey: ["warehouse-transfers", dealerId], queryFn: () => warehouseService.transfers(dealerId), enabled: !!dealerId,
  });
  const { data: banks = [] } = useQuery({
    queryKey: ["bank-accounts", dealerId], queryFn: () => bankAccountService.list(dealerId), enabled: !!dealerId,
  });

  const dashboard = useMemo(() => ({
    warehouses: warehouses.filter(w => w.is_active).length,
    godowns: godowns.filter(g => g.is_active).length,
    racks: racks.filter(r => r.is_active).length,
    pendingTransfers: transfers.filter(t => t.status === "requested").length,
  }), [warehouses, godowns, racks, transfers]);

  const createMut = useMutation({
    mutationFn: () => warehouseService.create(dealerId, form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["warehouses"] });
      qc.invalidateQueries({ queryKey: ["godowns"] });
      qc.invalidateQueries({ queryKey: ["racks"] });
      setOpen(false); setForm({ name: "", code: "", address: "", manager_name: "", manager_phone: "", is_default: false, notes: "" }); toast.success("Warehouse added");
    },
    onError: (e: any) => toast.error(e.message),
  });
  const trMut = useMutation({
    mutationFn: () => {
      const payload = {
        ...tr, bank_account_id: tr.payment_method === "bank" ? tr.bank_account_id : null,
        from_warehouse_id: tr.from_warehouse_id || null, to_warehouse_id: tr.to_warehouse_id || null,
        from_godown_id: tr.from_godown_id || null, to_godown_id: tr.to_godown_id || null,
        from_rack_id: tr.from_rack_id || null, to_rack_id: tr.to_rack_id || null,
      } as any;
      return trMode === "request"
        ? warehouseService.requestTransfer(dealerId, payload)
        : warehouseService.createTransfer(dealerId, payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["warehouse-transfers"] });
      setTrOpen(false); setTr(emptyTransfer);
      toast.success(trMode === "request" ? "Transfer requested" : "Transfer recorded");
    },
    onError: (e: any) => toast.error(e.message),
  });
  const approveMut = useMutation({
    mutationFn: (id: string) => warehouseService.approveTransfer(id, dealerId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["warehouse-transfers"] }); toast.success("Approved"); },
    onError: (e: any) => toast.error(e.message),
  });
  const rejectMut = useMutation({
    mutationFn: (id: string) => warehouseService.rejectTransfer(id, dealerId, window.prompt("Reason?") ?? undefined),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["warehouse-transfers"] }); toast.success("Rejected"); },
    onError: (e: any) => toast.error(e.message),
  });
  const receiveMut = useMutation({
    mutationFn: (id: string) => warehouseService.receiveTransfer(id, dealerId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["warehouse-transfers"] }); toast.success("Received — cost posted"); },
    onError: (e: any) => toast.error(e.message),
  });

  const statusBadge = (s: string) => {
    const map: Record<string, "default" | "outline" | "secondary" | "destructive"> = {
      requested: "outline", approved: "secondary", received: "default", rejected: "destructive", cancelled: "secondary",
    };
    return <Badge variant={map[s] || "outline"}>{s}</Badge>;
  };

  const activeGodowns = godowns.filter(g => g.is_active);
  const activeRacks = racks.filter(r => r.is_active);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><WhIcon className="h-6 w-6 text-primary" /> Warehouses / Godowns</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage warehouses, godowns, racks, bins, batches, and stock transfers between them</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-6">
          <p className="text-sm text-muted-foreground flex items-center gap-1"><LayoutDashboard className="h-3.5 w-3.5" />Warehouses</p>
          <p className="text-2xl font-bold mt-1">{dashboard.warehouses}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">Godowns</p>
          <p className="text-2xl font-bold mt-1">{dashboard.godowns}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">Racks</p>
          <p className="text-2xl font-bold mt-1">{dashboard.racks}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">Pending Transfers</p>
          <p className="text-2xl font-bold mt-1">{dashboard.pendingTransfers}</p>
        </CardContent></Card>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="warehouses">Warehouses</TabsTrigger>
          <TabsTrigger value="godowns">Godowns</TabsTrigger>
          <TabsTrigger value="racks">Racks</TabsTrigger>
          <TabsTrigger value="bins">Bins</TabsTrigger>
          <TabsTrigger value="batches">Batches</TabsTrigger>
          <TabsTrigger value="transfers">Transfers</TabsTrigger>
        </TabsList>

        <TabsContent value="warehouses">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>All Warehouses</CardTitle>
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />Add Warehouse</Button></DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>New Warehouse</DialogTitle></DialogHeader>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Name *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
                    <div><Label>Code</Label><Input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} /></div>
                    <div className="col-span-2"><Label>Address</Label><Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></div>
                    <div><Label>Manager Name</Label><Input value={form.manager_name} onChange={e => setForm({ ...form, manager_name: e.target.value })} /></div>
                    <div><Label>Manager Phone</Label><Input value={form.manager_phone} onChange={e => setForm({ ...form, manager_phone: e.target.value })} /></div>
                    <div className="col-span-2 flex items-center gap-2">
                      <input type="checkbox" id="def" checked={form.is_default} onChange={e => setForm({ ...form, is_default: e.target.checked })} />
                      <Label htmlFor="def" className="cursor-pointer">Set as default warehouse</Label>
                    </div>
                  </div>
                  <Button className="w-full mt-3" onClick={() => createMut.mutate()} disabled={createMut.isPending}>Save</Button>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Name</TableHead><TableHead>Code</TableHead><TableHead>Manager</TableHead>
                  <TableHead>Address</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {warehouses.map(w => (
                    <TableRow key={w.id}>
                      <TableCell className="font-medium">
                        {w.name} {w.is_default && <Badge variant="outline" className="ml-2">Default</Badge>}
                      </TableCell>
                      <TableCell>{w.code || "—"}</TableCell>
                      <TableCell>{w.manager_name || "—"} <span className="text-xs text-muted-foreground">{w.manager_phone}</span></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{w.address || "—"}</TableCell>
                      <TableCell>{w.is_active ? <Badge>Active</Badge> : <Badge variant="secondary">Inactive</Badge>}</TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setStockFor({ id: w.id, name: w.name })}><Boxes className="h-4 w-4 mr-2" />View Stock</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!warehouses.length && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No warehouses yet.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          {stockFor && (
            <LocationStockDialog
              open={!!stockFor}
              onOpenChange={(o) => !o && setStockFor(null)}
              title={`Stock — ${stockFor.name}`}
              queryKey={["warehouse-stock", stockFor.id]}
              fetchStock={() => warehouseService.stock(stockFor.id, dealerId)}
            />
          )}
        </TabsContent>

        <TabsContent value="godowns"><GodownsTab warehouses={warehouses} /></TabsContent>
        <TabsContent value="racks"><RacksTab godowns={activeGodowns} /></TabsContent>
        <TabsContent value="bins"><BinsTab racks={activeRacks} /></TabsContent>
        <TabsContent value="batches"><BatchesTab /></TabsContent>

        <TabsContent value="transfers">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Transfer History</CardTitle>
              <Dialog open={trOpen} onOpenChange={(o) => { setTrOpen(o); if (!o) setTr(emptyTransfer); }}>
                <DialogTrigger asChild><Button><ArrowRightLeft className="h-4 w-4 mr-2" />New Transfer</Button></DialogTrigger>
                <DialogContent className="max-w-lg">
                  <DialogHeader><DialogTitle>{trMode === "request" ? "Request" : "Record"} Transfer</DialogTitle></DialogHeader>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Mode</Label>
                      <Select value={trMode} onValueChange={(v: any) => setTrMode(v)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="request">Send Request (needs approval)</SelectItem>
                          <SelectItem value="immediate">Immediate (post directly)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Level</Label>
                      <Select value={tr.transfer_level} onValueChange={(v: TransferLevel) => setTr({
                        ...emptyTransfer, transfer_level: v, transfer_no: tr.transfer_no,
                        product_name_snapshot: tr.product_name_snapshot, quantity: tr.quantity,
                        qty_sqft: tr.qty_sqft, unit: tr.unit, transport_cost: tr.transport_cost,
                        payment_method: tr.payment_method, bank_account_id: tr.bank_account_id, notes: tr.notes,
                      })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="warehouse">Warehouse → Warehouse</SelectItem>
                          <SelectItem value="godown">Godown → Godown</SelectItem>
                          <SelectItem value="rack">Rack → Rack</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-2"><Label>Transfer No.</Label><Input value={tr.transfer_no} onChange={e => setTr({ ...tr, transfer_no: e.target.value })} /></div>

                    {tr.transfer_level === "warehouse" && (
                      <>
                        <div>
                          <Label>From Warehouse</Label>
                          <Select value={tr.from_warehouse_id} onValueChange={(v) => setTr({ ...tr, from_warehouse_id: v })}>
                            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                            <SelectContent>{warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label>To Warehouse</Label>
                          <Select value={tr.to_warehouse_id} onValueChange={(v) => setTr({ ...tr, to_warehouse_id: v })}>
                            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                            <SelectContent>{warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                      </>
                    )}
                    {tr.transfer_level === "godown" && (
                      <>
                        <div>
                          <Label>From Godown</Label>
                          <Select value={tr.from_godown_id} onValueChange={(v) => setTr({ ...tr, from_godown_id: v })}>
                            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                            <SelectContent>{activeGodowns.map(g => <SelectItem key={g.id} value={g.id}>{g.name} ({g.warehouse_name})</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label>To Godown</Label>
                          <Select value={tr.to_godown_id} onValueChange={(v) => setTr({ ...tr, to_godown_id: v })}>
                            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                            <SelectContent>{activeGodowns.map(g => <SelectItem key={g.id} value={g.id}>{g.name} ({g.warehouse_name})</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                      </>
                    )}
                    {tr.transfer_level === "rack" && (
                      <>
                        <div>
                          <Label>From Rack</Label>
                          <Select value={tr.from_rack_id} onValueChange={(v) => setTr({ ...tr, from_rack_id: v })}>
                            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                            <SelectContent>{activeRacks.map(r => <SelectItem key={r.id} value={r.id}>{r.name} ({r.godown_name})</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label>To Rack</Label>
                          <Select value={tr.to_rack_id} onValueChange={(v) => setTr({ ...tr, to_rack_id: v })}>
                            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                            <SelectContent>{activeRacks.map(r => <SelectItem key={r.id} value={r.id}>{r.name} ({r.godown_name})</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                      </>
                    )}

                    <div className="col-span-2"><Label>Product / Item *</Label><Input value={tr.product_name_snapshot} onChange={e => setTr({ ...tr, product_name_snapshot: e.target.value })} /></div>
                    <div><Label>Quantity *</Label><Input type="number" value={tr.quantity} onChange={e => setTr({ ...tr, quantity: Number(e.target.value) })} /></div>
                    <div><Label>Unit</Label><Input value={tr.unit} onChange={e => setTr({ ...tr, unit: e.target.value })} placeholder="pc / box / sft" /></div>
                    <div className="col-span-2"><Label>Total SQFT (tiles)</Label><Input type="number" step="0.01" value={tr.qty_sqft} onChange={e => setTr({ ...tr, qty_sqft: Number(e.target.value) })} placeholder="Leave 0 for non-tile items" /></div>
                    <div><Label>Transport Cost</Label><Input type="number" value={tr.transport_cost} onChange={e => setTr({ ...tr, transport_cost: Number(e.target.value) })} /></div>
                    <div>
                      <Label>Payment Method</Label>
                      <Select value={tr.payment_method} onValueChange={(v: any) => setTr({ ...tr, payment_method: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cash">Cash</SelectItem>
                          <SelectItem value="bank">Bank</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {tr.payment_method === "bank" && (
                      <div className="col-span-2">
                        <Label>Bank Account</Label>
                        <Select value={tr.bank_account_id} onValueChange={(v) => setTr({ ...tr, bank_account_id: v })}>
                          <SelectTrigger><SelectValue placeholder="Select bank" /></SelectTrigger>
                          <SelectContent>{banks.filter(b => b.is_active).map(b => <SelectItem key={b.id} value={b.id}>{b.bank_name} — {b.account_number}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    )}
                    <div className="col-span-2"><Label>Notes</Label><Input value={tr.notes} onChange={e => setTr({ ...tr, notes: e.target.value })} /></div>
                  </div>
                  <Button className="w-full mt-3" onClick={() => trMut.mutate()} disabled={trMut.isPending || tr.quantity <= 0}>
                    {trMode === "request" ? "Send Request" : "Save Transfer"}
                  </Button>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Date</TableHead><TableHead>No.</TableHead><TableHead>Level</TableHead>
                  <TableHead>From</TableHead><TableHead>To</TableHead>
                  <TableHead>Item</TableHead><TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">SQFT</TableHead>
                  <TableHead className="text-right">Transport</TableHead>
                  <TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {transfers.map(t => {
                    const from = t.transfer_level === "godown" ? t.from_godown_name
                      : t.transfer_level === "rack" ? t.from_rack_name : t.from_warehouse_name;
                    const to = t.transfer_level === "godown" ? t.to_godown_name
                      : t.transfer_level === "rack" ? t.to_rack_name : t.to_warehouse_name;
                    return (
                      <TableRow key={t.id}>
                        <TableCell className="text-xs">{new Date(t.transfer_date).toLocaleDateString()}</TableCell>
                        <TableCell>{t.transfer_no || "—"}</TableCell>
                        <TableCell className="text-xs capitalize">{t.transfer_level ?? "warehouse"}</TableCell>
                        <TableCell>{from || "—"}</TableCell>
                        <TableCell>{to || "—"}</TableCell>
                        <TableCell>{t.product_name_snapshot || "—"}</TableCell>
                        <TableCell className="text-right">{Number(t.quantity)} {t.unit}</TableCell>
                        <TableCell className="text-right">{Number(t.qty_sqft) > 0 ? Number(t.qty_sqft).toFixed(2) : "—"}</TableCell>
                        <TableCell className="text-right font-mono">{formatCurrency(Number(t.transport_cost))}</TableCell>
                        <TableCell>{statusBadge(t.status)}</TableCell>
                        <TableCell className="text-right space-x-1">
                          {t.status === "requested" && (
                            <>
                              <Button size="sm" variant="outline" onClick={() => approveMut.mutate(t.id)} disabled={approveMut.isPending}>Approve</Button>
                              <Button size="sm" variant="destructive" onClick={() => rejectMut.mutate(t.id)} disabled={rejectMut.isPending}>Reject</Button>
                            </>
                          )}
                          {t.status === "approved" && (
                            <Button size="sm" onClick={() => receiveMut.mutate(t.id)} disabled={receiveMut.isPending}>Receive</Button>
                          )}
                          {(t.status === "received" || t.status === "rejected" || t.status === "cancelled") && (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!transfers.length && <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground py-6">No transfers yet.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default WarehousesPage;
