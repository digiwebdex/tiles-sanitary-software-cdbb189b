import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { salesReturnService } from "@/services/salesReturnService";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, Search, Eye, FileText, Trash2, MoreHorizontal, Repeat } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { useState } from "react";
import Pagination from "@/components/Pagination";

interface SalesReturnListProps {
  dealerId: string;
}

const PAGE_SIZE = 25;

const SalesReturnList = ({ dealerId }: SalesReturnListProps) => {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);

  const { data: returns = [], isLoading } = useQuery({
    queryKey: ["sales-returns", dealerId],
    queryFn: () => salesReturnService.list(dealerId),
    enabled: !!dealerId,
  });

  const filtered = returns.filter((r: any) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const customerName = r.sales?.customers?.name ?? "";
    const invoiceNo = r.sales?.invoice_number ?? "";
    const productName = r.products?.name ?? "";
    return (
      customerName.toLowerCase().includes(q) ||
      invoiceNo.toLowerCase().includes(q) ||
      productName.toLowerCase().includes(q)
    );
  });

  const total = filtered.length;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const toggleAll = () => {
    if (selected.length === paginated.length) {
      setSelected([]);
    } else {
      setSelected(paginated.map((r: any) => r.id));
    }
  };

  const toggleOne = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Sales Returns</h1>
          <p className="text-sm text-muted-foreground">
            Please use the table below to navigate or filter the results.
          </p>
        </div>
        <Button onClick={() => navigate("/sales-returns/new")}>
          <Plus className="mr-2 h-4 w-4" /> Add Return
        </Button>
      </div>

      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Show <strong>{paginated.length}</strong> of <strong>{total}</strong>
        </div>
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-8"
          />
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow className="bg-primary text-primary-foreground [&>th]:text-primary-foreground">
              <TableHead className="w-10">
                <Checkbox
                  checked={paginated.length > 0 && selected.length === paginated.length}
                  onCheckedChange={toggleAll}
                />
              </TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Reference No</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Product</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Grand Total</TableHead>
              <TableHead className="w-24 text-center">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-8">Loading…</TableCell>
              </TableRow>
            ) : paginated.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-8">No returns found.</TableCell>
              </TableRow>
            ) : (
              paginated.map((r: any) => (
                <TableRow key={r.id} className="hover:bg-muted/50 cursor-pointer" onClick={() => navigate(`/sales/${r.sale_id}/invoice`)}>
                  <TableCell>
                    <Checkbox
                      checked={selected.includes(r.id)}
                      onCheckedChange={() => toggleOne(r.id)}
                    />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm">
                    {r.return_date}
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {r.sales?.invoice_number ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {r.sales?.customers?.name ?? "—"}
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{r.products?.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">{r.products?.sku}</div>
                  </TableCell>
                  <TableCell>
                    {r.is_broken ? (
                      <Badge variant="destructive" className="text-xs">Broken</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs">Restocked</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium text-sm">
                    {formatCurrency(r.refund_amount)}
                  </TableCell>
                  <TableCell className="text-center">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem>
                          <Eye className="mr-2 h-4 w-4" /> View Details
                        </DropdownMenuItem>
                        <DropdownMenuItem>
                          <FileText className="mr-2 h-4 w-4" /> Download PDF
                        </DropdownMenuItem>
                        {!r.exchange_sale_id && (
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate("/sales/new", {
                                state: {
                                  exchange_return_id: r.id,
                                  customer_name: r.sales?.customers?.name ?? "",
                                },
                              });
                            }}
                          >
                            <Repeat className="mr-2 h-4 w-4" /> Exchange for New Sale
                          </DropdownMenuItem>
                        )}
                        {r.exchange_sale_id && (
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/sales/${r.exchange_sale_id}/invoice`);
                            }}
                          >
                            <Repeat className="mr-2 h-4 w-4" /> View Exchange Sale
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem className="text-destructive">
                          <Trash2 className="mr-2 h-4 w-4" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <Pagination page={page} totalItems={total} pageSize={PAGE_SIZE} onPageChange={setPage} />
      )}
    </div>
  );
};

export default SalesReturnList;
