import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { salesService } from "@/services/salesService";
import { deliveryService } from "@/services/deliveryService";
import Pagination from "@/components/Pagination";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Plus, Search, Truck, Send, PackageCheck, Download,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";
import CreateDeliveryDialog from "@/modules/deliveries/CreateDeliveryDialog";
import DeleteConfirmDialog from "@/components/DeleteConfirmDialog";
import SaleActionDropdown from "./SaleActionDropdown";
import { usePermissions } from "@/hooks/usePermissions";
import { exportToExcel } from "@/lib/exportUtils";
import { useAuth } from "@/contexts/AuthContext";
import {
  getApprovalSettings, isApprovalRequired, createApprovalRequest,
  findValidApproval, consumeApprovalRequest, generateActionHash,
  type ApprovalContextData,
} from "@/services/approvalService";
import { ApprovalRequestDialog } from "@/components/approval/ApprovalRequestDialog";
import { ProjectSiteFilter } from "@/components/project/ProjectSiteFilter";
import SendWhatsAppDialog from "@/components/whatsapp/SendWhatsAppDialog";
import { buildInvoiceMessage } from "@/services/whatsappService";
import { useDealerInfo } from "@/hooks/useDealerInfo";
import {
  resolveSalePaymentStatus,
  salePaymentStatusClassName,
  salePaymentStatusLabel,
} from "@/lib/salePaymentStatus";

interface SaleListProps {
  dealerId: string;
}

const PAGE_SIZE = 25;

const statusColors: Record<string, string> = {
  draft: "secondary",
  challan_created: "outline",
  delivered: "default",
  invoiced: "default",
  completed: "default",
  partially_delivered: "outline",
  cancelled: "secondary",
};

