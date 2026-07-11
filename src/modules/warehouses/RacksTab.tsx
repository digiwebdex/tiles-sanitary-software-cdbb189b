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
import { rackService } from "@/services/rackService";
import type { Godown } from "@/services/godownService";
import LocationStockDialog from "@/modules/warehouses/LocationStockDialog";

const emptyForm = { godown_id: "", name: "", code: "", notes: "" };

/** V2 Sprint 3B — Rack Management: list, create/edit/delete, Rack→Godown link, Rack Status. */
const RacksTab = ({ godowns }: { godowns: Godown[] }) => {
  const dealerId = useDealerId();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [stockFor, setStockFor] = useState<{ id: string; name: string } | null>(null);

  const { data: racks = [] } = useQuery({
    queryKey: ["racks", dealerId], queryFn: () => rackService.list(dealerId), enabled: !!dealerId,
  });

  const saveMut = useMutation({
    mutationFn: () => editing
      ? rackService.update(editing, dealerId, form)
      : rackService.create(dealerId, form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["racks"] });
      setOpen(false); setEditing(null); setForm(emptyForm);
      toast.success(editing ? "Rack updated" : "Rack added");
    },
    onError: (e: any) => toast.error(e.message),
  });
  const toggleActiveMut = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      is_active ? rackService.remove(id, dealerId) : rackService.update(id, dealerId, { is_active: true }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["racks"] }); toast.success("Status updated"); },
    onError: (e: any) => toast.error(e.message),
  });

  const startEdit = (r: (typeof racks)[number]) => {
    setEditing(r.id);
    setForm({ godown_id: r.godown_id, name: r.name, code: r.code ?? "", notes: r.notes ?? "" });
    setOpen(true);
  };
  const startCreate = () => { setEditing(null); setForm(emptyForm); setOpen(true); };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Racks</CardTitle>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setEditing(null); setForm(emptyForm); } }}>
          <DialogTrigger asChild><Button onClick={startCreate}><Plus className="h-4 w-4 mr-2" />Add Rack</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editing ? "Edit Rack" : "New Rack"}</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Godown *</Label>
                <Select value={form.godown_id} onValueChange={(v) => setForm({ ...form, godown_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select godown" /></SelectTrigger>
                  <SelectContent>{godowns.map(g => <SelectItem key={g.id} value={g.id}>{g.name} ({g.warehouse_name})</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Name *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
              <div><Label>Code</Label><Input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} /></div>
              <div className="col-span-2"><Label>Notes</Label><Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
            </div>
            <Button className="w-full mt-3" onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !form.godown_id || !form.name}>Save</Button>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Name</TableHead><TableHead>Godown</TableHead><TableHead>Code</TableHead>
            <TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {racks.map(r => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell>{r.godown_name || "—"}</TableCell>
                <TableCell>{r.code || "—"}</TableCell>
                <TableCell>{r.is_active ? <Badge>Active</Badge> : <Badge variant="secondary">Inactive</Badge>}</TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setStockFor({ id: r.id, name: r.name })}><Boxes className="h-4 w-4 mr-2" />View Stock</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => startEdit(r)}>Edit</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => toggleActiveMut.mutate({ id: r.id, is_active: r.is_active })}>
                        {r.is_active ? "Deactivate" : "Reactivate"}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
            {!racks.length && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No racks yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
      {stockFor && (
        <LocationStockDialog
          open={!!stockFor}
          onOpenChange={(o) => !o && setStockFor(null)}
          title={`Stock — ${stockFor.name}`}
          queryKey={["rack-stock", stockFor.id]}
          fetchStock={() => rackService.stock(stockFor.id, dealerId)}
        />
      )}
    </Card>
  );
};

export default RacksTab;
