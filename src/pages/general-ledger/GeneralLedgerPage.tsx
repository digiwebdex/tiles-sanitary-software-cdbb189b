/**
 * General Ledger — V2 Sprint 6E.
 * Per-account drill-down with running balance, reusing generalLedgerService.ts
 * (GL Spine UNION manual Journal — see that service's own header comment).
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDealerId } from "@/hooks/useDealerId";
import { generalLedgerService } from "@/services/generalLedgerService";
import { toast } from "@/hooks/use-toast";
import { BookOpen, Download } from "lucide-react";

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const GeneralLedgerPage = () => {
  const dealerId = useDealerId();
  const [selection, setSelection] = useState<string>("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const { data: accountsData } = useQuery({
    queryKey: ["general-ledger-accounts", dealerId],
    queryFn: () => generalLedgerService.accounts(dealerId!),
    enabled: !!dealerId,
  });

  const options = [...(accountsData?.gl_accounts ?? []), ...(accountsData?.journal_accounts ?? [])];
  const [source, account] = selection ? selection.split("::") as ["gl" | "journal", string] : ["", ""];

  const { data: ledger, isLoading } = useQuery({
    queryKey: ["general-ledger", dealerId, source, account, from, to],
    queryFn: () => generalLedgerService.ledger(dealerId!, source as "gl" | "journal", account, { from: from || undefined, to: to || undefined }),
    enabled: !!dealerId && !!source && !!account,
  });

  const handleExport = async () => {
    if (!source || !account) return;
    try {
      await generalLedgerService.downloadCsv(dealerId!, source as "gl" | "journal", account, { from: from || undefined, to: to || undefined });
    } catch (e: any) {
      toast({ title: "Export failed", description: e?.message, variant: "destructive" });
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-bold flex items-center gap-2"><BookOpen className="h-6 w-6" /> General Ledger</h1>

      <Card>
        <CardContent className="pt-6 flex flex-wrap gap-3 items-end">
          <div className="min-w-[280px]">
            <Label>Account</Label>
            <Select value={selection} onValueChange={setSelection}>
              <SelectTrigger><SelectValue placeholder="Select an account" /></SelectTrigger>
              <SelectContent>
                {options.map((o) => (
                  <SelectItem key={`${o.source}::${o.accountKey}`} value={`${o.source}::${o.accountKey}`}>
                    {o.accountLabel} {o.source === "journal" ? "(manual journal)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <Button variant="outline" onClick={handleExport} disabled={!source || !account}>
            <Download className="h-4 w-4 mr-2" /> Export CSV
          </Button>
        </CardContent>
      </Card>

      {!selection && <p className="text-muted-foreground">Select an account to view its ledger.</p>}
      {selection && isLoading && <p>Loading…</p>}

      {ledger && (
        <Card>
          <CardHeader>
            <CardTitle>{ledger.accountLabel}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-6 mb-4 text-sm">
              <span>Opening Balance: <strong>{money(ledger.openingBalance)}</strong></span>
              <span>Closing Balance: <strong>{money(ledger.closingBalance)}</strong></span>
              <span>{ledger.transactions.length} transactions</span>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Voucher / Link</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                  <TableHead className="text-right">Running Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell colSpan={5} className="font-medium text-muted-foreground">Opening Balance</TableCell>
                  <TableCell className="text-right font-medium">{money(ledger.openingBalance)}</TableCell>
                </TableRow>
                {ledger.transactions.map((t, i) => (
                  <TableRow key={i}>
                    <TableCell>{t.date}</TableCell>
                    <TableCell>{t.description || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {t.voucherNo ? <Badge variant="outline">{t.voucherNo}</Badge> : (t.documentType ? <Badge variant="outline" className="capitalize">{t.documentType.replace(/_/g, " ")}</Badge> : "—")}
                    </TableCell>
                    <TableCell className="text-right">{t.debit > 0 ? money(t.debit) : ""}</TableCell>
                    <TableCell className="text-right">{t.credit > 0 ? money(t.credit) : ""}</TableCell>
                    <TableCell className="text-right">{money(t.runningBalance)}</TableCell>
                  </TableRow>
                ))}
                {!ledger.transactions.length && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No activity in this period.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default GeneralLedgerPage;
