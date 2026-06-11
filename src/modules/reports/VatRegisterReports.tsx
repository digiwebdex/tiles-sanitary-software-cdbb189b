import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";
import { formatCurrency } from "@/lib/utils";
import { exportToExcel } from "@/lib/exportUtils";
import { usePermissions } from "@/hooks/usePermissions";
import { Download, FileSpreadsheet } from "lucide-react";

function monthStart(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

interface VatSalesRow {
  saleId: string;
  invoiceNumber: string | null;
  saleDate: string;
  customerName: string;
  customerTaxId: string | null;
  taxableAmount: number;
  vatRate: number;
  vatAmount: number;
  sdAmount: number;
  totalAmount: number;
}

interface VatPurchaseRow {
  purchaseId: string;
  invoiceNumber: string | null;
  purchaseDate: string;
  supplierName: string;
  supplierTaxId: string | null;
  taxableAmount: number;
  vatRate: number;
  vatAmount: number;
  sdAmount: number;
  totalAmount: number;
}

function PeriodFilters({
  from,
  to,
  onFrom,
  onTo,
}: {
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <Label htmlFor="vat-from" className="text-xs">From</Label>
        <Input id="vat-from" type="date" value={from} onChange={(e) => onFrom(e.target.value)} className="w-36" />
      </div>
      <div>
        <Label htmlFor="vat-to" className="text-xs">To</Label>
        <Input id="vat-to" type="date" value={to} onChange={(e) => onTo(e.target.value)} className="w-36" />
      </div>
    </div>
  );
}

export function VatSalesRegisterReport({ dealerId }: { dealerId: string }) {
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const { canExportReports } = usePermissions();

  const { data, isLoading, error } = useQuery({
    queryKey: ["vat-sales-register", dealerId, from, to],
    queryFn: async () => {
      const params = new URLSearchParams({ dealerId, from, to });
      const res = await vpsAuthedFetch(`/api/reports/vat/sales-register?${params}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed");
      return res.json() as {
        rows: VatSalesRow[];
        totals: { taxable: number; vat: number; sd: number; total: number };
      };
    },
    enabled: !!dealerId && !!from && !!to,
  });

  const rows = data?.rows ?? [];
  const totals = data?.totals;

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4" />
          Mushak 6.3 — Sales VAT Register
        </CardTitle>
        <div className="flex flex-wrap items-end gap-2">
          <PeriodFilters from={from} to={to} onFrom={setFrom} onTo={setTo} />
          {canExportReports && rows.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => exportToExcel(rows, [
                { header: "Date", key: "saleDate" },
                { header: "Invoice", key: "invoiceNumber" },
                { header: "Customer", key: "customerName" },
                { header: "BIN/TIN", key: "customerTaxId" },
                { header: "Taxable", key: "taxableAmount", format: "currency" },
                { header: "VAT %", key: "vatRate", format: "number" },
                { header: "VAT", key: "vatAmount", format: "currency" },
                { header: "SD", key: "sdAmount", format: "currency" },
                { header: "Total", key: "totalAmount", format: "currency" },
              ], `mushak-6.3-sales-${from}-${to}`)}
            >
              <Download className="h-4 w-4 mr-1" /> Export
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-destructive text-sm">{(error as Error).message}</p>
        ) : isLoading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No sales in this period</p>
        ) : (
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>BIN/TIN</TableHead>
                  <TableHead className="text-right">Taxable</TableHead>
                  <TableHead className="text-right">VAT %</TableHead>
                  <TableHead className="text-right">VAT</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.saleId}>
                    <TableCell>{r.saleDate}</TableCell>
                    <TableCell className="font-mono text-xs">{r.invoiceNumber ?? "—"}</TableCell>
                    <TableCell>{r.customerName}</TableCell>
                    <TableCell className="text-xs">{r.customerTaxId ?? "—"}</TableCell>
                    <TableCell className="text-right">{formatCurrency(r.taxableAmount)}</TableCell>
                    <TableCell className="text-right">{r.vatRate}%</TableCell>
                    <TableCell className="text-right">{formatCurrency(r.vatAmount)}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(r.totalAmount)}</TableCell>
                  </TableRow>
                ))}
                {totals && (
                  <TableRow className="bg-muted/50 font-semibold">
                    <TableCell colSpan={4}>Totals</TableCell>
                    <TableCell className="text-right">{formatCurrency(totals.taxable)}</TableCell>
                    <TableCell />
                    <TableCell className="text-right">{formatCurrency(totals.vat)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(totals.total)}</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function VatPurchaseRegisterReport({ dealerId }: { dealerId: string }) {
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const { canExportReports } = usePermissions();

  const { data, isLoading, error } = useQuery({
    queryKey: ["vat-purchase-register", dealerId, from, to],
    queryFn: async () => {
      const params = new URLSearchParams({ dealerId, from, to });
      const res = await vpsAuthedFetch(`/api/reports/vat/purchase-register?${params}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed");
      return res.json() as {
        rows: VatPurchaseRow[];
        totals: { taxable: number; vat: number; sd: number; total: number };
      };
    },
    enabled: !!dealerId && !!from && !!to,
  });

  const rows = data?.rows ?? [];
  const totals = data?.totals;

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4" />
          Mushak 6.1 — Purchase VAT Register
        </CardTitle>
        <div className="flex flex-wrap items-end gap-2">
          <PeriodFilters from={from} to={to} onFrom={setFrom} onTo={setTo} />
          {canExportReports && rows.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => exportToExcel(rows, [
                { header: "Date", key: "purchaseDate" },
                { header: "Invoice", key: "invoiceNumber" },
                { header: "Supplier", key: "supplierName" },
                { header: "BIN/TIN", key: "supplierTaxId" },
                { header: "Taxable", key: "taxableAmount", format: "currency" },
                { header: "VAT %", key: "vatRate", format: "number" },
                { header: "VAT", key: "vatAmount", format: "currency" },
                { header: "SD", key: "sdAmount", format: "currency" },
                { header: "Total", key: "totalAmount", format: "currency" },
              ], `mushak-6.1-purchase-${from}-${to}`)}
            >
              <Download className="h-4 w-4 mr-1" /> Export
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-destructive text-sm">{(error as Error).message}</p>
        ) : isLoading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No purchases in this period</p>
        ) : (
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>BIN/TIN</TableHead>
                  <TableHead className="text-right">Taxable</TableHead>
                  <TableHead className="text-right">VAT %</TableHead>
                  <TableHead className="text-right">VAT</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.purchaseId}>
                    <TableCell>{r.purchaseDate}</TableCell>
                    <TableCell className="font-mono text-xs">{r.invoiceNumber ?? "—"}</TableCell>
                    <TableCell>{r.supplierName}</TableCell>
                    <TableCell className="text-xs">{r.supplierTaxId ?? "—"}</TableCell>
                    <TableCell className="text-right">{formatCurrency(r.taxableAmount)}</TableCell>
                    <TableCell className="text-right">{r.vatRate}%</TableCell>
                    <TableCell className="text-right">{formatCurrency(r.vatAmount)}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(r.totalAmount)}</TableCell>
                  </TableRow>
                ))}
                {totals && (
                  <TableRow className="bg-muted/50 font-semibold">
                    <TableCell colSpan={4}>Totals</TableCell>
                    <TableCell className="text-right">{formatCurrency(totals.taxable)}</TableCell>
                    <TableCell />
                    <TableCell className="text-right">{formatCurrency(totals.vat)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(totals.total)}</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function VatRegisterHub({ dealerId }: { dealerId: string }) {
  return (
    <Tabs defaultValue="sales">
      <TabsList>
        <TabsTrigger value="sales">Mushak 6.3 (Sales)</TabsTrigger>
        <TabsTrigger value="purchase">Mushak 6.1 (Purchase)</TabsTrigger>
      </TabsList>
      <TabsContent value="sales" className="mt-4">
        <VatSalesRegisterReport dealerId={dealerId} />
      </TabsContent>
      <TabsContent value="purchase" className="mt-4">
        <VatPurchaseRegisterReport dealerId={dealerId} />
      </TabsContent>
    </Tabs>
  );
}
