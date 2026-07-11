import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDealerId } from "@/hooks/useDealerId";
import { vatReportService } from "@/services/vatReportService";
import { formatCurrency } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText } from "lucide-react";

const todayISO = () => new Date().toISOString().slice(0, 10);
const monthStartISO = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};

/**
 * V2 Sprint 4C — VAT Reports (VAT Summary / Breakdown / Ready Reports).
 * Purely a read-only frontend view over the existing, unmodified
 * /api/reports/vat/sales-register and /purchase-register endpoints
 * (Phase 5 P5-04, Bangladesh Mushak 6.3 / 6.1 style) — no VAT calculation
 * is duplicated here.
 */
const VatReportsPage = () => {
  const dealerId = useDealerId();
  const [from, setFrom] = useState(monthStartISO());
  const [to, setTo] = useState(todayISO());

  const { data: salesRegister, isLoading: salesLoading } = useQuery({
    queryKey: ["vat-sales-register", dealerId, from, to],
    queryFn: () => vatReportService.getSalesRegister(dealerId, from, to),
    enabled: !!dealerId && !!from && !!to,
  });

  const { data: purchaseRegister, isLoading: purchaseLoading } = useQuery({
    queryKey: ["vat-purchase-register", dealerId, from, to],
    queryFn: () => vatReportService.getPurchaseRegister(dealerId, from, to),
    enabled: !!dealerId && !!from && !!to,
  });

  const netVatPayable = (salesRegister?.totals.vat ?? 0) - (purchaseRegister?.totals.vat ?? 0);

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">VAT Reports</h1>
        <p className="text-sm text-muted-foreground">Bangladesh VAT (Mushak) sales &amp; purchase registers, summary, and breakdown</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label>From</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <Label>To</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      {/* VAT Summary */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground">Output VAT (Sales)</p>
          <p className="text-xl font-bold text-foreground">{formatCurrency(salesRegister?.totals.vat ?? 0)}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground">Input VAT (Purchases)</p>
          <p className="text-xl font-bold text-foreground">{formatCurrency(purchaseRegister?.totals.vat ?? 0)}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground">Net VAT Payable</p>
          <p className={`text-xl font-bold ${netVatPayable >= 0 ? "text-destructive" : "text-emerald-600"}`}>
            {formatCurrency(Math.abs(netVatPayable))} {netVatPayable >= 0 ? "(due)" : "(credit)"}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground">Taxable Sales</p>
          <p className="text-xl font-bold text-foreground">{formatCurrency(salesRegister?.totals.taxable ?? 0)}</p>
        </div>
      </div>

      <Tabs defaultValue="sales">
        <TabsList>
          <TabsTrigger value="sales">Sales Register (Mushak 6.3)</TabsTrigger>
          <TabsTrigger value="purchase">Purchase Register (Mushak 6.1)</TabsTrigger>
        </TabsList>

        <TabsContent value="sales">
          <div className="rounded-lg border bg-card overflow-hidden mt-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>BIN/TIN</TableHead>
                  <TableHead className="text-right">Taxable</TableHead>
                  <TableHead className="text-right">VAT Rate</TableHead>
                  <TableHead className="text-right">VAT</TableHead>
                  <TableHead className="text-right">SD</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {salesLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}><TableCell colSpan={9}><Skeleton className="h-4 w-full" /></TableCell></TableRow>
                  ))
                ) : (salesRegister?.rows ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-10 text-muted-foreground">
                      <FileText className="mx-auto h-8 w-8 mb-2 text-muted-foreground/50" />
                      No VAT-bearing sales in this period.
                    </TableCell>
                  </TableRow>
                ) : (
                  salesRegister!.rows.map((r) => (
                    <TableRow key={r.saleId}>
                      <TableCell className="font-mono">{r.invoiceNumber ?? "—"}</TableCell>
                      <TableCell>{r.saleDate}</TableCell>
                      <TableCell>{r.customerName}</TableCell>
                      <TableCell>{r.customerTaxId ?? "—"}</TableCell>
                      <TableCell className="text-right">{formatCurrency(r.taxableAmount)}</TableCell>
                      <TableCell className="text-right">{r.vatRate}%</TableCell>
                      <TableCell className="text-right">{formatCurrency(r.vatAmount)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(r.sdAmount)}</TableCell>
                      <TableCell className="text-right font-semibold">{formatCurrency(r.totalAmount)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
              {salesRegister && salesRegister.rows.length > 0 && (
                <tfoot>
                  <TableRow className="bg-muted/50 font-semibold">
                    <TableCell colSpan={4}>Totals</TableCell>
                    <TableCell className="text-right">{formatCurrency(salesRegister.totals.taxable)}</TableCell>
                    <TableCell />
                    <TableCell className="text-right">{formatCurrency(salesRegister.totals.vat)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(salesRegister.totals.sd)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(salesRegister.totals.total)}</TableCell>
                  </TableRow>
                </tfoot>
              )}
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="purchase">
          <div className="rounded-lg border bg-card overflow-hidden mt-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>BIN/TIN</TableHead>
                  <TableHead className="text-right">Taxable</TableHead>
                  <TableHead className="text-right">VAT Rate</TableHead>
                  <TableHead className="text-right">VAT</TableHead>
                  <TableHead className="text-right">SD</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {purchaseLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}><TableCell colSpan={9}><Skeleton className="h-4 w-full" /></TableCell></TableRow>
                  ))
                ) : (purchaseRegister?.rows ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-10 text-muted-foreground">
                      <FileText className="mx-auto h-8 w-8 mb-2 text-muted-foreground/50" />
                      No VAT-bearing purchases in this period.
                    </TableCell>
                  </TableRow>
                ) : (
                  purchaseRegister!.rows.map((r) => (
                    <TableRow key={r.purchaseId}>
                      <TableCell className="font-mono">{r.invoiceNumber ?? "—"}</TableCell>
                      <TableCell>{r.purchaseDate}</TableCell>
                      <TableCell>{r.supplierName}</TableCell>
                      <TableCell>{r.supplierTaxId ?? "—"}</TableCell>
                      <TableCell className="text-right">{formatCurrency(r.taxableAmount)}</TableCell>
                      <TableCell className="text-right">{r.vatRate}%</TableCell>
                      <TableCell className="text-right">{formatCurrency(r.vatAmount)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(r.sdAmount)}</TableCell>
                      <TableCell className="text-right font-semibold">{formatCurrency(r.totalAmount)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
              {purchaseRegister && purchaseRegister.rows.length > 0 && (
                <tfoot>
                  <TableRow className="bg-muted/50 font-semibold">
                    <TableCell colSpan={4}>Totals</TableCell>
                    <TableCell className="text-right">{formatCurrency(purchaseRegister.totals.taxable)}</TableCell>
                    <TableCell />
                    <TableCell className="text-right">{formatCurrency(purchaseRegister.totals.vat)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(purchaseRegister.totals.sd)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(purchaseRegister.totals.total)}</TableCell>
                  </TableRow>
                </tfoot>
              )}
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default VatReportsPage;
