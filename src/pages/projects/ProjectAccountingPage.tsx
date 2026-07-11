/**
 * Project Accounting — V2 Sprint 6D.
 * Project Master itself is unchanged (see ProjectsPage.tsx / projectService.ts)
 * — this page is purely the accounting overlay: pick a project, see its
 * Budget, Revenue, Expense, Profitability, and GL Ledger.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useDealerId } from "@/hooks/useDealerId";
import { projectService } from "@/services/projectService";
import { projectAccountingService } from "@/services/projectAccountingService";
import { FolderKanban } from "lucide-react";

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ProjectAccountingPage = () => {
  const dealerId = useDealerId();
  const [projectId, setProjectId] = useState<string>("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const { data: projects } = useQuery({
    queryKey: ["projects-picker", dealerId],
    queryFn: () => projectService.listForPicker(dealerId!),
    enabled: !!dealerId,
  });

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ["project-accounting-summary", dealerId, projectId],
    queryFn: () => projectAccountingService.summary(dealerId!, projectId),
    enabled: !!dealerId && !!projectId,
  });

  const { data: expenses } = useQuery({
    queryKey: ["project-accounting-expenses", dealerId, projectId, from, to],
    queryFn: () => projectAccountingService.expenses(dealerId!, projectId, from || undefined, to || undefined),
    enabled: !!dealerId && !!projectId,
  });

  const { data: ledger } = useQuery({
    queryKey: ["project-accounting-ledger", dealerId, projectId, from, to],
    queryFn: () => projectAccountingService.ledger(dealerId!, projectId, from || undefined, to || undefined),
    enabled: !!dealerId && !!projectId,
  });

  return (
    <div className="container mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-bold flex items-center gap-2"><FolderKanban className="h-6 w-6" /> Project Accounting</h1>

      <Card>
        <CardContent className="pt-6 flex flex-wrap gap-3 items-end">
          <div className="min-w-[260px]">
            <Label>Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger><SelectValue placeholder="Select a project" /></SelectTrigger>
              <SelectContent>
                {(projects ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.project_code} — {p.project_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </CardContent>
      </Card>

      {!projectId && <p className="text-muted-foreground">Select a project to view its budget, revenue, expense, and ledger.</p>}

      {projectId && summaryLoading && <p>Loading…</p>}

      {projectId && summary && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Revenue</p><p className="text-2xl font-bold">{money(summary.revenue)}</p></CardContent></Card>
            <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Expense</p><p className="text-2xl font-bold">{money(summary.expense)}</p></CardContent></Card>
            <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Profit</p><p className={`text-2xl font-bold ${summary.profit < 0 ? "text-destructive" : ""}`}>{money(summary.profit)}</p></CardContent></Card>
            <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Margin</p><p className="text-2xl font-bold">{summary.margin_percent != null ? `${summary.margin_percent}%` : "—"}</p></CardContent></Card>
          </div>

          <Card>
            <CardHeader><CardTitle>Budget</CardTitle></CardHeader>
            <CardContent>
              {summary.budget ? (
                <div className="flex gap-6 text-sm">
                  <span>Allocated: <strong>{money(summary.budget.amount)}</strong></span>
                  <span>Period: {summary.budget.period_start} – {summary.budget.period_end}</span>
                  <span>Variance: <strong className={summary.budget_variance != null && summary.budget_variance < 0 ? "text-destructive" : ""}>{summary.budget_variance != null ? money(summary.budget_variance) : "—"}</strong></span>
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">No budget allocated yet for this project — set one on the Budget Management page.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Expenses ({expenses?.rows.length ?? 0})</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(expenses?.rows ?? []).map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>{e.expense_date}</TableCell>
                      <TableCell>{e.description}</TableCell>
                      <TableCell className="text-muted-foreground">{e.category || "—"}</TableCell>
                      <TableCell className="text-right">{money(e.amount)}</TableCell>
                    </TableRow>
                  ))}
                  {!(expenses?.rows ?? []).length && (
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No expenses recorded for this project.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Ledger ({ledger?.line_count ?? 0} lines)</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2 flex-wrap">
                {Object.entries(ledger?.by_domain ?? {}).map(([domain, amt]) => (
                  <Badge key={domain} variant="outline" className="capitalize">{domain}: {money(amt)}</Badge>
                ))}
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Domain</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(ledger?.lines ?? []).map((l, i) => (
                    <TableRow key={i}>
                      <TableCell>{l.entry_date}</TableCell>
                      <TableCell className="capitalize">{l.line_domain}</TableCell>
                      <TableCell>{l.line_type}</TableCell>
                      <TableCell className={`text-right ${l.amount < 0 ? "text-destructive" : ""}`}>{money(l.amount)}</TableCell>
                    </TableRow>
                  ))}
                  {!(ledger?.lines ?? []).length && (
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No GL activity tagged to this project yet.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

export default ProjectAccountingPage;
