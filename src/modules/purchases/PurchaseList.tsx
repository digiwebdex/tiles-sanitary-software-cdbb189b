import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { purchaseService } from "@/services/purchaseService";
import Pagination from "@/components/Pagination";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus, Search, Eye, Download, RotateCcw, CreditCard, Barcode,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { usePermissions } from "@/hooks/usePermissions";
import { exportToExcel } from "@/lib/exportUtils";
import { toast } from "sonner";

interface PurchaseListProps {
  dealerId: string;
}

const PAGE_SIZE = 25;

const PurchaseList = ({ dealerId }: PurchaseListProps) => {
  const navigate = useNavigate();
  const permissions = usePermissions();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ["purchases", dealerId, page, search],
    queryFn: () => purchaseService.list(dealerId, page, search),
    enabled: !!dealerId,
  });

  const purchases = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === purchases.length) setSelected(new Set());
    else setSelected(new Set(purchases.map((p: any) => p.id)));
  };

  const handleExport = () => {
    if (!permissions.canExportReports) {
      toast.error("You don't have permission to export.");
      return;
    }
    exportToExcel(
      purchases.map((p: any) => ({
        date: p.purchase_date,
        invoice: p.invoice_number ?? "",
        supplier: p.suppliers?.name ?? "",
        total: Number(p.total_amount),
      })),
      [
        { header: "Date", key: "date" },
        { header: "Invoice", key: "invoice" },
        { header: "Supplier", key: "supplier" },
        { header: "Total", key: "total", format: "currency" as const },
      ],
      `purchases-${new Date().toISOString().split("T")[0]}`
    );
    toast.success("Purchases exported");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-foreground">Purchases</h1>
        <div className="flex gap-2">
          {permissions.canExportReports && (
            <Button variant="outline" onClick={handleExport}>
              <Download className="mr-2 h-4 w-4" /> Export
            </Button>
          )}
          <Button onClick={() => navigate("/purchases/new")}>
            <Plus className="mr-2 h-4 w-4" /> Add Purchase
          </Button>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by reference or supplier…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : purchases.length === 0 ? (
        <div className="text-center py-12 space-y-3">
          <p className="text-muted-foreground">No purchases found.</p>
          <Button onClick={() => navigate("/purchases/new")}>
            <Plus className="mr-2 h-4 w-4" /> Record Your First Purchase
          </Button>
        </div>
      ) : (
        <>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={purchases.length > 0 && selected.size === purchases.length}
                      onCheckedChange={toggleAll}
                    />
                  </TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Reference No</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Purchase Status</TableHead>
                  <TableHead className="text-right">Grand Total</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead>Payment Status</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {purchases.map((p: any) => {
                  const total = Number(p.net_payable ?? p.total_amount) || 0;
                  const paid = Number(p.paid_amount) || 0;
                  const balance = Number(p.due_amount ?? total - paid);
                  const status = p.payment_status ?? (balance <= 0.01 ? "paid" : paid > 0 ? "partial" : "pending");

                  return (
                    <TableRow key={p.id} className="cursor-pointer" onClick={() => navigate(`/purchases/${p.id}`)}>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selected.has(p.id)}
                          onCheckedChange={() => toggleSelect(p.id)}
                        />
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{p.purchase_date}</TableCell>
                      <TableCell className="font-mono text-sm">{p.invoice_number || "—"}</TableCell>
                      <TableCell>{p.suppliers?.name ?? "—"}</TableCell>
                      <TableCell>
                        {(p.document_status ?? "posted") === "reversed" ? (
                          <Badge variant="secondary" className="bg-red-100 text-red-700 text-xs">
                            Reversed
                          </Badge>
                        ) : (
                          <Badge className="bg-green-600 hover:bg-green-700 text-white text-xs">
                            Received
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{formatCurrency(total)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(paid)}</TableCell>
                      <TableCell className="text-right font-semibold">{formatCurrency(balance)}</TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={
                            status === "paid"
                              ? "bg-green-100 text-green-700 text-xs"
                              : status === "partial"
                                ? "bg-blue-100 text-blue-700 text-xs"
                                : "bg-orange-100 text-orange-700 text-xs"
                          }
                        >
                          {status === "paid" ? "Paid" : status === "partial" ? "Partial" : "Pending"}
                        </Badge>
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="sm" variant="outline" className="h-8 px-3 text-xs">
                              Actions
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => navigate(`/purchases/${p.id}`)}>
                              <Eye className="mr-2 h-4 w-4" /> Purchase Details
                            </DropdownMenuItem>
                            {balance > 0.01 && (
                              <DropdownMenuItem onClick={() => navigate(`/purchases/${p.id}?pay=1`)}>
                                <CreditCard className="mr-2 h-4 w-4" /> Record Payment
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => navigate(`/purchases/${p.id}`)}>
                              <Download className="mr-2 h-4 w-4" /> Download as PDF
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => navigate(`/purchases/${p.id}`)}>
                              <Barcode className="mr-2 h-4 w-4" /> Print Barcodes
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => navigate(`/purchase-returns/new?purchase_id=${p.id}`)}>
                              <RotateCcw className="mr-2 h-4 w-4" /> Return Purchase
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
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

export default PurchaseList;
