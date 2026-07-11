/**
 * VAT Closing — V2 Sprint 6E.
 * Reuses the existing VAT Engine (Mushak 6.1/6.3 registers) via
 * vatClosingService.ts — see that service and its backend route for why
 * this is a compliance record, not a GL/cash posting.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useDealerId } from "@/hooks/useDealerId";
import { vatClosingService } from "@/services/vatClosingService";
import { toast } from "@/hooks/use-toast";
import { Receipt, Info } from "lucide-react";

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const firstOfMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; };
const today = () => new Date().toISOString().slice(0, 10);

const VatClosingPage = () => {
  const dealerId = useDealerId();
  const qc = useQueryClient();
  const [period, setPeriod] = useState({ from: firstOfMonth(), to: today() });
  const [notes, setNotes] = useState("");

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ["vat-summary", dealerId, period],
    queryFn: () => vatClosingService.summary(dealerId, period.from, period.to),
    enabled: !!dealerId,
  });

  const { data: draft } = useQuery({
    queryKey: ["mushak-9-1", dealerId, period],
    queryFn: () => vatClosingService.mushak91Draft(dealerId, period.from, period.to),
    enabled: !!dealerId,
  });

  const { data: history } = useQuery({
    queryKey: ["vat-closing-history", dealerId],
    queryFn: () => vatClosingService.history(dealerId),
    enabled: !!dealerId,
  });

  const closeMutation = useMutation({
    mutationFn: () => vatClosingService.close(dealerId, { period_start: period.from, period_end: period.to, notes: notes.trim() || null }),
    onSuccess: () => {
      toast({ title: "VAT period closed" });
      setNotes("");
      qc.invalidateQueries({ queryKey: ["vat-closing-history"] });
    },
    onError: (e: any) => toast({ title: "Failed to close VAT period", description: e?.message, variant: "destructive" }),
  });

  return (
    <div className="container mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-bold flex items-center gap-2"><Receipt className="h-6 w-6" /> VAT Closing</h1>

      <Card>
        <CardContent className="pt-6 flex flex-wrap gap-3 items-end">
          <div><Label>From</Label><Input type="date" value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} /></div>
          <div><Label>To</Label><Input type="date" value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} /></div>
        </CardContent>
      </Card>

      <Tabs defaultValue="summary">
        <TabsList>
          <TabsTrigger value="summary">Summary &amp; Reconciliation</TabsTrigger>
          <TabsTrigger value="mushak">Mushak 9.1 Draft</TabsTrigger>
          <TabsTrigger value="history">Closing History</TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="space-y-4 mt-4">
          {summaryLoading ? <p>Loading…</p> : summary && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Output VAT+SD ({summary.output_vat_summary.invoice_count} invoices)</p><p className="text-2xl font-bold">{money(summary.reconciliation.output_tax)}</p></CardContent></Card>
                <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Input VAT+SD ({summary.input_vat_summary.invoice_count} invoices)</p><p className="text-2xl font-bold">{money(summary.reconciliation.input_tax)}</p></CardContent></Card>
                <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Net {summary.reconciliation.position === "payable" ? "Payable" : "Refundable"}</p><p className={`text-2xl font-bold ${summary.reconciliation.position === "payable" ? "text-destructive" : "text-emerald-600"}`}>{money(Math.abs(summary.reconciliation.net_payable))}</p></CardContent></Card>
              </div>

              <Card>
                <CardHeader><CardTitle>Output VAT Summary (Mushak 6.3)</CardTitle></CardHeader>
                <CardContent>
                  <Table>
                    <TableBody>
                      <TableRow><TableCell>Taxable Supplies</TableCell><TableCell className="text-right font-mono">{money(summary.output_vat_summary.taxable)}</TableCell></TableRow>
                      <TableRow><TableCell>VAT</TableCell><TableCell className="text-right font-mono">{money(summary.output_vat_summary.vat)}</TableCell></TableRow>
                      <TableRow><TableCell>SD</TableCell><TableCell className="text-right font-mono">{money(summary.output_vat_summary.sd)}</TableCell></TableRow>
                      <TableRow className="border-t font-semibold"><TableCell>Total</TableCell><TableCell className="text-right font-mono">{money(summary.output_vat_summary.total)}</TableCell></TableRow>
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>Input VAT Summary (Mushak 6.1)</CardTitle></CardHeader>
                <CardContent>
                  <Table>
                    <TableBody>
                      <TableRow><TableCell>Taxable Purchases</TableCell><TableCell className="text-right font-mono">{money(summary.input_vat_summary.taxable)}</TableCell></TableRow>
                      <TableRow><TableCell>VAT</TableCell><TableCell className="text-right font-mono">{money(summary.input_vat_summary.vat)}</TableCell></TableRow>
                      <TableRow><TableCell>SD</TableCell><TableCell className="text-right font-mono">{money(summary.input_vat_summary.sd)}</TableCell></TableRow>
                      <TableRow className="border-t font-semibold"><TableCell>Total</TableCell><TableCell className="text-right font-mono">{money(summary.input_vat_summary.total)}</TableCell></TableRow>
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>Close This VAT Period</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">Records the period's net VAT position as a compliance closing entry. Does not post to the GL or record a payment — see the note on the History tab.</p>
                  <div><Label>Notes (optional)</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
                  <Button onClick={() => closeMutation.mutate()} disabled={closeMutation.isPending}>
                    {closeMutation.isPending ? "Closing…" : "Close VAT Period"}
                  </Button>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="mushak" className="space-y-4 mt-4">
          {draft && (
            <>
              <Alert>
                <Info className="h-4 w-4" />
                <AlertTitle>Internal draft only</AlertTitle>
                <AlertDescription>{draft.disclaimer}</AlertDescription>
              </Alert>
              <Card>
                <CardHeader><CardTitle>Mushak 9.1 Draft — {draft.period.from} to {draft.period.to}</CardTitle></CardHeader>
                <CardContent>
                  <Table>
                    <TableBody>
                      <TableRow><TableCell>Total Taxable Supplies</TableCell><TableCell className="text-right font-mono">{money(draft.total_taxable_supplies)}</TableCell></TableRow>
                      <TableRow><TableCell>Total Output Tax</TableCell><TableCell className="text-right font-mono">{money(draft.total_output_tax)}</TableCell></TableRow>
                      <TableRow><TableCell>Total Taxable Purchases</TableCell><TableCell className="text-right font-mono">{money(draft.total_taxable_purchases)}</TableCell></TableRow>
                      <TableRow><TableCell>Total Input Tax Credit</TableCell><TableCell className="text-right font-mono">{money(draft.total_input_tax_credit)}</TableCell></TableRow>
                      <TableRow className="border-t font-semibold"><TableCell>Net VAT Payable</TableCell><TableCell className="text-right font-mono">{money(draft.net_vat_payable)}</TableCell></TableRow>
                      <TableRow><TableCell>Net VAT Refundable</TableCell><TableCell className="text-right font-mono">{money(draft.net_vat_refundable)}</TableCell></TableRow>
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="history" className="space-y-4 mt-4">
          <Card>
            <CardHeader><CardTitle>VAT Closing History</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-right">Output</TableHead>
                    <TableHead className="text-right">Input</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                    <TableHead>Closed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(history?.rows ?? []).map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{r.period_start} – {r.period_end}</TableCell>
                      <TableCell className="text-right font-mono">{money(r.output_vat_total + r.output_sd_total)}</TableCell>
                      <TableCell className="text-right font-mono">{money(r.input_vat_total + r.input_sd_total)}</TableCell>
                      <TableCell className="text-right font-mono">
                        <Badge variant={r.net_payable >= 0 ? "destructive" : "secondary"}>{money(Math.abs(r.net_payable))} {r.net_payable >= 0 ? "payable" : "refundable"}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">{new Date(r.closed_at).toLocaleDateString()}</TableCell>
                    </TableRow>
                  ))}
                  {!(history?.rows ?? []).length && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No VAT periods closed yet.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default VatClosingPage;
