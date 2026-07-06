/**
 * Landed Cost — V2 Sprint 5E. List + create-against-a-posted-Purchase-
 * Invoice. Freight/Insurance/Customs Duty/VAT/Port/C&F/Local Transport/
 * Other Charges are allocated proportionally by line value once applied.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useDealerId } from "@/hooks/useDealerId";
import { landedCostSheetService, CHARGE_FIELDS, type LandedCostSheetFormData } from "@/services/landedCostSheetService";
import { purchaseService } from "@/services/purchaseService";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Search, Plus } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-muted text-muted-foreground" },
  applied: { label: "Applied", className: "bg-green-100 text-green-700" },
  cancelled: { label: "Cancelled", className: "bg-red-100 text-red-700" },
};

const emptyForm = (): Omit<LandedCostSheetFormData, "purchase_id"> => ({
  sheet_date: new Date().toISOString().slice(0, 10),
  freight_amount: 0, insurance_amount: 0, customs_duty_amount: 0, vat_amount: 0,
  port_charges_amount: 0, cf_charges_amount: 0, local_transport_amount: 0, other_charges_amount: 0,
  notes: "",
});

const LandedCostSheetsPage = () => {
  const dealerId = useDealerId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedPurchase, setSelectedPurchase] = useState<{ id: string; invoice_number: string | null } | null>(null);
  const [form, setForm] = useState(emptyForm());

  const { data: sheets = [], isLoading } = useQuery({
    queryKey: ["landed-cost-sheets", dealerId],
    queryFn: () => landedCostSheetService.list(dealerId),
    enabled: !!dealerId,
  });

  const { data: purchaseResults } = useQuery({
    queryKey: ["landed-cost-purchase-search", dealerId, search],
    queryFn: () => purchaseService.list(dealerId, 1, search),
    enabled: !!dealerId && !selectedPurchase && search.trim().length > 1,
  });

  const total = Object.entries(form).reduce((sum, [k, v]) => (k.endsWith("_amount") ? sum + (Number(v) || 0) : sum), 0);

  const createMutation = useMutation({
    mutationFn: () => landedCostSheetService.create(dealerId, { purchase_id: selectedPurchase!.id, ...form }),
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: ["landed-cost-sheets"] });
      toast.success("Landed cost sheet saved as draft");
      setOpen(false);
      setSelectedPurchase(null);
      setForm(emptyForm());
      navigate(`/landed-cost/${row.id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Landed Cost</h1>
          <p className="text-sm text-muted-foreground">Allocate freight, insurance, customs, and other import charges across a Purchase Invoice's lines.</p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> Create Sheet
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sheet No</TableHead>
                  <TableHead>Purchase Invoice</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total Charges</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>
                ) : sheets.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">No landed cost sheets yet</TableCell></TableRow>
                ) : (
                  sheets.map((s: any) => {
                    const badge = STATUS_BADGE[s.status] ?? STATUS_BADGE.draft;
                    return (
                      <TableRow key={s.id} className="cursor-pointer" onClick={() => navigate(`/landed-cost/${s.id}`)}>
                        <TableCell className="font-mono text-sm">{s.sheet_no}</TableCell>
                        <TableCell>{s.purchase_invoice_number ?? "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">{s.sheet_date}</TableCell>
                        <TableCell><Badge variant="secondary" className={badge.className}>{badge.label}</Badge></TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(Number(s.total_amount) || 0)}</TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Create Landed Cost Sheet</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="mb-1 block">Purchase Invoice</Label>
              {selectedPurchase ? (
                <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                  <span>{selectedPurchase.invoice_number ?? selectedPurchase.id}</span>
                  <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => setSelectedPurchase(null)}>Change</button>
                </div>
              ) : (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input placeholder="Search a posted purchase invoice…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
                  {search.trim().length > 1 && (purchaseResults?.data?.length ?? 0) > 0 && (
                    <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-md max-h-48 overflow-y-auto">
                      {purchaseResults!.data
                        .filter((p: any) => (p.document_status ?? "posted") === "posted")
                        .map((p: any) => (
                          <button key={p.id} type="button" className="block w-full text-left px-3 py-2 text-sm hover:bg-accent" onClick={() => { setSelectedPurchase({ id: p.id, invoice_number: p.invoice_number }); setSearch(""); }}>
                            {p.invoice_number ?? "—"} — {p.suppliers?.name ?? ""}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div>
              <Label className="mb-1 block">Sheet Date</Label>
              <Input type="date" value={form.sheet_date} onChange={(e) => setForm((f) => ({ ...f, sheet_date: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              {CHARGE_FIELDS.map((f) => (
                <div key={f.key}>
                  <Label className="mb-1 block text-xs">{f.label}</Label>
                  <Input
                    type="number" min={0} step="0.01"
                    value={(form as any)[f.key]}
                    onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: Number(e.target.value) }))}
                  />
                </div>
              ))}
            </div>
            <div className="text-right text-sm font-semibold">Total Charges: {formatCurrency(total)}</div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={createMutation.isPending || !selectedPurchase} onClick={() => createMutation.mutate()}>
              {createMutation.isPending ? "Saving…" : "Save as Draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default LandedCostSheetsPage;
