import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDealerId } from "@/hooks/useDealerId";
import { journalService, type JournalLine, type JournalEntryStatus } from "@/services/financialService";
import { formatCurrency } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { Plus, Trash2, BookOpen, MoreVertical, Check, Send, Undo2 } from "lucide-react";

const today = () => new Date().toISOString().slice(0, 10);
const emptyLine = (): JournalLine => ({ account: "", debit: 0, credit: 0, line_narration: "" });

const STATUS_BADGE: Record<JournalEntryStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-muted text-muted-foreground" },
  approved: { label: "Approved", className: "bg-blue-100 text-blue-700" },
  posted: { label: "Posted", className: "bg-green-100 text-green-700" },
};

const JournalPage = () => {
  const dealerId = useDealerId();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<{ from: string; to: string; status: string }>({ from: "", to: "", status: "" });
  const [form, setForm] = useState({ entry_date: today(), narration: "", lines: [emptyLine(), emptyLine()] });
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["journal", dealerId, filter],
    queryFn: () => journalService.list(dealerId!, {
      from: filter.from || undefined,
      to: filter.to || undefined,
      status: (filter.status || undefined) as JournalEntryStatus | undefined,
      limit: 100,
    }),
    enabled: !!dealerId,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["journal"] });
    qc.invalidateQueries({ queryKey: ["trial-balance"] });
  };

  const updateLine = (idx: number, patch: Partial<JournalLine>) => {
    setForm(f => ({ ...f, lines: f.lines.map((l, i) => i === idx ? { ...l, ...patch } : l) }));
  };
  const addLine = () => setForm(f => ({ ...f, lines: [...f.lines, emptyLine()] }));
  const removeLine = (idx: number) => setForm(f => ({ ...f, lines: f.lines.filter((_, i) => i !== idx) }));

  const totalDebit = form.lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredit = form.lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.01 && totalDebit > 0;

  const buildPayload = () => {
    const cleanedLines = form.lines.filter(l => l.account.trim() && (Number(l.debit) > 0 || Number(l.credit) > 0));
    return {
      entry_date: form.entry_date,
      narration: form.narration,
      lines: cleanedLines.map(l => ({ ...l, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 })),
    };
  };

  const resetForm = () => {
    setOpen(false);
    setForm({ entry_date: today(), narration: "", lines: [emptyLine(), emptyLine()] });
  };

  const handleSaveDraft = async () => {
    if (!dealerId) return;
    const payload = buildPayload();
    if (payload.lines.length < 2) { toast({ title: "At least 2 lines required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      await journalService.createDraft(dealerId, payload);
      toast({ title: "Saved as draft" });
      resetForm();
      invalidate();
    } catch (e: any) {
      toast({ title: "Save failed", description: e?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAndPost = async () => {
    if (!dealerId) return;
    if (!balanced) { toast({ title: "Unbalanced entry", description: "Debit must equal Credit and totals must be > 0.", variant: "destructive" }); return; }
    const payload = buildPayload();
    if (payload.lines.length < 2) { toast({ title: "At least 2 lines required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      await journalService.create(dealerId, payload);
      toast({ title: "Journal entry posted" });
      resetForm();
      invalidate();
    } catch (e: any) {
      toast({ title: "Post failed", description: e?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!dealerId || !confirm("Delete this draft?")) return;
    try {
      await journalService.remove(dealerId, id);
      toast({ title: "Draft deleted" });
      invalidate();
    } catch (e: any) {
      toast({ title: "Delete failed", description: e?.message, variant: "destructive" });
    }
  };

  const handleApprove = async (id: string) => {
    if (!dealerId) return;
    try {
      await journalService.approve(dealerId, id);
      toast({ title: "Entry approved" });
      invalidate();
    } catch (e: any) {
      toast({ title: "Approve failed", description: e?.message, variant: "destructive" });
    }
  };

  const handlePost = async (id: string) => {
    if (!dealerId) return;
    try {
      await journalService.post(dealerId, id);
      toast({ title: "Entry posted" });
      invalidate();
    } catch (e: any) {
      toast({ title: "Post failed", description: e?.message, variant: "destructive" });
    }
  };

  const handleReverse = async (id: string) => {
    if (!dealerId || !confirm("Reverse this posted entry? A new, mirrored entry will be created — the original stays in the record unchanged.")) return;
    try {
      await journalService.reverse(dealerId, id);
      toast({ title: "Reversal entry created" });
      invalidate();
    } catch (e: any) {
      toast({ title: "Reverse failed", description: e?.message, variant: "destructive" });
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2"><BookOpen className="h-6 w-6" /> Journal Entries</h1>
        <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-2" /> New Entry</Button>
      </div>

      <Card>
        <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div><Label>From</Label><Input type="date" value={filter.from} onChange={e => setFilter({ ...filter, from: e.target.value })} /></div>
          <div><Label>To</Label><Input type="date" value={filter.to} onChange={e => setFilter({ ...filter, to: e.target.value })} /></div>
          <div>
            <Label>Status</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={filter.status}
              onChange={e => setFilter({ ...filter, status: e.target.value })}
            >
              <option value="">All statuses</option>
              <option value="draft">Draft</option>
              <option value="approved">Approved</option>
              <option value="posted">Posted</option>
            </select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Entries {data ? `(${data.total})` : ""}</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? <p>Loading…</p> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Voucher</TableHead>
                  <TableHead>Narration</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.rows.map((r: any) => {
                  const status: JournalEntryStatus = r.status ?? "posted";
                  const badge = STATUS_BADGE[status] ?? STATUS_BADGE.posted;
                  return (
                    <TableRow key={r.id}>
                      <TableCell>{r.entry_date}</TableCell>
                      <TableCell className="font-mono">{r.voucher_no}</TableCell>
                      <TableCell className="max-w-md truncate text-muted-foreground">
                        {r.narration || "—"}
                        {r.reversed_by_journal_entry_id && <span className="ml-2 text-xs text-orange-600">(reversed)</span>}
                      </TableCell>
                      <TableCell><Badge variant="secondary" className={badge.className}>{badge.label}</Badge></TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(Number(r.total_debit) || 0)}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(Number(r.total_credit) || 0)}</TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="icon" variant="ghost"><MoreVertical className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {status === "draft" && (
                              <>
                                <DropdownMenuItem onClick={() => handleApprove(r.id)}><Check className="h-4 w-4 mr-2" /> Approve</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handlePost(r.id)}><Send className="h-4 w-4 mr-2" /> Post</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleDelete(r.id)} className="text-destructive"><Trash2 className="h-4 w-4 mr-2" /> Delete Draft</DropdownMenuItem>
                              </>
                            )}
                            {status === "approved" && (
                              <DropdownMenuItem onClick={() => handlePost(r.id)}><Send className="h-4 w-4 mr-2" /> Post</DropdownMenuItem>
                            )}
                            {status === "posted" && !r.reversed_by_journal_entry_id && (
                              <DropdownMenuItem onClick={() => handleReverse(r.id)}><Undo2 className="h-4 w-4 mr-2" /> Reverse</DropdownMenuItem>
                            )}
                            {status === "posted" && r.reversed_by_journal_entry_id && (
                              <DropdownMenuItem disabled>Already reversed</DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {!data?.rows.length && (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No entries yet</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={(v) => { if (!v) resetForm(); else setOpen(true); }}>
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle>New Journal Entry</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div><Label>Date</Label><Input type="date" value={form.entry_date} onChange={e => setForm({ ...form, entry_date: e.target.value })} /></div>
              <div><Label>Narration</Label><Input value={form.narration} onChange={e => setForm({ ...form, narration: e.target.value })} placeholder="e.g. Opening balance adjustment" /></div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Lines</Label>
                <Button size="sm" variant="outline" onClick={addLine}><Plus className="h-3 w-3 mr-1" /> Add Line</Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account</TableHead>
                    <TableHead>Note</TableHead>
                    <TableHead className="text-right w-32">Debit</TableHead>
                    <TableHead className="text-right w-32">Credit</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {form.lines.map((l, i) => (
                    <TableRow key={i}>
                      <TableCell><Input value={l.account} onChange={e => updateLine(i, { account: e.target.value })} placeholder="e.g. Cash on Hand" /></TableCell>
                      <TableCell><Input value={l.line_narration ?? ""} onChange={e => updateLine(i, { line_narration: e.target.value })} /></TableCell>
                      <TableCell><Input type="number" step="0.01" className="text-right font-mono" value={l.debit || ""} onChange={e => updateLine(i, { debit: Number(e.target.value) || 0, credit: 0 })} /></TableCell>
                      <TableCell><Input type="number" step="0.01" className="text-right font-mono" value={l.credit || ""} onChange={e => updateLine(i, { credit: Number(e.target.value) || 0, debit: 0 })} /></TableCell>
                      <TableCell><Button size="icon" variant="ghost" disabled={form.lines.length <= 2} onClick={() => removeLine(i)}><Trash2 className="h-4 w-4" /></Button></TableCell>
                    </TableRow>
                  ))}
                  <TableRow className={balanced ? "bg-emerald-500/10" : "bg-red-500/10"}>
                    <TableCell colSpan={2} className="font-bold">Totals {balanced ? "✓ balanced" : "✗ unbalanced"}</TableCell>
                    <TableCell className="text-right font-mono font-bold">{formatCurrency(totalDebit)}</TableCell>
                    <TableCell className="text-right font-mono font-bold">{formatCurrency(totalCredit)}</TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetForm} disabled={saving}>Cancel</Button>
            <Button variant="secondary" onClick={handleSaveDraft} disabled={saving}>{saving ? "Saving…" : "Save as Draft"}</Button>
            <Button onClick={handleSaveAndPost} disabled={saving || !balanced}>{saving ? "Posting…" : "Save & Post"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default JournalPage;
