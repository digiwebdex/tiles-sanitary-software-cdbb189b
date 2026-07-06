/**
 * Import LC — V2 Sprint 5E. BDT-only paperwork/status tracker: Proforma
 * Invoice -> Letter of Credit -> Shipment (+ Containers) -> Customs
 * Clearance. None of this existed before this sprint. Not wired into
 * stock/financial posting — a Shipment may optionally cross-reference the
 * Purchase Invoice it eventually became, for compliance paperwork only.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useDealerId } from "@/hooks/useDealerId";
import { importLcService } from "@/services/importLcService";
import { supplierService } from "@/services/supplierService";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Search, Plus } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

function SupplierPicker({ dealerId, value, onChange }: { dealerId: string; value: { id: string; name: string } | null; onChange: (s: { id: string; name: string } | null) => void }) {
  const [search, setSearch] = useState("");
  const { data } = useQuery({
    queryKey: ["import-lc-supplier-search", dealerId, search],
    queryFn: () => supplierService.list(dealerId, search, 1),
    enabled: !!dealerId && !value && search.trim().length > 1,
  });
  if (value) {
    return (
      <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
        <span>{value.name}</span>
        <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => onChange(null)}>Change</button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input placeholder="Search a supplier…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      {search.trim().length > 1 && (data?.data?.length ?? 0) > 0 && (
        <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-md max-h-48 overflow-y-auto">
          {data!.data.map((s: any) => (
            <button key={s.id} type="button" className="block w-full text-left px-3 py-2 text-sm hover:bg-accent" onClick={() => { onChange({ id: s.id, name: s.name }); setSearch(""); }}>
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const PI_STATUS_BADGE: Record<string, string> = { draft: "bg-muted text-muted-foreground", confirmed: "bg-green-100 text-green-700", cancelled: "bg-red-100 text-red-700" };
const LC_STATUS_BADGE: Record<string, string> = { draft: "bg-muted text-muted-foreground", opened: "bg-blue-100 text-blue-700", amended: "bg-orange-100 text-orange-700", closed: "bg-green-100 text-green-700", cancelled: "bg-red-100 text-red-700" };
const SHIPMENT_STATUS_BADGE: Record<string, string> = { in_transit: "bg-blue-100 text-blue-700", arrived: "bg-orange-100 text-orange-700", customs_clearance: "bg-yellow-100 text-yellow-700", cleared: "bg-green-100 text-green-700", cancelled: "bg-red-100 text-red-700" };

function ProformaInvoicesTab({ dealerId }: { dealerId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [supplier, setSupplier] = useState<{ id: string; name: string } | null>(null);
  const [piNumber, setPiNumber] = useState("");
  const [piDate, setPiDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [totalAmount, setTotalAmount] = useState("0");
  const [currencyNote, setCurrencyNote] = useState("");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["import-lc-pi", dealerId],
    queryFn: () => importLcService.proformaInvoices.list(dealerId),
    enabled: !!dealerId,
  });

  const createMutation = useMutation({
    mutationFn: () => importLcService.proformaInvoices.create(dealerId, {
      supplier_id: supplier!.id, pi_number: piNumber, pi_date: piDate,
      total_amount: Number(totalAmount) || 0, currency_note: currencyNote || null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["import-lc-pi"] });
      toast.success("Proforma invoice recorded");
      setOpen(false); setSupplier(null); setPiNumber(""); setTotalAmount("0"); setCurrencyNote("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" /> New Proforma Invoice</Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>PI No</TableHead><TableHead>Supplier</TableHead><TableHead>Date</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Amount (BDT)</TableHead></TableRow></TableHeader>
            <TableBody>
              {isLoading ? <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>
                : rows.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">No proforma invoices yet</TableCell></TableRow>
                : rows.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-sm">{r.pi_number}</TableCell>
                    <TableCell>{r.supplier_name ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{r.pi_date}</TableCell>
                    <TableCell><Badge variant="secondary" className={PI_STATUS_BADGE[r.status]}>{r.status}</Badge></TableCell>
                    <TableCell className="text-right">{formatCurrency(Number(r.total_amount) || 0)}{r.currency_note ? <div className="text-xs text-muted-foreground">{r.currency_note}</div> : null}</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>New Proforma Invoice</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label className="mb-1 block">Supplier</Label><SupplierPicker dealerId={dealerId} value={supplier} onChange={setSupplier} /></div>
            <div><Label className="mb-1 block">PI Number</Label><Input value={piNumber} onChange={(e) => setPiNumber(e.target.value)} /></div>
            <div><Label className="mb-1 block">PI Date</Label><Input type="date" value={piDate} onChange={(e) => setPiDate(e.target.value)} /></div>
            <div><Label className="mb-1 block">Total Amount (BDT)</Label><Input type="number" min={0} step="0.01" value={totalAmount} onChange={(e) => setTotalAmount(e.target.value)} /></div>
            <div><Label className="mb-1 block">Currency Note (optional)</Label><Input placeholder="e.g. USD 12,000 @ approx 118.50" value={currencyNote} onChange={(e) => setCurrencyNote(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={createMutation.isPending || !supplier || !piNumber.trim()} onClick={() => createMutation.mutate()}>{createMutation.isPending ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LettersOfCreditTab({ dealerId }: { dealerId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [supplier, setSupplier] = useState<{ id: string; name: string } | null>(null);
  const [lcNumber, setLcNumber] = useState("");
  const [lcDate, setLcDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [issuingBank, setIssuingBank] = useState("");
  const [lcAmount, setLcAmount] = useState("0");
  const [expiryDate, setExpiryDate] = useState("");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["import-lc-lc", dealerId],
    queryFn: () => importLcService.lettersOfCredit.list(dealerId),
    enabled: !!dealerId,
  });

  const createMutation = useMutation({
    mutationFn: () => importLcService.lettersOfCredit.create(dealerId, {
      supplier_id: supplier!.id, lc_number: lcNumber, lc_date: lcDate,
      issuing_bank: issuingBank || null, lc_amount: Number(lcAmount) || 0, expiry_date: expiryDate || null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["import-lc-lc"] });
      toast.success("Letter of credit recorded");
      setOpen(false); setSupplier(null); setLcNumber(""); setIssuingBank(""); setLcAmount("0"); setExpiryDate("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" /> New Letter of Credit</Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>LC No</TableHead><TableHead>Supplier</TableHead><TableHead>Bank</TableHead><TableHead>Date</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Amount (BDT)</TableHead></TableRow></TableHeader>
            <TableBody>
              {isLoading ? <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>
                : rows.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">No letters of credit yet</TableCell></TableRow>
                : rows.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-sm">{r.lc_number}</TableCell>
                    <TableCell>{r.supplier_name ?? "—"}</TableCell>
                    <TableCell>{r.issuing_bank ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{r.lc_date}</TableCell>
                    <TableCell><Badge variant="secondary" className={LC_STATUS_BADGE[r.status]}>{r.status}</Badge></TableCell>
                    <TableCell className="text-right">{formatCurrency(Number(r.lc_amount) || 0)}</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>New Letter of Credit</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label className="mb-1 block">Supplier</Label><SupplierPicker dealerId={dealerId} value={supplier} onChange={setSupplier} /></div>
            <div><Label className="mb-1 block">LC Number</Label><Input value={lcNumber} onChange={(e) => setLcNumber(e.target.value)} /></div>
            <div><Label className="mb-1 block">LC Date</Label><Input type="date" value={lcDate} onChange={(e) => setLcDate(e.target.value)} /></div>
            <div><Label className="mb-1 block">Issuing Bank</Label><Input value={issuingBank} onChange={(e) => setIssuingBank(e.target.value)} /></div>
            <div><Label className="mb-1 block">LC Amount (BDT)</Label><Input type="number" min={0} step="0.01" value={lcAmount} onChange={(e) => setLcAmount(e.target.value)} /></div>
            <div><Label className="mb-1 block">Expiry Date</Label><Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={createMutation.isPending || !supplier || !lcNumber.trim()} onClick={() => createMutation.mutate()}>{createMutation.isPending ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ShipmentsTab({ dealerId }: { dealerId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [supplier, setSupplier] = useState<{ id: string; name: string } | null>(null);
  const [shipmentRef, setShipmentRef] = useState("");
  const [vesselName, setVesselName] = useState("");
  const [portLoading, setPortLoading] = useState("");
  const [portDischarge, setPortDischarge] = useState("");
  const [etaDate, setEtaDate] = useState("");
  const [cfAgentName, setCfAgentName] = useState("");
  const [containerNo, setContainerNo] = useState("");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["import-lc-shipments", dealerId],
    queryFn: () => importLcService.shipments.list(dealerId),
    enabled: !!dealerId,
  });

  const createMutation = useMutation({
    mutationFn: () => importLcService.shipments.create(dealerId, {
      supplier_id: supplier!.id, shipment_ref: shipmentRef, vessel_name: vesselName || null,
      port_of_loading: portLoading || null, port_of_discharge: portDischarge || null,
      eta_date: etaDate || null, cf_agent_name: cfAgentName || null,
      containers: containerNo.trim() ? [{ container_no: containerNo.trim() }] : [],
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["import-lc-shipments"] });
      toast.success("Shipment recorded");
      setOpen(false); setSupplier(null); setShipmentRef(""); setVesselName(""); setPortLoading(""); setPortDischarge(""); setEtaDate(""); setCfAgentName(""); setContainerNo("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" /> New Shipment</Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Shipment Ref</TableHead><TableHead>Supplier</TableHead><TableHead>Port (Loading → Discharge)</TableHead><TableHead>ETA</TableHead><TableHead>C&F Agent</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {isLoading ? <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>
                  : rows.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">No shipments yet</TableCell></TableRow>
                  : rows.map((r: any) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-sm">{r.shipment_ref}</TableCell>
                      <TableCell>{r.supplier_name ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{[r.port_of_loading, r.port_of_discharge].filter(Boolean).join(" → ") || "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">{r.eta_date ?? "—"}</TableCell>
                      <TableCell>{r.cf_agent_name ?? "—"}</TableCell>
                      <TableCell><Badge variant="secondary" className={SHIPMENT_STATUS_BADGE[r.status]}>{r.status.replace("_", " ")}</Badge></TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New Shipment</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label className="mb-1 block">Supplier</Label><SupplierPicker dealerId={dealerId} value={supplier} onChange={setSupplier} /></div>
            <div><Label className="mb-1 block">Shipment Reference</Label><Input value={shipmentRef} onChange={(e) => setShipmentRef(e.target.value)} /></div>
            <div><Label className="mb-1 block">Vessel Name</Label><Input value={vesselName} onChange={(e) => setVesselName(e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="mb-1 block">Port of Loading</Label><Input value={portLoading} onChange={(e) => setPortLoading(e.target.value)} /></div>
              <div><Label className="mb-1 block">Port of Discharge</Label><Input value={portDischarge} onChange={(e) => setPortDischarge(e.target.value)} /></div>
            </div>
            <div><Label className="mb-1 block">ETA</Label><Input type="date" value={etaDate} onChange={(e) => setEtaDate(e.target.value)} /></div>
            <div><Label className="mb-1 block">C&F Agent</Label><Input value={cfAgentName} onChange={(e) => setCfAgentName(e.target.value)} /></div>
            <div><Label className="mb-1 block">Container No (optional)</Label><Input value={containerNo} onChange={(e) => setContainerNo(e.target.value)} placeholder="Add more from the shipment's own detail later" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={createMutation.isPending || !supplier || !shipmentRef.trim()} onClick={() => createMutation.mutate()}>{createMutation.isPending ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const ImportLcPage = () => {
  const dealerId = useDealerId();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Import LC</h1>
        <p className="text-sm text-muted-foreground">
          Proforma Invoice → Letter of Credit → Shipment → Customs Clearance. BDT amounts only — no foreign-exchange conversion.
        </p>
      </div>
      <Tabs defaultValue="pi">
        <TabsList>
          <TabsTrigger value="pi">Proforma Invoices</TabsTrigger>
          <TabsTrigger value="lc">Letters of Credit</TabsTrigger>
          <TabsTrigger value="shipments">Shipments</TabsTrigger>
        </TabsList>
        <TabsContent value="pi"><ProformaInvoicesTab dealerId={dealerId} /></TabsContent>
        <TabsContent value="lc"><LettersOfCreditTab dealerId={dealerId} /></TabsContent>
        <TabsContent value="shipments"><ShipmentsTab dealerId={dealerId} /></TabsContent>
      </Tabs>
    </div>
  );
};

export default ImportLcPage;
