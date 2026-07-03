import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDealerId } from "@/hooks/useDealerId";
import { financialService } from "@/services/financialService";
import { formatCurrency } from "@/lib/utils";
import { Printer, TrendingUp, Scale, BookOpen, AlertTriangle, Wallet } from "lucide-react";

/**
 * Track 1 Phase 1 — surface backend-reported data-quality warnings.
 * Backend `warnings[]` is OPTIONAL; older backends will simply render
 * nothing and the page stays bit-for-bit identical to before.
 */
const DataQualityNotes = ({ warnings }: { warnings?: string[] }) => {
  if (!warnings || warnings.length === 0) return null;
  return (
    <Alert>
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Data quality notes</AlertTitle>
      <AlertDescription>
        <ul className="list-disc pl-5 space-y-1">
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
};

const FinancialStatementsPage = () => {
  const dealerId = useDealerId();
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [pl, setPl] = useState({ from: monthAgo, to: today });
  const [bs, setBs] = useState({ asOf: today });
  const [tb, setTb] = useState({ asOf: today, source: "auto" as "auto" | "gl" | "legacy" });

  const { data: pAndL, isLoading: plLoading } = useQuery({
    queryKey: ["pnl", dealerId, pl],
    queryFn: () => financialService.profitLoss(dealerId, pl.from, pl.to),
    enabled: !!dealerId,
  });

  const { data: balance, isLoading: bsLoading } = useQuery({
    queryKey: ["balance-sheet", dealerId, bs],
    queryFn: () => financialService.balanceSheet(dealerId, bs.asOf),
    enabled: !!dealerId,
  });

  const { data: trial, isLoading: tbLoading } = useQuery({
    queryKey: ["trial-balance", dealerId, tb],
    queryFn: () => financialService.trialBalance(dealerId, tb.asOf, tb.source),
    enabled: !!dealerId,
  });

  const [cf, setCf] = useState({ from: monthAgo, to: today });
  const { data: cashFlow, isLoading: cfLoading } = useQuery({
    queryKey: ["cash-flow", dealerId, cf],
    queryFn: () => financialService.cashFlow(dealerId, cf.from, cf.to),
    enabled: !!dealerId,
  });

  return (
    <div className="container mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Financial Statements</h1>
        <Button variant="outline" onClick={() => window.print()}><Printer className="h-4 w-4 mr-2" /> Print</Button>
      </div>

      <Tabs defaultValue="pnl">
        <TabsList>
          <TabsTrigger value="pnl"><TrendingUp className="h-4 w-4 mr-2" /> Profit &amp; Loss</TabsTrigger>
          <TabsTrigger value="bs"><Scale className="h-4 w-4 mr-2" /> Balance Sheet</TabsTrigger>
          <TabsTrigger value="tb"><BookOpen className="h-4 w-4 mr-2" /> Trial Balance</TabsTrigger>
          <TabsTrigger value="cf"><Wallet className="h-4 w-4 mr-2" /> Cash Flow</TabsTrigger>
        </TabsList>

        <TabsContent value="pnl" className="space-y-4">
          <Card>
            <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div><Label>From</Label><Input type="date" value={pl.from} onChange={e => setPl({ ...pl, from: e.target.value })} /></div>
              <div><Label>To</Label><Input type="date" value={pl.to} onChange={e => setPl({ ...pl, to: e.target.value })} /></div>
            </CardContent>
          </Card>

          {plLoading ? <p>Loading…</p> : pAndL && (
            <>
            <DataQualityNotes warnings={pAndL.warnings} />
            <Card>
              <CardHeader><CardTitle>Profit &amp; Loss — {pl.from} to {pl.to}</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableBody>
                    <TableRow><TableCell className="font-medium">Gross Sales</TableCell><TableCell className="text-right font-mono">{formatCurrency(pAndL.revenue)}</TableCell></TableRow>
                    <TableRow><TableCell>Less: Sales Returns</TableCell><TableCell className="text-right font-mono text-red-500">({formatCurrency(pAndL.sales_returns)})</TableCell></TableRow>
                    <TableRow className="border-t"><TableCell className="font-semibold">Net Revenue</TableCell><TableCell className="text-right font-mono font-semibold">{formatCurrency(pAndL.net_revenue)}</TableCell></TableRow>
                    <TableRow><TableCell>Less: Cost of Goods Sold (COGS)</TableCell><TableCell className="text-right font-mono text-red-500">({formatCurrency(pAndL.cogs)})</TableCell></TableRow>
                    {(pAndL.cogs_reversal ?? 0) > 0 && (
                      <TableRow><TableCell className="pl-6 text-muted-foreground">Add: COGS Reversal (returns)</TableCell><TableCell className="text-right font-mono text-emerald-600">{formatCurrency(pAndL.cogs_reversal ?? 0)}</TableCell></TableRow>
                    )}
                    <TableRow><TableCell className="font-medium">Net COGS</TableCell><TableCell className="text-right font-mono text-red-500">({formatCurrency(pAndL.net_cogs ?? pAndL.cogs)})</TableCell></TableRow>
                    <TableRow className="bg-muted/40"><TableCell className="font-bold">Gross Profit</TableCell><TableCell className="text-right font-mono font-bold text-primary">{formatCurrency(pAndL.gross_profit)}</TableCell></TableRow>
                    <TableRow><TableCell colSpan={2} className="font-semibold pt-4">Operating Expenses</TableCell></TableRow>
                    {pAndL.expenses_by_category.map(e => (
                      <TableRow key={e.category}><TableCell className="pl-8 text-muted-foreground">{e.category}</TableCell><TableCell className="text-right font-mono">{formatCurrency(e.amount)}</TableCell></TableRow>
                    ))}
                    {!pAndL.expenses_by_category.length && <TableRow><TableCell colSpan={2} className="pl-8 text-muted-foreground">No expenses recorded</TableCell></TableRow>}
                    <TableRow className="border-t"><TableCell className="font-semibold">Total Expenses</TableCell><TableCell className="text-right font-mono">({formatCurrency(pAndL.total_expenses)})</TableCell></TableRow>
                    <TableRow className="bg-primary/10"><TableCell className="font-bold text-lg">Net Profit / (Loss)</TableCell><TableCell className={`text-right font-mono font-bold text-lg ${pAndL.net_profit >= 0 ? "text-emerald-500" : "text-red-500"}`}>{formatCurrency(pAndL.net_profit)}</TableCell></TableRow>
                  </TableBody>
                </Table>
                {pAndL.data_source && (
                  <p className="text-[11px] text-muted-foreground mt-3">
                    Data source: {pAndL.data_source}
                  </p>
                )}
              </CardContent>
            </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="bs" className="space-y-4">
          <Card>
            <CardContent className="pt-6">
              <Label>As of</Label>
              <Input type="date" value={bs.asOf} onChange={e => setBs({ asOf: e.target.value })} className="max-w-xs" />
            </CardContent>
          </Card>

          {bsLoading ? <p>Loading…</p> : balance && (
            <>
            <DataQualityNotes warnings={balance.warnings} />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader><CardTitle className="text-emerald-500">Assets</CardTitle></CardHeader>
                <CardContent>
                  <Table>
                    <TableBody>
                      <TableRow><TableCell>Cash on Hand</TableCell><TableCell className="text-right font-mono">{formatCurrency(balance.assets.cash)}</TableCell></TableRow>
                      <TableRow><TableCell>Bank Balances</TableCell><TableCell className="text-right font-mono">{formatCurrency(balance.assets.bank_total)}</TableCell></TableRow>
                      {balance.assets.bank_accounts.map(b => (
                        <TableRow key={b.bank_account_id}><TableCell className="pl-8 text-xs text-muted-foreground">{b.bank_name} — {b.account_number}</TableCell><TableCell className="text-right font-mono text-xs">{formatCurrency(b.balance)}</TableCell></TableRow>
                      ))}
                      <TableRow><TableCell>Inventory (at cost)</TableCell><TableCell className="text-right font-mono">{formatCurrency(balance.assets.inventory)}</TableCell></TableRow>
                      <TableRow><TableCell>Accounts Receivable</TableCell><TableCell className="text-right font-mono">{formatCurrency(balance.assets.accounts_receivable)}</TableCell></TableRow>
                      <TableRow className="bg-emerald-500/10 border-t"><TableCell className="font-bold">Total Assets</TableCell><TableCell className="text-right font-mono font-bold">{formatCurrency(balance.assets.total)}</TableCell></TableRow>
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-red-500">Liabilities &amp; Equity</CardTitle></CardHeader>
                <CardContent>
                  <Table>
                    <TableBody>
                      <TableRow><TableCell className="font-semibold">Liabilities</TableCell><TableCell></TableCell></TableRow>
                      <TableRow><TableCell className="pl-8">Accounts Payable</TableCell><TableCell className="text-right font-mono">{formatCurrency(balance.liabilities.accounts_payable)}</TableCell></TableRow>
                      <TableRow className="border-t"><TableCell className="font-semibold">Total Liabilities</TableCell><TableCell className="text-right font-mono font-semibold">{formatCurrency(balance.liabilities.total)}</TableCell></TableRow>
                      <TableRow><TableCell className="font-semibold pt-4">Owner's Equity</TableCell><TableCell></TableCell></TableRow>
                      <TableRow><TableCell className="pl-8">Director Capital</TableCell><TableCell className="text-right font-mono">{formatCurrency(balance.equity.director_capital ?? 0)}</TableCell></TableRow>
                      <TableRow><TableCell className="pl-8">Retained Earnings</TableCell><TableCell className="text-right font-mono">{formatCurrency(balance.equity.retained_earnings ?? balance.equity.owner_equity)}</TableCell></TableRow>
                      <TableRow className="border-t"><TableCell className="font-semibold">Total Equity</TableCell><TableCell className="text-right font-mono font-semibold">{formatCurrency(balance.equity.owner_equity)}</TableCell></TableRow>
                      <TableRow className="bg-primary/10 border-t"><TableCell className="font-bold">Total Liabilities + Equity</TableCell><TableCell className="text-right font-mono font-bold">{formatCurrency(balance.liabilities.total + balance.equity.total)}</TableCell></TableRow>
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="tb" className="space-y-4">
          <Card>
            <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label>As of</Label>
                <Input type="date" value={tb.asOf} onChange={e => setTb({ ...tb, asOf: e.target.value })} />
              </div>
              <div>
                <Label>Data source</Label>
                <Select value={tb.source} onValueChange={(v) => setTb({ ...tb, source: v as typeof tb.source })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto (GL when available)</SelectItem>
                    <SelectItem value="gl">GL spine only</SelectItem>
                    <SelectItem value="legacy">Legacy sub-ledgers</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {tbLoading ? <p>Loading…</p> : trial && (
            <>
            <DataQualityNotes warnings={trial.warnings} />
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <CardTitle>Trial Balance — as of {trial.as_of ?? "today"}</CardTitle>
                {trial.data_source === "gl_spine" ? (
                  <Badge variant="secondary">GL spine</Badge>
                ) : (
                  <Badge variant="outline">Legacy ledgers</Badge>
                )}
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account</TableHead>
                      <TableHead className="text-right">Debit</TableHead>
                      <TableHead className="text-right">Credit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trial.accounts.map((a, i) => (
                      <TableRow key={i}>
                        <TableCell>{a.account}</TableCell>
                        <TableCell className="text-right font-mono">{a.debit ? formatCurrency(a.debit) : "—"}</TableCell>
                        <TableCell className="text-right font-mono">{a.credit ? formatCurrency(a.credit) : "—"}</TableCell>
                      </TableRow>
                    ))}
                    {!trial.accounts.length && (
                      <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">No balances</TableCell></TableRow>
                    )}
                    <TableRow className="bg-primary/10 border-t-2 font-bold">
                      <TableCell>Totals</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(trial.total_debit)}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(trial.total_credit)}</TableCell>
                    </TableRow>
                    {Math.abs(trial.difference) > 0.01 && (
                      <TableRow className="bg-red-500/10">
                        <TableCell className="font-semibold text-red-500">Difference (out of balance)</TableCell>
                        <TableCell colSpan={2} className="text-right font-mono text-red-500">{formatCurrency(trial.difference)}</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
                <p className="text-xs text-muted-foreground mt-3">
                  {trial.data_source === "gl_spine"
                    ? "Sourced from GL journal entries mirrored from the posting engine. Enable USE_POSTING_ENGINE and USE_GL_SPINE for new documents to flow here."
                    : "Derived from operational sub-ledgers (cash, bank, sales, expenses, COGS, manual journal). Small differences are expected since closing entries are computed, not posted."}
                </p>
              </CardContent>
            </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="cf" className="space-y-4">
          <Card>
            <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div><Label>From</Label><Input type="date" value={cf.from} onChange={e => setCf({ ...cf, from: e.target.value })} /></div>
              <div><Label>To</Label><Input type="date" value={cf.to} onChange={e => setCf({ ...cf, to: e.target.value })} /></div>
            </CardContent>
          </Card>
          {cfLoading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : cashFlow ? (
            <Card>
              <CardHeader><CardTitle className="text-base">Cash Flow (Cash in Hand)</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Opening cash</span>
                  <span className="font-medium">{formatCurrency(cashFlow.opening_cash)}</span>
                </div>
                <div>
                  <p className="text-sm font-semibold text-emerald-600 mb-1">Cash In</p>
                  <Table>
                    <TableBody>
                      {cashFlow.inflows.length === 0 ? (
                        <TableRow><TableCell className="text-muted-foreground text-sm">No inflows</TableCell></TableRow>
                      ) : cashFlow.inflows.map((r, i) => (
                        <TableRow key={i}>
                          <TableCell className="capitalize">{r.label.replace(/_/g, " ")}</TableCell>
                          <TableCell className="text-right">{formatCurrency(r.amount)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="font-semibold"><TableCell>Total In</TableCell><TableCell className="text-right text-emerald-600">{formatCurrency(cashFlow.total_in)}</TableCell></TableRow>
                    </TableBody>
                  </Table>
                </div>
                <div>
                  <p className="text-sm font-semibold text-rose-600 mb-1">Cash Out</p>
                  <Table>
                    <TableBody>
                      {cashFlow.outflows.length === 0 ? (
                        <TableRow><TableCell className="text-muted-foreground text-sm">No outflows</TableCell></TableRow>
                      ) : cashFlow.outflows.map((r, i) => (
                        <TableRow key={i}>
                          <TableCell className="capitalize">{r.label.replace(/_/g, " ")}</TableCell>
                          <TableCell className="text-right">{formatCurrency(r.amount)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="font-semibold"><TableCell>Total Out</TableCell><TableCell className="text-right text-rose-600">{formatCurrency(cashFlow.total_out)}</TableCell></TableRow>
                    </TableBody>
                  </Table>
                </div>
                <div className="flex justify-between border-t pt-3 text-base font-bold">
                  <span>Net cash flow</span>
                  <span className={cashFlow.net_cash_flow >= 0 ? "text-emerald-600" : "text-rose-600"}>{formatCurrency(cashFlow.net_cash_flow)}</span>
                </div>
                <div className="flex justify-between text-base font-bold">
                  <span>Closing cash</span>
                  <span>{formatCurrency(cashFlow.closing_cash)}</span>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default FinancialStatementsPage;
