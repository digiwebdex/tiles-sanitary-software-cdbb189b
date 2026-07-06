import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Wallet } from "lucide-react";
import { supplierService } from "@/services/supplierService";

interface Props {
  supplierId: string;
}

const money = (n: number) => `৳${n.toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Supplier Ledger Summary (V2 Sprint 5A). Assembles data that already
 * exists (supplier_ledger + the pre-existing computeSupplierBalance/
 * computeSupplierOutstanding math) — no new balance logic.
 */
export function SupplierLedgerSummaryPanel({ supplierId }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["supplier-ledger-summary", supplierId],
    queryFn: () => supplierService.getLedgerSummary(supplierId),
    enabled: !!supplierId,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Wallet className="h-4 w-4" /> Ledger Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading…</p>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Wallet className="h-4 w-4" /> Ledger Summary
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-4">
          <div>
            <p className="text-[11px] text-muted-foreground">Opening Balance</p>
            <p className="text-base font-semibold">{money(data.supplier.opening_balance)}</p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">Total Purchased</p>
            <p className="text-base font-semibold">{money(data.total_purchased)}</p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">Total Paid</p>
            <p className="text-base font-semibold">{money(data.total_paid)}</p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">Outstanding (Payable)</p>
            <p className={`text-base font-semibold ${data.outstanding > 0 ? "text-destructive" : ""}`}>
              {money(data.outstanding)}
            </p>
          </div>
        </div>

        {data.entries.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground italic">No ledger entries yet.</p>
        ) : (
          <div className="mt-4 max-h-72 overflow-y-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 sticky top-0">
                <tr className="text-left text-[11px] text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Description</th>
                  <th className="px-3 py-2 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((e) => (
                  <tr key={e.id} className="border-t">
                    <td className="px-3 py-2 whitespace-nowrap">{new Date(e.entry_date).toLocaleDateString()}</td>
                    <td className="px-3 py-2 capitalize">{e.type}</td>
                    <td className="px-3 py-2 text-muted-foreground">{e.description || "—"}</td>
                    <td className={`px-3 py-2 text-right ${Number(e.amount) < 0 ? "text-destructive" : ""}`}>
                      {money(Number(e.amount))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default SupplierLedgerSummaryPanel;
