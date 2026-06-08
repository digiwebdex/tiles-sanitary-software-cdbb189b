import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { purchaseService } from "@/services/purchaseService";
import { useDealerId } from "@/hooks/useDealerId";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/utils";
import { CreditCard, Truck } from "lucide-react";

/** Lists purchase bills with outstanding supplier balance. */
const SupplierPayablesPage = () => {
  const dealerId = useDealerId();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ["purchases", dealerId, "payables"],
    queryFn: async () => {
      const body = await purchaseService.list(dealerId, 1);
      return (body.data ?? []).filter((p: any) => (Number(p.due_amount) || 0) > 0.01);
    },
    enabled: !!dealerId,
  });

  const rows = data ?? [];
  const totalDue = rows.reduce((sum: number, p: any) => sum + (Number(p.due_amount) || 0), 0);

  return (
    <div className="container mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Truck className="h-6 w-6 text-primary" /> Supplier Payables
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Unpaid purchase bills — pay suppliers from here or from Purchases → Details.
          </p>
        </div>
        <Button onClick={() => navigate("/purchases/new")}>New Purchase</Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Total Outstanding to Suppliers</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold text-destructive">{formatCurrency(totalDue)}</p>
        </CardContent>
      </Card>

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            No unpaid purchase bills. All supplier balances are settled.
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">Due</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p: any) => (
                <TableRow key={p.id}>
                  <TableCell>{p.purchase_date}</TableCell>
                  <TableCell className="font-mono text-sm">{p.invoice_number || "—"}</TableCell>
                  <TableCell>{p.suppliers?.name ?? "—"}</TableCell>
                  <TableCell className="text-right">{formatCurrency(p.net_payable ?? p.total_amount)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(p.paid_amount ?? 0)}</TableCell>
                  <TableCell className="text-right font-semibold text-destructive">{formatCurrency(p.due_amount)}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="bg-orange-100 text-orange-700 text-xs">
                      {p.payment_status === "partial" ? "Partial" : "Pending"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button size="sm" onClick={() => navigate(`/purchases/${p.id}?pay=1`)}>
                      <CreditCard className="mr-1 h-3 w-3" /> Pay
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
};

export default SupplierPayablesPage;
