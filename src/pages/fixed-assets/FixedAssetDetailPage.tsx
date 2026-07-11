/**
 * Fixed Asset Detail — V2 Sprint 6D.
 * Depreciation schedule, "Run Depreciation" action, and "Dispose Asset"
 * action (Asset Disposal GL posting) live here.
 */
import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDealerId } from "@/hooks/useDealerId";
import { fixedAssetService } from "@/services/fixedAssetService";
import { toast } from "@/hooks/use-toast";
import { ArrowLeft, PlayCircle, XCircle } from "lucide-react";

const money = (n: number) => Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);

const FixedAssetDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const dealerId = useDealerId();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["fixed-asset", dealerId, id],
    queryFn: () => fixedAssetService.get(dealerId!, id!),
    enabled: !!dealerId && !!id,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["fixed-asset", dealerId, id] });
    qc.invalidateQueries({ queryKey: ["fixed-assets"] });
  };

  const runDepreciationMutation = useMutation({
    mutationFn: () => fixedAssetService.runDepreciation(dealerId!, id!),
    onSuccess: () => { toast({ title: "Depreciation posted" }); invalidate(); },
    onError: (e: any) => toast({ title: "Failed to run depreciation", description: e?.message, variant: "destructive" }),
  });

  const [disposeOpen, setDisposeOpen] = useState(false);
  const [disposeForm, setDisposeForm] = useState({ entry_date: today(), disposal_proceeds: "0", proceeds_via: "none" as "none" | "cash" | "bank", disposal_reason: "" });

  const disposeMutation = useMutation({
    mutationFn: () => fixedAssetService.dispose(dealerId!, id!, {
      entry_date: disposeForm.entry_date,
      disposal_proceeds: Number(disposeForm.disposal_proceeds) || 0,
      proceeds_via: disposeForm.proceeds_via === "none" ? null : { kind: disposeForm.proceeds_via },
      disposal_reason: disposeForm.disposal_reason.trim() || null,
    }),
    onSuccess: (r) => {
      toast({ title: `Asset disposed (${r.gain_loss >= 0 ? "gain" : "loss"}: ${money(Math.abs(r.gain_loss))})` });
      setDisposeOpen(false);
      invalidate();
    },
    onError: (e: any) => toast({ title: "Failed to dispose asset", description: e?.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="container mx-auto p-6"><p>Loading…</p></div>;
  if (!data) return <div className="container mx-auto p-6"><p>Asset not found.</p></div>;

  const { asset, schedule } = data;
  const bookValue = Number(asset.purchase_cost) - Number(asset.accumulated_depreciation);
  const isDisposed = asset.status === "disposed";

  return (
    <div className="container mx-auto p-6 space-y-4">
      <Button variant="ghost" onClick={() => navigate("/fixed-assets")}><ArrowLeft className="h-4 w-4 mr-2" /> Back to Register</Button>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{asset.name}</h1>
          <p className="text-muted-foreground font-mono">{asset.tag}</p>
        </div>
        <div className="flex gap-2">
          <Badge variant={isDisposed ? "secondary" : "default"} className="capitalize">{asset.status}</Badge>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Cost</p><p className="text-xl font-bold">{money(asset.purchase_cost)}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Accum. Depreciation</p><p className="text-xl font-bold">{money(asset.accumulated_depreciation)}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Book Value</p><p className="text-xl font-bold">{money(bookValue)}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Method</p><p className="text-xl font-bold capitalize">{asset.depreciation_method?.replace("_", " ") ?? "—"}</p></CardContent></Card>
      </div>

      {!isDisposed && (
        <div className="flex gap-2">
          <Button onClick={() => runDepreciationMutation.mutate()} disabled={runDepreciationMutation.isPending}>
            <PlayCircle className="h-4 w-4 mr-2" /> {runDepreciationMutation.isPending ? "Posting…" : "Run Depreciation"}
          </Button>
          <Button variant="destructive" onClick={() => setDisposeOpen(true)}>
            <XCircle className="h-4 w-4 mr-2" /> Dispose Asset
          </Button>
        </div>
      )}

      {isDisposed && (
        <Card>
          <CardContent className="pt-6 text-sm">
            <p>Disposed on {asset.disposed_at?.slice(0, 10)} — proceeds {money(asset.disposal_proceeds ?? 0)}</p>
            {asset.disposal_reason && <p className="text-muted-foreground">{asset.disposal_reason}</p>}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Depreciation Schedule ({schedule.length})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead>Period Start</TableHead>
                <TableHead>Period End</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Accumulated</TableHead>
                <TableHead className="text-right">Book Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {schedule.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>{s.period_no}</TableCell>
                  <TableCell>{s.period_start}</TableCell>
                  <TableCell>{s.period_end}</TableCell>
                  <TableCell className="text-right">{money(s.depreciation_amount)}</TableCell>
                  <TableCell className="text-right">{money(s.accumulated_after)}</TableCell>
                  <TableCell className="text-right">{money(s.book_value_after)}</TableCell>
                </TableRow>
              ))}
              {!schedule.length && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No depreciation posted yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={disposeOpen} onOpenChange={setDisposeOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Dispose Asset</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Current book value: <strong>{money(bookValue)}</strong></p>
            <div><Label>Disposal Date</Label><Input type="date" value={disposeForm.entry_date} onChange={e => setDisposeForm({ ...disposeForm, entry_date: e.target.value })} /></div>
            <div><Label>Disposal Proceeds</Label><Input type="number" value={disposeForm.disposal_proceeds} onChange={e => setDisposeForm({ ...disposeForm, disposal_proceeds: e.target.value })} placeholder="0.00" /></div>
            {Number(disposeForm.disposal_proceeds) > 0 && (
              <div>
                <Label>Proceeds Received Via</Label>
                <Select value={disposeForm.proceeds_via} onValueChange={(v: any) => setDisposeForm({ ...disposeForm, proceeds_via: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="bank">Bank</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div><Label>Reason (optional)</Label><Textarea value={disposeForm.disposal_reason} onChange={e => setDisposeForm({ ...disposeForm, disposal_reason: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisposeOpen(false)} disabled={disposeMutation.isPending}>Cancel</Button>
            <Button variant="destructive" onClick={() => disposeMutation.mutate()} disabled={disposeMutation.isPending}>
              {disposeMutation.isPending ? "Disposing…" : "Confirm Disposal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default FixedAssetDetailPage;
