import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";
import { formatCurrency } from "@/lib/utils";
import { formatStockUnit } from "@/lib/units";
import { exportToExcel } from "@/lib/exportUtils";
import { usePermissions } from "@/hooks/usePermissions";
import Pagination from "@/components/Pagination";
import { Download, UserCheck, Truck, TruckIcon, Search } from "lucide-react";
import { PostingTraceDialog, type PostingTraceTarget } from "@/components/PostingTraceDialog";

// ─── Sales by Salesman Report ─────────────────────────────
export function SalesBySalesmanReport({ dealerId }: { dealerId: string }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const { canExportReports } = usePermissions();

  const { data, isLoading } = useQuery({
    queryKey: ["report-sales-by-salesman", dealerId, year, month],
    queryFn: async () => {
      const res = await vpsAuthedFetch(
        `/api/reports/sales-by-salesman?dealerId=${dealerId}&year=${year}&month=${month}`,
      );
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed");
      const body = await res.json();
      return (body.rows ?? []) as Array<{
        name: string; count: number; total: number; paid: number; due: number; discount: number;
      }>;
    },
  });

  const rows = data ?? [];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
        <CardTitle className="text-base flex items-center gap-2"><UserCheck className="h-4 w-4" /> Sales by Salesman</CardTitle>
        <div className="flex items-center gap-2">
          <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
            <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
            <SelectContent>
              {months.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[0, 1, 2, 3, 4].map(i => <SelectItem key={i} value={String(new Date().getFullYear() - i)}>{new Date().getFullYear() - i}</SelectItem>)}
            </SelectContent>
          </Select>
          {canExportReports && rows.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => exportToExcel(rows, [
              { header: "Salesman", key: "name" },
              { header: "Invoices", key: "count", format: "number" },
              { header: "Total Sales", key: "total", format: "currency" },
              { header: "Collected", key: "paid", format: "currency" },
              { header: "Due", key: "due", format: "currency" },
              { header: "Avg Ticket", key: "avgTicket", format: "currency" },
            ], `sales-by-salesman-${year}-${month}`)}>
              <Download className="h-4 w-4 mr-1" /> Export
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? <p className="text-muted-foreground">Loading…</p> : rows.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No sales found for this period</p>
        ) : (
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Salesman</TableHead>
                  <TableHead className="text-right">Invoices</TableHead>
                  <TableHead className="text-right">Total Sales</TableHead>
                  <TableHead className="text-right">Collected</TableHead>
                  <TableHead className="text-right">Due</TableHead>
                  <TableHead className="text-right">Discount</TableHead>
                  <TableHead className="text-right">Avg Ticket</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.name}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-right">{r.count}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(r.total)}</TableCell>
                    <TableCell className="text-right text-primary">{formatCurrency(r.paid)}</TableCell>
                    <TableCell className={`text-right ${r.due > 0 ? "text-destructive" : ""}`}>{formatCurrency(r.due)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(r.discount)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(r.count > 0 ? r.total / r.count : 0)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/50 font-semibold">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right">{rows.reduce((s, r) => s + r.count, 0)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(rows.reduce((s, r) => s + r.total, 0))}</TableCell>
                  <TableCell className="text-right">{formatCurrency(rows.reduce((s, r) => s + r.paid, 0))}</TableCell>
                  <TableCell className="text-right">{formatCurrency(rows.reduce((s, r) => s + r.due, 0))}</TableCell>
                  <TableCell className="text-right">{formatCurrency(rows.reduce((s, r) => s + r.discount, 0))}</TableCell>
                  <TableCell className="text-right">—</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Supplier Outstanding Summary ─────────────────────────
export function SupplierOutstandingReport({ dealerId }: { dealerId: string }) {
  const { canExportReports } = usePermissions();
  const [traceTarget, setTraceTarget] = useState<PostingTraceTarget | null>(null);
  const [traceOpen, setTraceOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["report-supplier-outstanding", dealerId],
    queryFn: async () => {
      const res = await vpsAuthedFetch(
        `/api/reports/supplier-outstanding?dealerId=${dealerId}`,
      );
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed");
      const body = await res.json();
      return (body.rows ?? []) as Array<{
        supplierId: string; name: string; phone: string; totalPurchase: number;
        totalPaid: number; outstanding: number; payments: number;
      }>;
    },
  });

  const rows = data ?? [];

  const openTrace = (supplierId: string, name: string) => {
    setTraceTarget({ lineDomain: "supplier", partyId: supplierId, partyName: name });
    setTraceOpen(true);
  };

  return (
    <>
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base">Supplier Outstanding Summary</CardTitle>
        {canExportReports && rows.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => exportToExcel(rows, [
            { header: "Supplier", key: "name" },
            { header: "Phone", key: "phone" },
            { header: "Total Purchase", key: "totalPurchase", format: "currency" },
            { header: "Total Paid", key: "totalPaid", format: "currency" },
            { header: "Outstanding", key: "outstanding", format: "currency" },
          ], "supplier-outstanding")}>
            <Download className="h-4 w-4 mr-1" /> Export
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? <p className="text-muted-foreground">Loading…</p> : rows.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">No outstanding payables</p>
        ) : (
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead className="text-right">Total Purchase</TableHead>
                  <TableHead className="text-right">Total Paid</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(r => (
                  <TableRow key={r.supplierId}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell>{r.phone}</TableCell>
                    <TableCell className="text-right">{formatCurrency(r.totalPurchase)}</TableCell>
                    <TableCell className="text-right text-primary">{formatCurrency(r.totalPaid)}</TableCell>
                    <TableCell className="text-right font-semibold text-destructive">{formatCurrency(r.outstanding)}</TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 px-2"
                        onClick={() => openTrace(r.supplierId, r.name)}
                        title="View posting trace"
                      >
                        <Search className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/50 font-semibold">
                  <TableCell colSpan={2}>Total</TableCell>
                  <TableCell className="text-right">{formatCurrency(rows.reduce((s, r) => s + r.totalPurchase, 0))}</TableCell>
                  <TableCell className="text-right">{formatCurrency(rows.reduce((s, r) => s + r.totalPaid, 0))}</TableCell>
                  <TableCell className="text-right">{formatCurrency(rows.reduce((s, r) => s + r.outstanding, 0))}</TableCell>
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
    <PostingTraceDialog
      open={traceOpen}
      onOpenChange={setTraceOpen}
      dealerId={dealerId}
      target={traceTarget}
    />
    </>
  );
}

// ─── Pending Delivery Report ──────────────────────────────
export function PendingDeliveryReport({ dealerId }: { dealerId: string }) {
  const { canExportReports } = usePermissions();

  const { data, isLoading } = useQuery({
    queryKey: ["report-pending-delivery", dealerId],
    queryFn: async () => {
      const res = await vpsAuthedFetch(
        `/api/reports/pending-deliveries?dealerId=${dealerId}`,
      );
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed");
      const body = await res.json();
      return (body.rows ?? []) as Array<{
        challanNo: string; challanDate: string; invoiceNo: string; customer: string;
        status: string; transport: string; vehicle: string; daysPending: number; isLate: boolean;
      }>;
    },
  });

  const rows = data ?? [];
  const lateCount = rows.filter(r => r.isLate).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <Card className="flex-1 min-w-[140px]">
          <CardContent className="p-3 text-center">
            <p className="text-xs text-muted-foreground">Pending</p>
            <p className="text-xl font-bold">{rows.length}</p>
          </CardContent>
        </Card>
        <Card className="flex-1 min-w-[140px]">
          <CardContent className="p-3 text-center">
            <p className="text-xs text-muted-foreground">Late (&gt;2 days)</p>
            <p className="text-xl font-bold text-destructive">{lateCount}</p>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base flex items-center gap-2"><Truck className="h-4 w-4" /> Pending Deliveries</CardTitle>
          {canExportReports && rows.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => exportToExcel(rows, [
              { header: "Challan#", key: "challanNo" },
              { header: "Date", key: "challanDate" },
              { header: "Invoice#", key: "invoiceNo" },
              { header: "Customer", key: "customer" },
              { header: "Status", key: "status" },
              { header: "Transport", key: "transport" },
              { header: "Days Pending", key: "daysPending", format: "number" },
            ], "pending-deliveries")}>
              <Download className="h-4 w-4 mr-1" /> Export
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? <p className="text-muted-foreground">Loading…</p> : rows.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">All deliveries are completed ✓</p>
            </div>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Challan#</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Invoice#</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Transport</TableHead>
                    <TableHead className="text-right">Days Pending</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(r => (
                    <TableRow key={r.challanNo} className={r.isLate ? "bg-destructive/5" : ""}>
                      <TableCell className="font-mono text-sm">{r.challanNo}</TableCell>
                      <TableCell>{r.challanDate}</TableCell>
                      <TableCell className="font-mono text-sm">{r.invoiceNo}</TableCell>
                      <TableCell className="font-medium">{r.customer}</TableCell>
                      <TableCell>
                        <Badge variant={r.status === "dispatched" ? "secondary" : "outline"} className="capitalize text-xs">{r.status}</Badge>
                      </TableCell>
                      <TableCell>{r.transport}</TableCell>
                      <TableCell className={`text-right font-semibold ${r.isLate ? "text-destructive" : ""}`}>{r.daysPending}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Delivery Status Report ───────────────────────────────
export function DeliveryStatusReport({ dealerId }: { dealerId: string }) {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const { canExportReports } = usePermissions();

  const { data, isLoading } = useQuery({
    queryKey: ["report-delivery-status", dealerId, statusFilter],
    queryFn: async () => {
      const res = await vpsAuthedFetch(
        `/api/reports/delivery-status?dealerId=${dealerId}&status=${encodeURIComponent(statusFilter)}`,
      );
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed");
      const body = await res.json();
      return (body.rows ?? []) as Array<{
        challanNo: string; challanDate: string; invoiceNo: string; customer: string;
        status: string; transport: string; vehicle: string; driver: string;
      }>;
    },
  });

  const rows = data ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
        <CardTitle className="text-base flex items-center gap-2"><TruckIcon className="h-4 w-4" /> Delivery Status</CardTitle>
        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="dispatched">Dispatched</SelectItem>
              <SelectItem value="delivered">Delivered</SelectItem>
            </SelectContent>
          </Select>
          {canExportReports && rows.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => exportToExcel(rows, [
              { header: "Challan#", key: "challanNo" },
              { header: "Date", key: "challanDate" },
              { header: "Invoice#", key: "invoiceNo" },
              { header: "Customer", key: "customer" },
              { header: "Status", key: "status" },
              { header: "Transport", key: "transport" },
              { header: "Vehicle", key: "vehicle" },
              { header: "Driver", key: "driver" },
            ], "delivery-status")}>
              <Download className="h-4 w-4 mr-1" /> Export
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? <p className="text-muted-foreground">Loading…</p> : rows.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">No challans found</p>
        ) : (
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Challan#</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Invoice#</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Transport</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Driver</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(r => (
                  <TableRow key={r.challanNo}>
                    <TableCell className="font-mono text-sm">{r.challanNo}</TableCell>
                    <TableCell>{r.challanDate}</TableCell>
                    <TableCell className="font-mono text-sm">{r.invoiceNo}</TableCell>
                    <TableCell className="font-medium">{r.customer}</TableCell>
                    <TableCell>
                      <Badge
                        variant={r.status === "delivered" ? "default" : r.status === "dispatched" ? "secondary" : "outline"}
                        className="capitalize text-xs"
                      >{r.status}</Badge>
                    </TableCell>
                    <TableCell>{r.transport}</TableCell>
                    <TableCell>{r.vehicle}</TableCell>
                    <TableCell>{r.driver}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Stock Movement Report ────────────────────────────────
export function StockMovementReport({ dealerId }: { dealerId: string }) {
  const [productId, setProductId] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;
  const { canExportReports } = usePermissions();

  const { data: products } = useQuery({
    queryKey: ["products-list-movement", dealerId],
    queryFn: async () => {
      const res = await vpsAuthedFetch(
        `/api/products?dealerId=${dealerId}&pageSize=200&f.active=true&orderBy=name&orderDir=asc`,
      );
      if (!res.ok) return [] as Array<{ id: string; name: string; sku: string }>;
      const body = await res.json();
      return (body.rows ?? []) as Array<{ id: string; name: string; sku: string }>;
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ["report-stock-movement", dealerId, productId, page],
    queryFn: async () => {
      if (!productId) return { rows: [], total: 0, allRows: [] as any[], unitType: "piece", piecesPerBox: 1 };
      const res = await vpsAuthedFetch(
        `/api/reports/stock-movement?dealerId=${dealerId}&productId=${productId}`,
      );
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed");
      const body = await res.json();
      const allRows = (body.rows ?? []) as Array<{
        id: string; date: string; type: string; reference: string;
        qtyIn: number; qtyOut: number; rate: number; total: number; balance: number;
      }>;
      const total = allRows.length;
      const paged = allRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
      return {
        rows: paged,
        total,
        allRows,
        unitType: body.unitType ?? "piece",
        piecesPerBox: Number(body.piecesPerBox) || 1,
      };
    },
    enabled: !!productId,
  });

  const rows = data?.rows ?? [];
  const isTile = (data?.unitType ?? "piece") === "box_sft";
  const ppb = data?.piecesPerBox || 1;
  const fmt = (q: number) => formatStockUnit(q, ppb, isTile);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 pb-2">
        <CardTitle className="text-base">Stock Movement</CardTitle>
        <div className="flex items-center gap-2">
          <Select value={productId} onValueChange={(v) => { setProductId(v); setPage(1); }}>
            <SelectTrigger className="w-64"><SelectValue placeholder="Select a product" /></SelectTrigger>
            <SelectContent>
              {(products ?? []).map(p => <SelectItem key={p.id} value={p.id}>{p.sku} — {p.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {canExportReports && (data?.allRows?.length ?? 0) > 0 && (
            <Button size="sm" variant="outline" onClick={() => exportToExcel(
              data!.allRows!.map((r: any) => ({
                ...r,
                qtyIn: r.qtyIn > 0 ? fmt(r.qtyIn) : "",
                qtyOut: r.qtyOut > 0 ? fmt(r.qtyOut) : "",
                balance: r.balance < 0 ? `-${fmt(Math.abs(r.balance))}` : fmt(r.balance),
              })),
              [
                { header: "Date", key: "date" },
                { header: "Type", key: "type" },
                { header: "Reference", key: "reference" },
                { header: "Qty In", key: "qtyIn" },
                { header: "Qty Out", key: "qtyOut" },
                { header: "Balance", key: "balance" },
              ],
              "stock-movement",
            )}>
              <Download className="h-4 w-4 mr-1" /> Export
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {!productId ? (
          <p className="text-muted-foreground text-sm">Select a product to view stock movements.</p>
        ) : isLoading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead className="text-right">Qty In</TableHead>
                    <TableHead className="text-right">Qty Out</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No movements</TableCell></TableRow>
                  ) : rows.map(r => (
                    <TableRow key={r.id}>
                      <TableCell>{r.date}</TableCell>
                      <TableCell>
                        <Badge variant={r.type === "Purchase" ? "secondary" : r.type === "Sale" ? "default" : "outline"} className="text-xs">{r.type}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-sm">{r.reference}</TableCell>
                      <TableCell className="text-right text-primary font-medium">{r.qtyIn > 0 ? `+${fmt(r.qtyIn)}` : "—"}</TableCell>
                      <TableCell className="text-right text-destructive font-medium">{r.qtyOut > 0 ? `-${fmt(r.qtyOut)}` : "—"}</TableCell>
                      <TableCell className="text-right font-semibold">{(r as any).balance < 0 ? `-${fmt(Math.abs((r as any).balance))}` : fmt((r as any).balance)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Pagination page={page} totalItems={data?.total ?? 0} pageSize={PAGE_SIZE} onPageChange={setPage} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
