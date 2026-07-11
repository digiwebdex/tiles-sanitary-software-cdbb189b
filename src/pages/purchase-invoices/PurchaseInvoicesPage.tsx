/**
 * Purchase Invoice List — V2 Sprint 5D.
 * A Purchase Invoice IS a `purchases` row, so this reuses `purchaseService.list()`
 * (the same data source the frozen quick-entry Purchases page uses) rather than
 * a new endpoint — but renders its own status badges (draft/posted/cancelled),
 * since the frozen PurchaseList.tsx only distinguishes reversed/received and
 * would mislabel a draft or cancelled invoice.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { purchaseService } from "@/services/purchaseService";
import { useDealerId } from "@/hooks/useDealerId";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import Pagination from "@/components/Pagination";
import { Plus, Search } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

const PAGE_SIZE = 25;

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-muted text-muted-foreground" },
  pending_approval: { label: "Pending Approval", className: "bg-orange-100 text-orange-700" },
  posted: { label: "Posted", className: "bg-green-100 text-green-700" },
  reversed: { label: "Reversed", className: "bg-red-100 text-red-700" },
  cancelled: { label: "Cancelled", className: "bg-red-100 text-red-700" },
};

const PurchaseInvoicesPage = () => {
  const dealerId = useDealerId();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ["purchase-invoices", dealerId, search, page],
    queryFn: () => purchaseService.list(dealerId, page, search),
    enabled: !!dealerId,
  });

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Purchase Invoices</h1>
          <p className="text-sm text-muted-foreground">Invoice a completed Goods Receipt — full, partial, or across multiple GRNs.</p>
        </div>
        <Button onClick={() => navigate("/purchase-invoices/new")}>
          <Plus className="mr-2 h-4 w-4" /> Create Invoice from GRN
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by invoice number…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 space-y-3">
          <p className="text-muted-foreground">No purchase invoices found.</p>
          <Button onClick={() => navigate("/purchase-invoices/new")}>
            <Plus className="mr-2 h-4 w-4" /> Create Your First Invoice
          </Button>
        </div>
      ) : (
        <>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Due</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p: any) => {
                  const docStatus = p.document_status ?? "posted";
                  const badge = STATUS_BADGE[docStatus] ?? STATUS_BADGE.posted;
                  const dueAmount = Number(p.due_amount ?? 0);
                  return (
                    <TableRow key={p.id} className="cursor-pointer" onClick={() => navigate(`/purchase-invoices/${p.id}`)}>
                      <TableCell className="font-mono text-sm">
                        {p.invoice_number ?? <span className="text-muted-foreground italic">Draft</span>}
                      </TableCell>
                      <TableCell>{p.suppliers?.name ?? "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">{p.purchase_date}</TableCell>
                      <TableCell><Badge variant="secondary" className={badge.className}>{badge.label}</Badge></TableCell>
                      <TableCell className="text-right">{formatCurrency(Number(p.total_amount) || 0)}</TableCell>
                      <TableCell className="text-right font-semibold">{docStatus === "posted" ? formatCurrency(dueAmount) : "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {totalPages > 1 && (
            <Pagination page={page} totalItems={total} pageSize={PAGE_SIZE} onPageChange={setPage} />
          )}
        </>
      )}
    </div>
  );
};

export default PurchaseInvoicesPage;
