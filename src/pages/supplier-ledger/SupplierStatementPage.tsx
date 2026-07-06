/**
 * Supplier Statement — V2 Sprint 5D (Supplier Ledger).
 * Reuses `supplierService.getLedgerSummary()` (built, unmodified, in Sprint
 * 5A) as the sole data source, rendered as a dated statement mirroring
 * CustomerStatementPage.tsx's layout/print pattern. Running balance is
 * computed client-side from `opening_balance` using the same
 * `balance += -amount` rule as computeSupplierBalance/mv_supplier_payable
 * (verified in supplierLedgerEntries.query.test.ts) — every entry type
 * (purchase, payment, credit_note, debit_note) already carries the correct
 * sign, so no per-type branching is needed here.
 */
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDealerId } from "@/hooks/useDealerId";
import { supplierService } from "@/services/supplierService";
import { formatCurrency } from "@/lib/utils";
import { Printer, ArrowLeft, Search } from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

const TYPE_LABEL: Record<string, string> = {
  purchase: "Purchase Invoice",
  payment: "Payment",
  refund: "Refund",
  credit_note: "Credit Note",
  debit_note: "Debit Note",
  adjustment: "Adjustment",
  opening_balance: "Opening Balance",
};

const SupplierStatementPage = () => {
  const dealerId = useDealerId();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const supplierId = sp.get("supplierId") || "";
  const [search, setSearch] = useState("");

  const { data: supplierResults } = useQuery({
    queryKey: ["supplier-picker", dealerId, search],
    queryFn: () => supplierService.list(dealerId, search, 1),
    enabled: !!dealerId && !supplierId && search.trim().length > 1,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["supplier-ledger-summary", supplierId],
    queryFn: () => supplierService.getLedgerSummary(supplierId),
    enabled: !!supplierId,
  });

  const rows = useMemo(() => {
    if (!data) return [];
    const sorted = [...data.entries].sort((a, b) => a.entry_date.localeCompare(b.entry_date) || a.created_at.localeCompare(b.created_at));
    let running = data.supplier.opening_balance;
    return sorted.map((e) => {
      const debit = e.amount < 0 ? -e.amount : 0;
      const credit = e.amount > 0 ? e.amount : 0;
      running += -e.amount;
      return { ...e, debit, credit, balance: running };
    });
  }, [data]);

  const totals = useMemo(
    () => rows.reduce((acc, r) => ({ debit: acc.debit + r.debit, credit: acc.credit + r.credit }), { debit: 0, credit: 0 }),
    [rows],
  );

  if (!supplierId) {
    return (
      <div className="container mx-auto p-4 max-w-2xl space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}><ArrowLeft className="h-4 w-4" /></Button>
          <h1 className="text-2xl font-bold text-foreground">Supplier Statement</h1>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search a supplier by name…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        {(supplierResults?.data ?? []).map((s: any) => (
          <button
            key={s.id}
            type="button"
            className="block w-full text-left rounded-md border px-3 py-2 text-sm hover:bg-accent"
            onClick={() => setSp({ supplierId: s.id })}
          >
            {s.name}
          </button>
        ))}
      </div>
    );
  }

  if (isLoading || !data) {
    return <div className="container mx-auto p-4">Loading statement…</div>;
  }

  return (
    <div className="container mx-auto p-4 max-w-5xl">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4 print:hidden">
        <Button variant="outline" onClick={() => setSp({})}><ArrowLeft className="h-4 w-4 mr-2" />Change Supplier</Button>
        <Button onClick={() => window.print()}><Printer className="h-4 w-4 mr-2" />Print / PDF</Button>
      </div>

      <Card className="print:shadow-none print:border-0">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-start justify-between border-b pb-4">
            <div>
              <h1 className="text-2xl font-bold">{data.supplier.name}</h1>
              <p className="text-sm text-muted-foreground">Supplier Statement of Account</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Generated: {new Date().toLocaleDateString()}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Opening Balance</p>
              <p className="font-semibold text-lg">{formatCurrency(data.supplier.opening_balance)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Outstanding Balance (payable)</p>
              <p className={`text-3xl font-bold ${data.outstanding > 0 ? "text-destructive" : "text-green-600"}`}>
                {formatCurrency(data.outstanding)}
              </p>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Debit (Purchase / Debit Note)</TableHead>
                <TableHead className="text-right">Credit (Payment / Credit Note)</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow className="font-medium bg-muted/40">
                <TableCell>—</TableCell>
                <TableCell>Opening Balance</TableCell>
                <TableCell className="text-right">—</TableCell>
                <TableCell className="text-right">—</TableCell>
                <TableCell className="text-right">{formatCurrency(data.supplier.opening_balance)}</TableCell>
              </TableRow>
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-4">No transactions yet</TableCell></TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs">{r.entry_date}</TableCell>
                  <TableCell>{r.description || TYPE_LABEL[r.type] || r.type}</TableCell>
                  <TableCell className="text-right">{r.debit > 0 ? formatCurrency(r.debit) : "—"}</TableCell>
                  <TableCell className="text-right">{r.credit > 0 ? formatCurrency(r.credit) : "—"}</TableCell>
                  <TableCell className="text-right font-medium">{formatCurrency(r.balance)}</TableCell>
                </TableRow>
              ))}
              <TableRow className="font-bold border-t-2">
                <TableCell colSpan={2}>Totals / Closing</TableCell>
                <TableCell className="text-right">{formatCurrency(totals.debit)}</TableCell>
                <TableCell className="text-right">{formatCurrency(totals.credit)}</TableCell>
                <TableCell className="text-right text-lg">{formatCurrency(data.outstanding)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>

          <div className="text-xs text-muted-foreground border-t pt-3 mt-4">
            <p>This is a system-generated statement. Please contact us within 7 days for any discrepancies.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default SupplierStatementPage;
