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
import { binService } from "@/services/binService";
import type { Rack } from "@/services/rackService";

const emptyForm = { rack_id: "", bin_code: "", storage_location: "", rack_position: "" };

/** V2 Sprint 3B — Bin / Storage Location: bin code, storage location, rack position. */
const BinsTab = ({ racks }: { racks: Rack[] }) => {
  const dealerId = useDealerId();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  const { data: bins = [] } = useQuery({
    queryKey: ["bins", dealerId], queryFn: () => binService.list(dealerId), enabled: !!dealerId,
  });

  const saveMut = useMutation({
    mutationFn: () => editing
      ? binService.update(editing, dealerId, form)
      : binService.create(dealerId, form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bins"] });
      setOpen(false); setEditing(null); setForm(emptyForm);
      toast.success(editing ? "Bin updated" : "Bin added");
    },
    onError: (e: any) => toast.error(e.message),
  });
  const toggleActiveMut = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      is_active ? binService.remove(id, dealerId) : binService.update(id, dealerId, { is_active: true }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["bins"] }); toast.success("Status updated"); },
    onError: (e: any) => toast.error(e.message),
  });

  const startEdit = (b: (typeof bins)[number]) => {
    setEditing(b.id);
    setForm({ rack_id: b.rack_id, bin_code: b.bin_code, storage_location: b.storage_location ?? "", rack_position: b.rack_position ?? "" });
    setOpen(true);
  };
  const startCreate = () => { setEditing(null); setForm(emptyForm); setOpen(true); };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Bins / Storage Locations</CardTitle>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setEditing(null); setForm(emptyForm); } }}>
          <DialogTrigger asChild><Button onClick={startCreate}><Plus className="h-4 w-4 mr-2" />Add Bin</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editing ? "Edit Bin" : "New Bin"}</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Rack *</Label>
                <Select value={form.rack_id} onValueChange={(v) => setForm({ ...form, rack_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select rack" /></SelectTrigger>
                  <SelectContent>{racks.map(r => <SelectItem key={r.id} value={r.id}>{r.name} ({r.godown_name})</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Bin Code *</Label><Input value={form.bin_code} onChange={e => setForm({ ...form, bin_code: e.target.value })} /></div>
              <div><Label>Rack Position</Label><Input value={form.rack_position} onChange={e => setForm({ ...form, rack_position: e.target.value })} placeholder="e.g. A1, Row 2" /></div>
              <div className="col-span-2"><Label>Storage Location</Label><Input value={form.storage_location} onChange={e => setForm({ ...form, storage_location: e.target.value })} placeholder="e.g. Aisle 3, Shelf 2" /></div>
            </div>
            <Button className="w-full mt-3" onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !form.rack_id || !form.bin_code}>Save</Button>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Bin Code</TableHead><TableHead>Rack</TableHead><TableHead>Storage Location</TableHead>
            <TableHead>Position</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {bins.map(b => (
              <TableRow key={b.id}>
                <TableCell className="font-medium">{b.bin_code}</TableCell>
                <TableCell>{b.rack_name || "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{b.storage_location || "—"}</TableCell>
                <TableCell>{b.rack_position || "—"}</TableCell>
                <TableCell>{b.is_active ? <Badge>Active</Badge> : <Badge variant="secondary">Inactive</Badge>}</TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => startEdit(b)}>Edit</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => toggleActiveMut.mutate({ id: b.id, is_active: b.is_active })}>
                        {b.is_active ? "Deactivate" : "Reactivate"}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
            {!bins.length && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No bins yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};

export default BinsTab;
