import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search, Eye, Pencil, ClipboardList } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import Pagination from "@/components/Pagination";

import { useDealerId } from "@/hooks/useDealerId";
import { salesOrderService, type SalesOrderStatus } from "@/services/salesOrderService";
import { SalesOrderStatusBadge } from "@/components/salesOrder/SalesOrderStatusBadge";
import { formatCurrency, parseLocalDate } from "@/lib/utils";
import SalesOrderDetailDialog from "./SalesOrderDetailDialog";
import { ProjectSiteFilter } from "@/components/project/ProjectSiteFilter";

const fmtDate = (d: string) => {
  const dt = parseLocalDate(d);
  return dt ? dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : d;
};

const SalesOrderList = () => {
  const navigate = useNavigate();
  const dealerId = useDealerId();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<SalesOrderStatus | "">("");
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["sales-orders", dealerId, search, status, page, projectId],
    queryFn: () => salesOrderService.list(dealerId, { search, status, page, projectId }),
  });

  const total = data?.total ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Sales Orders</h1>
          <p className="text-sm text-muted-foreground">
            Confirmed commitments to deliver — reserves stock automatically on confirm
          </p>
        </div>
        <Button onClick={() => navigate("/sales-orders/new")}>
          <Plus className="h-4 w-4 mr-1" /> New Sales Order
        </Button>
      </div>

      <Card>
        <CardContent className="pt-4 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by SO number or customer name"
              className="pl-8"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
          <Select value={status || "__all"} onValueChange={(v) => { setStatus(v === "__all" ? "" : (v as SalesOrderStatus)); setPage(1); }}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="confirmed">Confirmed</SelectItem>
              <SelectItem value="partially_delivered">Partially Delivered</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
          <ProjectSiteFilter
            dealerId={dealerId}
            projectId={projectId}
            siteId={null}
            onChange={({ projectId: pid }) => { setProjectId(pid); setPage(1); }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2">SO #</th>
                <th className="text-left px-3 py-2">Customer</th>
                <th className="text-left px-3 py-2">Order Date</th>
                <th className="text-left px-3 py-2">Planned Delivery</th>
                <th className="text-right px-3 py-2">Total</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-right px-3 py-2 w-24">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</td></tr>
              ) : (data?.data ?? []).length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-10 text-muted-foreground">
                    <ClipboardList className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    No sales orders yet. Click <strong>New Sales Order</strong> to start.
                  </td>
                </tr>
              ) : (
                (data?.data ?? []).map((so) => {
                  const customerName = so.customers?.name ?? so.customer_name_text ?? "—";
                  const isDraft = so.status === "draft";
                  return (
                    <tr key={so.id} className="border-t hover:bg-accent/30">
                      <td className="px-3 py-2 font-mono">{so.so_number}</td>
                      <td className="px-3 py-2">{customerName}</td>
                      <td className="px-3 py-2">{fmtDate(so.order_date)}</td>
                      <td className="px-3 py-2">{so.planned_delivery_date ? fmtDate(so.planned_delivery_date) : "—"}</td>
                      <td className="px-3 py-2 text-right font-semibold">{formatCurrency(so.total_amount)}</td>
                      <td className="px-3 py-2"><SalesOrderStatusBadge status={so.status} /></td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => setDetailId(so.id)} title="View">
                            <Eye className="h-4 w-4" />
                          </Button>
                          {isDraft && (
                            <Button variant="ghost" size="icon" onClick={() => navigate(`/sales-orders/${so.id}/edit`)} title="Edit draft">
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Pagination page={page} totalItems={total} pageSize={25} onPageChange={setPage} />

      {detailId && (
        <SalesOrderDetailDialog salesOrderId={detailId} open={!!detailId} onOpenChange={(o) => !o && setDetailId(null)} />
      )}
    </div>
  );
};

export default SalesOrderList;