const SaleList = ({ dealerId }: SaleListProps) => {
  const navigate = useNavigate();
  const { user, isDealerAdmin } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deliverySale, setDeliverySale] = useState<any>(null);
  const [deleteSale, setDeleteSale] = useState<any>(null);
  const [waSale, setWaSale] = useState<any>(null);
  const [cancelApprovalOpen, setCancelApprovalOpen] = useState(false);
  const [cancelApprovalContext, setCancelApprovalContext] = useState<ApprovalContextData>({});
  const [projectId, setProjectId] = useState<string | null>(null);
  const [siteId, setSiteId] = useState<string | null>(null);
  const permissions = usePermissions();
  const queryClient = useQueryClient();
  const { data: dealerInfoForWa } = useDealerInfo();

  const { data: approvalSettings } = useQuery({
    queryKey: ["approval-settings", dealerId],
    queryFn: () => getApprovalSettings(dealerId),
    enabled: !!dealerId,
  });

  // Phase 3U-30b: single VPS call returns both delivered sale ids and
  // challan delivery statuses (replaces 2 separate Supabase reads).
  const { data: deliveryFlags } = useQuery({
    queryKey: ["sales-delivery-flags", dealerId],
    queryFn: async () => {
      const res = await vpsAuthedFetch(
        `/api/sales/delivery-flags?dealerId=${dealerId}`,
      );
      const body = await res.json().catch(() => ({} as any));
      const deliveredSet = new Set<string>(body?.deliveredSaleIds ?? []);
      const challanMap = new Map<string, string>(
        Object.entries((body?.challanDeliveryStatuses ?? {}) as Record<string, string>),
      );
      return { deliveredSet, challanMap };
    },
    enabled: !!dealerId,
  });
  const deliveryMap = deliveryFlags?.deliveredSet;
  const challanDeliveryMap = deliveryFlags?.challanMap;

  const deleteMutation = useMutation({
    mutationFn: async (sale: any) => {
      // Sale cancel approval gate
      if (approvalSettings && isApprovalRequired(approvalSettings, "sale_cancel")) {
        const ctx: ApprovalContextData = {
          customer_name: sale.customers?.name,
          sale_invoice_no: sale.invoice_number,
          sale_total: Number(sale.total_amount),
        };
        const existing = await findValidApproval(dealerId, "sale_cancel", ctx);
        if (existing) {
          const hash = await generateActionHash("sale_cancel", ctx);
          await consumeApprovalRequest(existing.id, hash, sale.id);
        } else if (isDealerAdmin && approvalSettings.auto_approve_for_admins) {
          await createApprovalRequest({
            dealerId, approvalType: "sale_cancel",
            sourceType: "sale", sourceId: sale.id,
            requestedBy: user!.id, context: ctx,
            isAdmin: true, autoApproveForAdmins: true,
            expiryHours: approvalSettings.approval_expiry_hours,
          });
        } else {
          setCancelApprovalContext(ctx);
          setCancelApprovalOpen(true);
          throw new Error("__APPROVAL_PENDING__");
        }
      }
      await salesService.cancelSale(sale.id, dealerId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["stock"] });
      queryClient.invalidateQueries({ queryKey: ["customer-ledger"] });
      queryClient.invalidateQueries({ queryKey: ["cash-ledger"] });
      toast.success("Sale cancelled and reversed successfully");
      setDeleteSale(null);
    },
    onError: (e: any) => {
      if (e.message !== "__APPROVAL_PENDING__") toast.error(e.message);
    },
  });

  const handleSaleCancelApprovalRequest = async (note: string) => {
    try {
      await createApprovalRequest({
        dealerId, approvalType: "sale_cancel",
        sourceType: "sale", sourceId: deleteSale?.id,
        requestedBy: user!.id, reason: note,
        context: cancelApprovalContext, isAdmin: false,
        expiryHours: approvalSettings?.approval_expiry_hours,
      });
      toast.success("Cancel request submitted. Wait for manager approval.");
      setCancelApprovalOpen(false);
      setDeleteSale(null);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const { data: deliverySaleData } = useQuery({
    queryKey: ["sale-for-delivery", deliverySale?.id],
    queryFn: async () => {
      if (!deliverySale?.id) return null;
      // Phase 3U-30b: VPS GET /api/sales/:id (returns sale + items + customers).
      return salesService.getById(deliverySale.id);
    },
    enabled: !!deliverySale?.id,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["sales", dealerId, page, search, projectId, siteId],
    queryFn: () => salesService.list(dealerId, page, search, { projectId, siteId }),
    enabled: !!dealerId,
  });

  const sales = data?.data ?? [];
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
    if (selected.size === sales.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(sales.map((s: any) => s.id)));
    }
  };

  const handleExport = () => {
    if (!permissions.canExportReports) {
      toast.error("You don't have permission to export.");
      return;
    }
    const exportData = sales.map((s: any) => ({
      date: s.sale_date,
      invoice: s.invoice_number ?? "",
      customer: s.customers?.name ?? "",
      status: s.sale_status,
      total: Number(s.total_amount),
      paid: Number(s.paid_amount),
      due: Number(s.due_amount),
      ...(permissions.canViewProfit ? { profit: Number(s.profit) } : {}),
    }));
    const cols = [
      { header: "Date", key: "date" },
      { header: "Invoice", key: "invoice" },
      { header: "Customer", key: "customer" },
      { header: "Status", key: "status" },
      { header: "Total", key: "total", format: "currency" as const },
      { header: "Paid", key: "paid", format: "currency" as const },
      { header: "Due", key: "due", format: "currency" as const },
      ...(permissions.canViewProfit ? [{ header: "Profit", key: "profit", format: "currency" as const }] : []),
    ];
    exportToExcel(exportData, cols, `sales-${new Date().toISOString().split("T")[0]}`);
    toast.success("Sales exported");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-foreground">Sales</h1>
        <div className="flex gap-2">
          {permissions.canExportReports && (
            <Button variant="outline" onClick={handleExport}>
              <Download className="mr-2 h-4 w-4" /> Export
            </Button>
          )}
          <Button onClick={() => navigate("/sales/new")}>
            <Plus className="mr-2 h-4 w-4" /> Add Sale
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by invoice or customer…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-9"
          />
        </div>
        <ProjectSiteFilter
          dealerId={dealerId}
          projectId={projectId}
          siteId={siteId}
          onChange={({ projectId: pid, siteId: sid }) => { setProjectId(pid); setSiteId(sid); setPage(1); }}
        />
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : sales.length === 0 ? (
        <div className="text-center py-12 space-y-3">
          <p className="text-muted-foreground">No sales found.</p>
          <Button onClick={() => navigate("/sales/new")}>
            <Plus className="mr-2 h-4 w-4" /> Create Your First Sale
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
                      checked={sales.length > 0 && selected.size === sales.length}
                      onCheckedChange={toggleAll}
                    />
                  </TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Reference No</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Sale Status</TableHead>
                  <TableHead className="text-right">Grand Total</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead>Payment Status</TableHead>
                  <TableHead>Delivery</TableHead>
                  {permissions.canViewProfit && (
                    <TableHead className="text-right">Profit</TableHead>
                  )}
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sales.map((s: any) => {
                  const isChallan = s.sale_type === "challan_mode";
                  const due = Number(s.due_amount) || 0;
                  const paid = Number(s.paid_amount) || 0;
                  const paymentStatus = resolveSalePaymentStatus(s);
                  const isReversed = paymentStatus === "reversed";

                  return (
                    <TableRow
                      key={s.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/sales/${s.id}/invoice`)}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selected.has(s.id)}
                          onCheckedChange={() => toggleSelect(s.id)}
                        />
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{s.sale_date}</TableCell>
                      <TableCell className="font-mono text-sm">{s.invoice_number ?? "—"}</TableCell>
                      <TableCell>{s.customers?.name ?? "—"}</TableCell>
                       <TableCell>
                        <div className="flex flex-col gap-1">
                          <Badge
                            variant={statusColors[s.sale_status] as any ?? "secondary"}
                            className={`capitalize text-xs ${
                              isReversed
                                ? "bg-red-100 text-red-700 border-red-200"
                                : s.sale_status === "partially_delivered"
                                  ? "border-orange-500 text-orange-600"
                                  : s.sale_status === "delivered"
                                    ? "bg-green-600 text-white"
                                    : ""
                            }`}
                          >
                            {s.sale_status === "partially_delivered" 
                              ? "Partial Delivery" 
                              : (s.sale_status ?? "invoiced").replace(/_/g, " ")}
                          </Badge>
                          {s.has_backorder && (
                            <Badge variant="outline" className="text-xs border-amber-500 text-amber-600 bg-amber-50">
                              Backorder
                            </Badge>
                          )}
                          {s.sale_status === "partially_delivered" && (
                            <span className="text-xs text-orange-600 font-medium">
                              <Truck className="inline h-3 w-3 mr-0.5" />
                              In Progress
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">{formatCurrency(s.total_amount)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(s.paid_amount)}</TableCell>
                      <TableCell className={`text-right ${due > 0 ? "text-destructive font-semibold" : ""}`}>
                        {formatCurrency(due)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={paymentStatus === "paid" ? "default" : "outline"}
                          className={`text-xs ${salePaymentStatusClassName(paymentStatus)}`}
                        >
                          {salePaymentStatusLabel(paymentStatus)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const ds = challanDeliveryMap?.get(s.id);
                          if (!ds) return <span className="text-muted-foreground text-xs">—</span>;
                          const icon = ds === "delivered" ? <PackageCheck className="h-3 w-3 mr-1 inline" /> : ds === "dispatched" ? <Send className="h-3 w-3 mr-1 inline" /> : <Truck className="h-3 w-3 mr-1 inline" />;
                          const cls = ds === "delivered" ? "bg-green-100 text-green-800 border-green-300" : ds === "dispatched" ? "bg-blue-100 text-blue-800 border-blue-300" : "bg-yellow-100 text-yellow-800 border-yellow-300";
                          return <Badge variant="outline" className={`text-xs ${cls}`}>{icon}{ds.charAt(0).toUpperCase() + ds.slice(1)}</Badge>;
                        })()}
                      </TableCell>
                      {permissions.canViewProfit && (
                        <TableCell className={`text-right font-semibold ${Number(s.profit) >= 0 ? "text-primary" : "text-destructive"}`}>
                          {formatCurrency(s.profit)}
                        </TableCell>
                      )}
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <SaleActionDropdown
                          saleId={s.id}
                          hasPaid={paid > 0}
                          hasDelivery={deliveryMap?.has(s.id) ?? false}
                          isDelivered={challanDeliveryMap?.get(s.id) === "delivered"}
                          onViewSale={() => navigate(`/sales/${s.id}/invoice`)}
                          onAddPayment={() => navigate(`/sales/${s.id}/invoice`)}
                          onViewInvoice={() => navigate(`/sales/${s.id}/invoice`)}
                          onViewDeliveryStatus={() => navigate(`/deliveries`)}
                          onAddDelivery={() => setDeliverySale(s)}
                          onSendWhatsApp={() => setWaSale(s)}
                          onEditSale={() => navigate(`/sales/${s.id}/edit`)}
                          onDeleteSale={permissions.canDeleteRecords ? () => setDeleteSale(s) : undefined}
                        />
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

      <CreateDeliveryDialog
        open={!!deliverySale}
        onClose={() => setDeliverySale(null)}
        sale={deliverySaleData ?? deliverySale}
        dealerId={dealerId}
      />

      {permissions.canDeleteRecords && (
        <DeleteConfirmDialog
          open={!!deleteSale}
          onOpenChange={(open) => { if (!open) setDeleteSale(null); }}
          title="Cancel & Delete Sale"
          description={`This will cancel sale "${deleteSale?.invoice_number ?? ""}", reverse all stock changes, and remove ledger entries. This action cannot be undone.`}
          onConfirm={() => { if (deleteSale) deleteMutation.mutate(deleteSale.id); }}
        />
      )}

      {waSale && (
        <SendWhatsAppDialog
          open={!!waSale}
          onOpenChange={(o) => { if (!o) setWaSale(null); }}
          dealerId={dealerId}
          messageType="invoice_share"
          sourceType="sale"
          sourceId={waSale.id}
          templateKey="invoice_share_v1"
          defaultPhone={waSale.customer_phone ?? waSale.customers?.phone ?? ""}
          defaultName={waSale.customers?.name ?? waSale.customer_name ?? null}
          defaultMessage={buildInvoiceMessage({
            dealerName: dealerInfoForWa?.name ?? "Our Store",
            customerName: waSale.customers?.name ?? waSale.customer_name ?? null,
            invoiceNo: waSale.invoice_number ?? "",
            totalAmount: Number(waSale.total_amount ?? 0),
            paidAmount: Number(waSale.paid_amount ?? 0),
            dueAmount: Number(waSale.due_amount ?? 0),
            saleDate: waSale.sale_date ?? null,
          })}
          payloadSnapshot={{
            invoice_no: waSale.invoice_number,
            total: Number(waSale.total_amount ?? 0),
            due: Number(waSale.due_amount ?? 0),
          }}
          title="Share Invoice via WhatsApp"
        />
      )}
    </div>
  );
};

export default SaleList;
