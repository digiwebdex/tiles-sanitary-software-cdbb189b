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
import { Plus, MoreHorizontal, Boxes } from "lucide-react";
import { toast } from "sonner";
import { useDealerId } from "@/hooks/useDealerId";
import { godownService } from "@/services/godownService";
import type { Warehouse } from "@/services/warehouseService";
import LocationStockDialog from "@/modules/warehouses/LocationStockDialog";

const emptyForm = { warehouse_id: "", name: "", code: "", is_default: false, notes: "" };

/** V2 Sprint 3B — Godown Management: list, create/edit/delete, Warehouse→Godown link, Default Godown. */
const GodownsTab = ({ warehouses }: { warehouses: Warehouse[] }) => {
  const dealerId = useDealerId();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [stockFor, setStockFor] = useState<{ id: string; name: string } | null>(null);

  const { data: godowns = [] } = useQuery({
    queryKey: ["godowns", dealerId], queryFn: () => godownService.list(dealerId), enabled: !!dealerId,
  });

  const saveMut = useMutation({
    mutationFn: () => editing
      ? godownService.update(editing, dealerId, form)
      : godownService.create(dealerId, form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["godowns"] });
      setOpen(false); setEditing(null); setForm(emptyForm);
      toast.success(editing ? "Godown updated" : "Godown added");
    },
    onError: (e: any) => toast.error(e.message),
  });
  const toggleActiveMut = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      is_active ? godownService.remove(id, dealerId) : godownService.update(id, dealerId, { is_active: true }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["godowns"] }); toast.success("Status updated"); },
    onError: (e: any) => toast.error(e.message),
  });

  const startEdit = (g: (typeof godowns)[number]) => {
    setEditing(g.id);
    setForm({ warehouse_id: g.warehouse_id, name: g.name, code: g.code ?? "", is_default: g.is_default, notes: g.notes ?? "" });
    setOpen(true);
  };
  const startCreate = () => { setEditing(null); setForm(emptyForm); setOpen(true); };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Godowns</CardTitle>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setEditing(null); setForm(emptyForm); } }}>
          <DialogTrigger asChild><Button onClick={startCreate}><Plus className="h-4 w-4 mr-2" />Add Godown</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editing ? "Edit Godown" : "New Godown"}</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Warehouse *</Label>
                <Select value={form.warehouse_id} onValueChange={(v) => setForm({ ...form, warehouse_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select warehouse" /></SelectTrigger>
                  <SelectContent>{warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Name *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
              <div><Label>Code</Label><Input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} /></div>
              <div className="col-span-2 flex items-center gap-2">
                <input type="checkbox" id="godown-def" checked={form.is_default} onChange={e => setForm({ ...form, is_default: e.target.checked })} />
                <Label htmlFor="godown-def" className="cursor-pointer">Set as default godown for this warehouse</Label>
              </div>
              <div className="col-span-2"><Label>Notes</Label><Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
            </div>
            <Button className="w-full mt-3" onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !form.warehouse_id || !form.name}>Save</Button>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Name</TableHead><TableHead>Warehouse</TableHead><TableHead>Code</TableHead>
            <TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {godowns.map(g => (
              <TableRow key={g.id}>
                <TableCell className="font-medium">
                  {g.name} {g.is_default && <Badge variant="outline" className="ml-2">Default</Badge>}
                </TableCell>
                <TableCell>{g.warehouse_name || "—"}</TableCell>
                <TableCell>{g.code || "—"}</TableCell>
                <TableCell>{g.is_active ? <Badge>Active</Badge> : <Badge variant="secondary">Inactive</Badge>}</TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setStockFor({ id: g.id, name: g.name })}><Boxes className="h-4 w-4 mr-2" />View Stock</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => startEdit(g)}>Edit</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => toggleActiveMut.mutate({ id: g.id, is_active: g.is_active })}>
                        {g.is_active ? "Deactivate" : "Reactivate"}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
            {!godowns.length && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No godowns yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
      {stockFor && (
        <LocationStockDialog
          open={!!stockFor}
          onOpenChange={(o) => !o && setStockFor(null)}
          title={`Stock — ${stockFor.name}`}
          queryKey={["godown-stock", stockFor.id]}
          fetchStock={() => godownService.stock(stockFor.id, dealerId)}
        />
      )}
    </Card>
  );
};

export default GodownsTab;
