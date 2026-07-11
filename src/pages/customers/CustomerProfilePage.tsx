import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft, BookOpen, CalendarClock, CreditCard, FileText, Pencil,
  Phone, Receipt, ShoppingCart, UserRound, Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useDealerId } from "@/hooks/useDealerId";
import { customerService } from "@/services/customerService";
import { customerStatementService } from "@/services/customerStatementService";
import { emiService } from "@/services/emiService";
import { formatCurrency } from "@/lib/utils";

/**
 * Customer 360° profile — one place for everything about a customer:
 * balances, full transaction history, invoices, EMI plans and contact info.
 * Mirrors the legacy Bangla ERP "Customer 360° Profile" screen.
 */
export default function CustomerProfilePage() {
  const { id = "" } = useParams();
  const dealerId = useDealerId();
  const navigate = useNavigate();

  const { data: customer, isLoading: customerLoading } = useQuery({
    queryKey: ["customer", id],
    queryFn: () => customerService.getById(id),
    enabled: !!id,
  });

  const { data: statement, isLoading: statementLoading } = useQuery({
    queryKey: ["customer-statement", id, dealerId],
    queryFn: () => customerStatementService.get(id, dealerId!),
    enabled: !!id && !!dealerId,
  });

  const { data: emiData } = useQuery({
    queryKey: ["customer-emi", dealerId],
    queryFn: () => emiService.list(dealerId!, { limit: 200 }),
    enabled: !!dealerId,
  });

  const emiPlans = useMemo(
    () => (emiData?.rows ?? []).filter((p) => p.customer_id === id),
    [emiData, id],
  );

  const entries = statement?.entries ?? [];
  const invoices = entries.filter((e) => e.type === "sale");
  const payments = entries.filter((e) => e.type === "payment");
  const due = statement?.closing_balance ?? 0;

  if (customerLoading) {
    return <div className="container mx-auto p-6 text-sm text-muted-foreground">Loading…</div>;
  }
  if (!customer) {
    return (
      <div className="container mx-auto p-6">
        <p className="text-sm text-muted-foreground">Customer not found.</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate("/customers")}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Customers
        </Button>
      </div>
    );
  }

  const stats = [
    { label: "Current Due (বর্তমান বকেয়া)", value: formatCurrency(due), tone: due > 0 ? "text-destructive" : "text-green-600" },
    { label: "Total Purchases (মোট ক্রয়)", value: formatCurrency(statement?.totals.debit ?? 0), tone: "" },
    { label: "Total Paid (মোট পরিশোধ)", value: formatCurrency(statement?.totals.credit ?? 0), tone: "" },
    { label: "EMI Plans (ইএমআই)", value: String(emiPlans.length), tone: "" },
  ];

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/customers")} aria-label="Back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <UserRound className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              {customer.name}
              <Badge variant={customer.status === "active" ? "default" : "secondary"} className="ml-2 align-middle">
                {customer.status}
              </Badge>
            </h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span className="capitalize">{customer.type}</span>
              {customer.phone && (
                <span className="inline-flex items-center gap-1">
                  <Phone className="h-3.5 w-3.5" /> {customer.phone}
                </span>
              )}
              {customer.address && <span>{customer.address}</span>}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => navigate("/sales/new")}>
            <ShoppingCart className="mr-1 h-4 w-4" /> New Sale
          </Button>
          <Button size="sm" variant="outline" onClick={() => navigate("/collections")}>
            <Wallet className="mr-1 h-4 w-4" /> Record Payment
          </Button>
          <Button size="sm" variant="outline" onClick={() => navigate(`/customers/${id}/statement`)}>
            <FileText className="mr-1 h-4 w-4" /> Statement
          </Button>
          <Button size="sm" variant="outline" onClick={() => navigate(`/ledger?customer=${id}`)}>
            <BookOpen className="mr-1 h-4 w-4" /> Ledger
          </Button>
          <Button size="sm" variant="ghost" onClick={() => navigate(`/customers/${id}/edit`)}>
            <Pencil className="mr-1 h-4 w-4" /> Edit
          </Button>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className={`mt-1 text-xl font-bold ${s.tone}`}>{statementLoading ? "…" : s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="transactions">
        <TabsList>
          <TabsTrigger value="transactions">Transactions (লেনদেন)</TabsTrigger>
          <TabsTrigger value="invoices">Invoices (ইনভয়েস)</TabsTrigger>
          <TabsTrigger value="payments">Payments (পেমেন্ট)</TabsTrigger>
          <TabsTrigger value="emi">EMI (ইএমআই)</TabsTrigger>
          <TabsTrigger value="info">Info (তথ্য)</TabsTrigger>
        </TabsList>

        <TabsContent value="transactions">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {statementLoading ? (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
                  ) : entries.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No transactions</TableCell></TableRow>
                  ) : (
                    entries.map((e, i) => (
                      <TableRow key={i}>
                        <TableCell className="whitespace-nowrap">{e.date}</TableCell>
                        <TableCell>{e.description}</TableCell>
                        <TableCell className="text-right">{e.debit ? formatCurrency(e.debit) : "—"}</TableCell>
                        <TableCell className="text-right">{e.credit ? formatCurrency(e.credit) : "—"}</TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(e.balance)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="invoices">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.length === 0 ? (
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No invoices</TableCell></TableRow>
                  ) : (
                    invoices.map((e, i) => (
                      <TableRow key={i}>
                        <TableCell className="whitespace-nowrap">{e.date}</TableCell>
                        <TableCell>
                          <span className="inline-flex items-center gap-1">
                            <Receipt className="h-3.5 w-3.5 text-muted-foreground" />
                            {e.sale_invoice ?? "—"}
                          </span>
                        </TableCell>
                        <TableCell>{e.description}</TableCell>
                        <TableCell className="text-right">{formatCurrency(e.debit)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payments">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.length === 0 ? (
                    <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">No payments</TableCell></TableRow>
                  ) : (
                    payments.map((e, i) => (
                      <TableRow key={i}>
                        <TableCell className="whitespace-nowrap">{e.date}</TableCell>
                        <TableCell>{e.description}</TableCell>
                        <TableCell className="text-right text-green-600">{formatCurrency(e.credit)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="emi">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Plan</TableHead>
                    <TableHead>Start</TableHead>
                    <TableHead className="text-right">Principal</TableHead>
                    <TableHead className="text-right">Tenure</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {emiPlans.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No EMI plans</TableCell></TableRow>
                  ) : (
                    emiPlans.map((p) => (
                      <TableRow key={p.id} className="cursor-pointer" onClick={() => navigate("/emi")}>
                        <TableCell>
                          <span className="inline-flex items-center gap-1">
                            <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" /> {p.plan_no}
                          </span>
                        </TableCell>
                        <TableCell>{p.start_date}</TableCell>
                        <TableCell className="text-right">{formatCurrency(p.principal)}</TableCell>
                        <TableCell className="text-right">{p.tenure_months} mo</TableCell>
                        <TableCell><Badge variant="outline">{p.status}</Badge></TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="info">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Customer Information (কাস্টমারের তথ্য)</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2 text-sm">
                {[
                  ["Name", customer.name],
                  ["Type", customer.type],
                  ["Phone", customer.phone ?? "—"],
                  ["Address", customer.address ?? "—"],
                  ["Reference", customer.reference_name ?? "—"],
                  ["Opening Balance", formatCurrency(Number(customer.opening_balance ?? 0))],
                  ["Credit Limit", statement ? formatCurrency(statement.customer.credit_limit) : "—"],
                  ["Status", customer.status],
                ].map(([label, value]) => (
                  <div key={label as string}>
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="font-medium capitalize">{value as string}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
