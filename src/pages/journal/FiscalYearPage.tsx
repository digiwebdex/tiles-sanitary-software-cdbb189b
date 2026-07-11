import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useDealerId } from "@/hooks/useDealerId";
import {
  fiscalYearService, type FiscalYear,
} from "@/services/fiscalYearService";
import { journalService } from "@/services/financialService";
import { toast } from "@/hooks/use-toast";
import { Plus, CalendarRange, Lock, LockOpen, Star, Link2 } from "lucide-react";

const FiscalYearPage = () => {
  const dealerId = useDealerId();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", start_date: "", end_date: "", set_as_current: false });
  const [selectedFy, setSelectedFy] = useState<FiscalYear | null>(null);
  const [obDialogOpen, setObDialogOpen] = useState(false);
  const [obJournalId, setObJournalId] = useState("");
  const [reopenTarget, setReopenTarget] = useState<{ fyId: string; periodId: string } | null>(null);
  const [reopenReason, setReopenReason] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["fiscal-years", dealerId],
    queryFn: () => fiscalYearService.list(dealerId!),
    enabled: !!dealerId,
  });

  const { data: periodsData } = useQuery({
    queryKey: ["accounting-periods", dealerId, selectedFy?.id],
    queryFn: () => fiscalYearService.periods(dealerId!, selectedFy!.id),
    enabled: !!dealerId && !!selectedFy,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["fiscal-years"] });
    qc.invalidateQueries({ queryKey: ["accounting-periods"] });
  };

  const createMutation = useMutation({
    mutationFn: () => fiscalYearService.create(dealerId!, form),
    onSuccess: () => { toast({ title: "Fiscal year created" }); setOpen(false); setForm({ name: "", start_date: "", end_date: "", set_as_current: false }); invalidate(); },
    onError: (e: any) => toast({ title: "Create failed", description: e?.message, variant: "destructive" }),
  });

  const setCurrentMutation = useMutation({
    mutationFn: (id: string) => fiscalYearService.setCurrent(dealerId!, id),
    onSuccess: () => { toast({ title: "Current fiscal year updated" }); invalidate(); },
    onError: (e: any) => toast({ title: "Failed", description: e?.message, variant: "destructive" }),
  });

  const closePeriodMutation = useMutation({
    mutationFn: (periodId: string) => fiscalYearService.closePeriod(dealerId!, selectedFy!.id, periodId),
    onSuccess: () => { toast({ title: "Period closed" }); invalidate(); },
    onError: (e: any) => toast({ title: "Close failed", description: e?.message, variant: "destructive" }),
  });

  const reopenMutation = useMutation({
    mutationFn: () => fiscalYearService.reopenPeriod(dealerId!, reopenTarget!.fyId, reopenTarget!.periodId, reopenReason),
    onSuccess: () => { toast({ title: "Period reopened" }); setReopenTarget(null); setReopenReason(""); invalidate(); },
    onError: (e: any) => toast({ title: "Reopen failed", description: e?.message, variant: "destructive" }),
  });

  const setOpeningBalanceMutation = useMutation({
    mutationFn: async () => {
      // Confirm the journal entry exists and belongs to this dealer before linking.
      await journalService.get(dealerId!, obJournalId.trim());
      return fiscalYearService.setOpeningBalanceJournal(dealerId!, selectedFy!.id, obJournalId.trim());
    },
    onSuccess: () => { toast({ title: "Opening balance journal linked" }); setObDialogOpen(false); setObJournalId(""); invalidate(); },
    onError: (e: any) => toast({ title: "Link failed", description: e?.message, variant: "destructive" }),
  });

  const rows = data?.rows ?? [];
  const periods = periodsData?.rows ?? [];

  return (
    <div className="container mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2"><CalendarRange className="h-6 w-6" /> Fiscal Years</h1>
        <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-2" /> New Fiscal Year</Button>
      </div>

      <Card>
        <CardHeader><CardTitle>Fiscal Years</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? <p>Loading…</p> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead>End</TableHead>
                  <TableHead>Current</TableHead>
                  <TableHead>Opening Balance</TableHead>
                  <TableHead className="w-40"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((fy) => (
                  <TableRow key={fy.id} className={selectedFy?.id === fy.id ? "bg-muted/50" : ""}>
                    <TableCell className="font-medium">{fy.name}</TableCell>
                    <TableCell>{fy.start_date}</TableCell>
                    <TableCell>{fy.end_date}</TableCell>
                    <TableCell>{fy.is_current && <Badge>Current</Badge>}</TableCell>
                    <TableCell>{fy.opening_balance_journal_id ? <Badge variant="outline">Linked</Badge> : <span className="text-muted-foreground text-sm">Not set</span>}</TableCell>
                    <TableCell className="space-x-1">
                      <Button size="sm" variant="outline" onClick={() => setSelectedFy(fy)}>Periods</Button>
                      {!fy.is_current && (
                        <Button size="sm" variant="ghost" onClick={() => setCurrentMutation.mutate(fy.id)} title="Set current">
                          <Star className="h-4 w-4" />
                        </Button>
                      )}
                      {!fy.opening_balance_journal_id && (
                        <Button size="sm" variant="ghost" onClick={() => { setSelectedFy(fy); setObDialogOpen(true); }} title="Link opening balance journal entry">
                          <Link2 className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {!rows.length && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No fiscal years yet</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {selectedFy && (
        <Card>
          <CardHeader><CardTitle>Periods — {selectedFy.name}</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead>End</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-32"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {periods.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{p.period_no}</TableCell>
                    <TableCell>{p.start_date}</TableCell>
                    <TableCell>{p.end_date}</TableCell>
                    <TableCell>
                      <Badge variant={p.status === "closed" ? "secondary" : "default"}>{p.status}</Badge>
                    </TableCell>
                    <TableCell>
                      {p.status === "open" ? (
                        <Button size="sm" variant="outline" onClick={() => closePeriodMutation.mutate(p.id)}>
                          <Lock className="h-3 w-3 mr-1" /> Close
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => setReopenTarget({ fyId: selectedFy.id, periodId: p.id })}>
                          <LockOpen className="h-3 w-3 mr-1" /> Reopen
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {!periods.length && (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No periods</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Fiscal Year</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. FY 2026-27" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Start Date</Label><Input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} /></div>
              <div><Label>End Date</Label><Input type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} /></div>
            </div>
            <p className="text-xs text-muted-foreground">Monthly accounting periods will be created automatically for this range.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={createMutation.isPending}>Cancel</Button>
            <Button
              onClick={() => {
                if (!form.name.trim() || !form.start_date || !form.end_date) { toast({ title: "All fields are required", variant: "destructive" }); return; }
                createMutation.mutate();
              }}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={obDialogOpen} onOpenChange={setObDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Link Opening Balance Journal Entry</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Enter the ID of an existing, posted Journal Entry (dated on or before the fiscal year start) to use as this fiscal year's Opening Balance.</p>
            <div><Label>Journal Entry ID</Label><Input value={obJournalId} onChange={e => setObJournalId(e.target.value)} placeholder="UUID" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setObDialogOpen(false)} disabled={setOpeningBalanceMutation.isPending}>Cancel</Button>
            <Button onClick={() => setOpeningBalanceMutation.mutate()} disabled={!obJournalId.trim() || setOpeningBalanceMutation.isPending}>
              {setOpeningBalanceMutation.isPending ? "Linking…" : "Link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!reopenTarget} onOpenChange={(v) => { if (!v) { setReopenTarget(null); setReopenReason(""); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reopen Period</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Reason (required)</Label><Input value={reopenReason} onChange={e => setReopenReason(e.target.value)} placeholder="e.g. Correcting a posting error" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setReopenTarget(null); setReopenReason(""); }} disabled={reopenMutation.isPending}>Cancel</Button>
            <Button onClick={() => reopenMutation.mutate()} disabled={!reopenReason.trim() || reopenMutation.isPending}>
              {reopenMutation.isPending ? "Reopening…" : "Reopen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default FiscalYearPage;
