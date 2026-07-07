import { useMemo, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useDealerId } from "@/hooks/useDealerId";
import { customerStatementService } from "@/services/customerStatementService";
import { openingBalanceService } from "@/services/openingBalanceService";
import { buildWaLink, normalizePhoneForWa, isValidWaPhone } from "@/services/whatsappService";
import { formatCurrency } from "@/lib/utils";
import { Printer, ArrowLeft, MessageCircle, Landmark } from "lucide-react";
import { toast } from "sonner";

const CustomerStatementPage = () => {
  const { customerId } = useParams<{ customerId: string }>();
  const dealerId = useDealerId();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const todayStr = new Date().toISOString().slice(0, 10);
  const firstOfMonth = useMemo(() => {
    const d = new Date(); d.setDate(1);
    return d.toISOString().slice(0, 10);
  }, []);
  const from = sp.get("from") || "";
  const to = sp.get("to") || todayStr;

  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["customer-statement", customerId, dealerId, from, to],
    queryFn: () => customerStatementService.get(customerId!, dealerId, { from: from || undefined, to: to || undefined }),
    enabled: !!customerId && !!dealerId,
  });

  // V2 Sprint 6B — one-time, idempotent action mirroring this customer's
  // opening_balance into the ledger/GL (see openingBalancePosting.ts). Safe
  // to call more than once; a second call is a no-op.
  const postOpeningBalance = useMutation({
    mutationFn: () => openingBalanceService.postCustomer(dealerId, customerId!),
    onSuccess: (res) => {
      if (res.posted) toast.success("Opening balance posted to ledger/GL");
      else toast.info("Opening balance was already posted (or is zero)");
      queryClient.invalidateQueries({ queryKey: ["customer-statement"] });
    },
    onError: (e: any) => toast.error(e?.message || "Failed to post opening balance"),
  });

  const setRange = (f: string, t: string) => {
    const n = new URLSearchParams(sp);
    if (f) n.set("from", f); else n.delete("from");
    if (t) n.set("to", t); else n.delete("to");
    setSp(n, { replace: true });
  };

  const sendWhatsApp = () => {
    if (!data) return;
    const phone = data.customer.phone || "";
    if (!isValidWaPhone(phone)) {
      alert("Customer has no valid phone number");
      return;
    }
    const msg = [
      `Hello ${data.customer.name},`,
      ``,
      `Your account statement from ${from || "the beginning"} to ${to}:`,
      `Opening balance: ৳${data.opening_balance.toFixed(2)}`,
      `Total sales: ৳${data.totals.debit.toFixed(2)}`,
      `Total payments: ৳${data.totals.credit.toFixed(2)}`,
      `*Closing due: ৳${data.closing_balance.toFixed(2)}*`,
      ``,
      `Kindly clear the outstanding at your earliest convenience.`,
      `Thank you, ${data.dealer?.name || ""}`,
    ].join("\n");
    window.open(buildWaLink(normalizePhoneForWa(phone), msg), "_blank");
  };

  if (isLoading || !data) {
    return <div className="container mx-auto p-4">Loading statement…</div>;
  }

  return (
    <div className="container mx-auto p-4 max-w-5xl">
      {/* Toolbar (hidden on print) */}
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4 print:hidden">
        <Button variant="outline" onClick={() => navigate(-1)}><ArrowLeft className="h-4 w-4 mr-2" />Back</Button>
        <div className="flex items-end gap-2 flex-wrap">
          <div>
            <Label className="text-xs">From</Label>
            <Input type="date" value={from} onChange={(e) => setRange(e.target.value, to)} className="h-9" />
          </div>
          <div>
            <Label className="text-xs">To</Label>
            <Input type="date" value={to} onChange={(e) => setRange(from, e.target.value)} className="h-9" />
          </div>
          <Button variant="outline" size="sm" onClick={() => setRange(firstOfMonth, todayStr)}>This Month</Button>
          <Button variant="outline" size="sm" onClick={() => setRange("", todayStr)}>All Time</Button>
          <Button onClick={() => window.print()}><Printer className="h-4 w-4 mr-2" />Print / PDF</Button>
          <Button variant="secondary" onClick={sendWhatsApp}><MessageCircle className="h-4 w-4 mr-2" />WhatsApp</Button>
          <Button variant="outline" size="sm" disabled={postOpeningBalance.isPending} onClick={() => postOpeningBalance.mutate()}>
            <Landmark className="h-4 w-4 mr-2" />
            {postOpeningBalance.isPending ? "Posting…" : "Post Opening Balance to GL"}
          </Button>
        </div>
      </div>

      {/* Document */}
      <Card className="print:shadow-none print:border-0">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-start justify-between border-b pb-4">
            <div>
              <h1 className="text-2xl font-bold">{data.dealer?.name || "Statement of Account"}</h1>
              {data.dealer?.address && <p className="text-sm text-muted-foreground">{data.dealer.address}</p>}
              {data.dealer?.phone && <p className="text-sm text-muted-foreground">Phone: {data.dealer.phone}</p>}
            </div>
            <div className="text-right">
              <h2 className="text-xl font-semibold">Customer Statement</h2>
              <p className="text-sm">Period: {from || "Beginning"} → {to}</p>
              <p className="text-xs text-muted-foreground">Generated: {new Date().toLocaleDateString()}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Bill To</p>
              <p className="font-semibold text-lg">{data.customer.name}</p>
              {data.customer.phone && <p>{data.customer.phone}</p>}
              {data.customer.address && <p className="text-muted-foreground">{data.customer.address}</p>}
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Closing Balance Due</p>
              <p className={`text-3xl font-bold ${data.closing_balance > 0 ? "text-destructive" : "text-green-600"}`}>
                {formatCurrency(data.closing_balance)}
              </p>
              {data.customer.credit_limit > 0 && (
                <p className="text-xs text-muted-foreground">Credit limit: {formatCurrency(data.customer.credit_limit)}</p>
              )}
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Debit (Sale)</TableHead>
                <TableHead className="text-right">Credit (Payment)</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow className="font-medium bg-muted/40">
                <TableCell>{from || "—"}</TableCell>
                <TableCell>Opening Balance</TableCell>
                <TableCell className="text-right">—</TableCell>
                <TableCell className="text-right">—</TableCell>
                <TableCell className="text-right">{formatCurrency(data.opening_balance)}</TableCell>
              </TableRow>
              {data.entries.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-4">No transactions in this period</TableCell></TableRow>
              )}
              {data.entries.map((e, idx) => (
                <TableRow key={idx}>
                  <TableCell className="text-xs">{e.date}</TableCell>
                  <TableCell>
                    {e.description}
                    {e.sale_invoice && <Badge variant="outline" className="ml-2 text-xs">#{e.sale_invoice}</Badge>}
                  </TableCell>
                  <TableCell className="text-right">{e.debit > 0 ? formatCurrency(e.debit) : "—"}</TableCell>
                  <TableCell className="text-right">{e.credit > 0 ? formatCurrency(e.credit) : "—"}</TableCell>
                  <TableCell className="text-right font-medium">{formatCurrency(e.balance)}</TableCell>
                </TableRow>
              ))}
              <TableRow className="font-bold border-t-2">
                <TableCell colSpan={2}>Totals / Closing</TableCell>
                <TableCell className="text-right">{formatCurrency(data.totals.debit)}</TableCell>
                <TableCell className="text-right">{formatCurrency(data.totals.credit)}</TableCell>
                <TableCell className="text-right text-lg">{formatCurrency(data.closing_balance)}</TableCell>
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

export default CustomerStatementPage;
