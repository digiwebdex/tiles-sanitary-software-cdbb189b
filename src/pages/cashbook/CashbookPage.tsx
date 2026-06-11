import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDealerId } from "@/hooks/useDealerId";
import { cashbookService } from "@/services/cashbookService";
import { bankAccountService } from "@/services/bankAccountService";
import { formatCurrency } from "@/lib/utils";
import { paymentModeLabel } from "@/lib/paymentModes";
import { exportToExcel } from "@/lib/exportUtils";
import { Download, BookOpen } from "lucide-react";

const CashbookPage = () => {
  const dealerId = useDealerId();
  const [filters, setFilters] = useState<{ from?: string; to?: string; account: "cash" | "bank" | "all"; bankAccountId?: string }>({ account: "all" });

  const { data: banks = [] } = useQuery({
    queryKey: ["bank-accounts", dealerId],
    queryFn: () => bankAccountService.list(dealerId),
    enabled: !!dealerId,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["cashbook", dealerId, filters],
    queryFn: () => cashbookService.fetch(dealerId, filters),
    enabled: !!dealerId,
  });

  const onExport = () => {
    if (!data?.rows) return;
    exportToExcel(
      data.rows.map(r => ({
        Date: r.entry_date, Account: r.account_kind, Type: r.type,
        Channel: r.payment_mode ? paymentModeLabel(r.payment_mode) : "",
        Description: r.description, In: r.amount > 0 ? r.amount : 0, Out: r.amount < 0 ? Math.abs(r.amount) : 0,
        Balance: r.running_balance,
      })),
      [
        { key: "Date", header: "Date" }, { key: "Account", header: "Account" }, { key: "Type", header: "Type" },
        { key: "Channel", header: "Channel" }, { key: "Description", header: "Description" },
        { key: "In", header: "In", format: "currency" }, { key: "Out", header: "Out", format: "currency" },
        { key: "Balance", header: "Balance", format: "currency" },
      ],
      "Cashbook"
    );
  };

  return (
    <div className="container mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2"><BookOpen className="h-6 w-6 text-primary" /> Cashbook</h1>
        <Button variant="outline" onClick={onExport}><Download className="h-4 w-4 mr-2" /> Excel</Button>
      </div>

      <Card>
        <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-5 gap-3">
          <div><Label>From</Label><Input type="date" value={filters.from || ""} onChange={e => setFilters({ ...filters, from: e.target.value || undefined })} /></div>
          <div><Label>To</Label><Input type="date" value={filters.to || ""} onChange={e => setFilters({ ...filters, to: e.target.value || undefined })} /></div>
          <div>
            <Label>Account</Label>
            <Select value={filters.account} onValueChange={(v: any) => setFilters({ ...filters, account: v, bankAccountId: undefined })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All (Cash + Bank)</SelectItem>
                <SelectItem value="cash">Cash only</SelectItem>
                <SelectItem value="bank">Bank only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {filters.account === "bank" && (
            <div className="md:col-span-2">
              <Label>Bank Account</Label>
              <Select value={filters.bankAccountId || "all"} onValueChange={v => setFilters({ ...filters, bankAccountId: v === "all" ? undefined : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All banks</SelectItem>
                  {banks.map(b => <SelectItem key={b.id} value={b.id}>{b.bank_name} — {b.account_number}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Opening Balance</div><div className="text-xl font-bold">{formatCurrency(data?.opening || 0)}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Closing Balance</div><div className="text-xl font-bold text-primary">{formatCurrency(data?.closing || 0)}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Total In</div><div className="text-xl font-bold text-emerald-500">{formatCurrency(Object.values(data?.summary || {}).reduce((s, v) => s + v.in, 0))}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Total Out</div><div className="text-xl font-bold text-red-500">{formatCurrency(Object.values(data?.summary || {}).reduce((s, v) => s + v.out, 0))}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Transactions ({data?.rows.length || 0})</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? <p>Loading…</p> : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Date</TableHead><TableHead>Account</TableHead><TableHead>Type</TableHead>
                <TableHead>Channel</TableHead><TableHead>Description</TableHead><TableHead className="text-right">In</TableHead>
                <TableHead className="text-right">Out</TableHead><TableHead className="text-right">Balance</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {data?.rows.map(r => (
                  <TableRow key={r.id}>
                    <TableCell>{new Date(r.entry_date).toLocaleDateString()}</TableCell>
                    <TableCell><Badge variant={r.account_kind === "cash" ? "default" : "secondary"}>{r.account_kind}</Badge></TableCell>
                    <TableCell className="text-xs">{r.type}</TableCell>
                    <TableCell className="text-xs">{r.payment_mode ? paymentModeLabel(r.payment_mode) : "—"}</TableCell>
                    <TableCell>{r.description || "—"}</TableCell>
                    <TableCell className="text-right text-emerald-500 font-mono">{r.amount > 0 ? formatCurrency(r.amount) : ""}</TableCell>
                    <TableCell className="text-right text-red-500 font-mono">{r.amount < 0 ? formatCurrency(Math.abs(r.amount)) : ""}</TableCell>
                    <TableCell className="text-right font-mono font-medium">{formatCurrency(r.running_balance)}</TableCell>
                  </TableRow>
                ))}
                {!data?.rows.length && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">No transactions</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default CashbookPage;
