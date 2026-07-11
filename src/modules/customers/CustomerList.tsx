import { useState } from "react";
import BulkImportDialog from "@/modules/import/BulkImportDialog";
import { customerColumns, customerSampleData, importCustomers } from "@/modules/import/useImportConfigs";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { customerService } from "@/services/customerService";
import { useDealerId } from "@/hooks/useDealerId";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Pagination from "@/components/Pagination";
import { toast } from "sonner";
import { Plus, Search, Eye, Pencil, Copy, ToggleLeft, ToggleRight, BookOpen, ShoppingCart, CreditCard, Download, Upload } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";
import { CreditStatusBadge } from "@/components/CreditStatusBadge";
import { usePermissions } from "@/hooks/usePermissions";
import { exportToExcel } from "@/lib/exportUtils";
import { useLanguage } from "@/contexts/LanguageContext";

const PAGE_SIZE = 25;

const TYPE_LABELS: Record<string, string> = {
  retailer: "Retailer",
  customer: "Regular",
  project: "Project",
};

const TYPE_COLORS: Record<string, string> = {
  retailer: "default",
  customer: "secondary",
  project: "outline",
};

function getAgingBucket(daysOverdue: number): string {
  if (daysOverdue <= 30) return "current";
  if (daysOverdue <= 60) return "30+";
  if (daysOverdue <= 90) return "60+";
  return "90+";
}

const AGING_BADGE: Record<string, { label: string; variant: string }> = {
  current: { label: "Current", variant: "secondary" },
  "30+": { label: "30+", variant: "outline" },
  "60+": { label: "60+", variant: "default" },
  "90+": { label: "90+", variant: "destructive" },
};

const CustomerList = () => {
  const dealerId = useDealerId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const permissions = usePermissions();
  const { t } = useLanguage();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [page, setPage] = useState(1);
  const [showImport, setShowImport] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["customers", dealerId, search, typeFilter, page],
    queryFn: () => customerService.list(dealerId, search, typeFilter, page),
    enabled: !!dealerId,
  });

  const customers = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const { data: ledgerInfo = {} } = useQuery({
    queryKey: ["customer-due-balances", dealerId, customers.map((c) => c.id)],
    queryFn: async () => {
      if (!customers.length) return {};
      const ids = customers.map((c) => c.id).join(",");
      const res = await vpsAuthedFetch(
        `/api/dashboard/customer-due-balances?dealerId=${dealerId}&ids=${encodeURIComponent(ids)}`,
      );
      const body = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error((body as any)?.error || "Failed to load");
      return (body.rows ?? {}) as Record<string, { due: number; daysOverdue: number }>;
    },
    enabled: customers.length > 0,
  });
  const ledgerSums: Record<string, number> = {};
  for (const [k, v] of Object.entries(ledgerInfo)) { ledgerSums[k] = (v as any).due; }

  const toggleMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "active" | "inactive" }) =>
      customerService.toggleStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      toast.success(t("Customer status updated"));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleDuplicate = async (c: any) => {
    try {
      await customerService.create(dealerId, {
        name: `${c.name} (Copy)`,
        type: c.type,
        phone: c.phone ?? "",
        email: c.email ?? "",
        address: c.address ?? "",
        reference_name: c.reference_name ?? "",
        opening_balance: 0,
        status: c.status,
        credit_limit: c.credit_limit ?? 0,
        max_overdue_days: c.max_overdue_days ?? 0,
        price_tier_id: c.price_tier_id ?? null,
      } as any);
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      toast.success(t("Customer duplicated"));
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleExport = () => {
    if (!permissions.canExportReports) {
      toast.error(t("You don't have permission to export."));
      return;
    }
    const exportData = customers.map((c) => ({
      name: c.name,
      type: TYPE_LABELS[c.type] ?? c.type,
      phone: c.phone ?? "",
      email: c.email ?? "",
      address: c.address ?? "",
      credit_limit: c.credit_limit,
      opening_balance: c.opening_balance,
      due: ledgerSums[c.id] ?? 0,
    }));
    exportToExcel(exportData, [
      ...commonColumns.customers,
      { header: "Due Balance", key: "due", format: "currency" },
    ], `customers-${new Date().toISOString().split("T")[0]}`);
    toast.success(t("Customers exported"));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-foreground">{t("Customers")}</h1>
        <div className="flex gap-2">
          {permissions.canExportReports && (
            <>
              <Button variant="outline" onClick={handleExport}>
                <Download className="mr-2 h-4 w-4" /> {t("Export")}
              </Button>
              <Button variant="outline" onClick={() => setShowImport(true)}>
                <Upload className="mr-2 h-4 w-4" /> {t("Import")}
              </Button>
            </>
          )}
          <Button onClick={() => navigate("/customers/new")}>
            <Plus className="mr-2 h-4 w-4" /> {t("Add Customer")}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("Search by name, phone or reference…")}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-9"
          />
        </div>
        <Select
          value={typeFilter || "all"}
          onValueChange={(v) => { setTypeFilter(v === "all" ? "" : v); setPage(1); }}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder={t("All Types")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("All Types")}</SelectItem>
            <SelectItem value="retailer">{t("Retailer")}</SelectItem>
            <SelectItem value="customer">{t("Regular")}</SelectItem>
            <SelectItem value="project">{t("Project")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">{t("Loading…")}</p>
      ) : customers.length === 0 ? (
        <div className="text-center py-12 space-y-3">
          <p className="text-muted-foreground">{t("No customers found.")}</p>
          <Button onClick={() => navigate("/customers/new")}>
            <Plus className="mr-2 h-4 w-4" /> {t("Add Your First Customer")}
          </Button>
        </div>
      ) : (
        <>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("Customer Name")}</TableHead>
                  <TableHead>{t("Type")}</TableHead>
                  <TableHead>{t("Phone")}</TableHead>
                  <TableHead>{t("Reference")}</TableHead>
                  <TableHead className="text-right">{t("Opening Bal.")}</TableHead>
                  <TableHead className="text-right">{t("Due Balance")}</TableHead>
                      <TableHead>{t("Aging")}</TableHead>
                      <TableHead>{t("Credit")}</TableHead>
                      <TableHead>{t("Status")}</TableHead>
                  <TableHead className="w-24">{t("Actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((c) => {
                  const due = ledgerSums[c.id] ?? 0;
                  return (
                    <TableRow key={c.id} className={`cursor-pointer ${c.status === "inactive" ? "opacity-60" : ""}`} onClick={() => navigate(`/customers/${c.id}/edit`)}>
                      <TableCell className="font-medium">
                        <div>{c.name}</div>
                        {c.email && (
                          <div className="text-xs text-muted-foreground">{c.email}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={TYPE_COLORS[c.type] as any}>
                          {TYPE_LABELS[c.type] ?? c.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{c.phone ?? "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {c.reference_name ?? "—"}
                      </TableCell>
                      <TableCell className="text-right text-sm font-mono">
                        {formatCurrency(c.opening_balance)}
                      </TableCell>
                      <TableCell className="text-right text-sm font-mono">
                        <span className={due > 0 ? "text-destructive font-semibold" : "text-muted-foreground"}>
                          {formatCurrency(due)}
                        </span>
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const info = ledgerInfo[c.id] as any;
                          const days = info?.daysOverdue ?? 0;
                          const bucket = getAgingBucket(days);
                          const badge = AGING_BADGE[bucket];
                          if (due <= 0) return <span className="text-xs text-muted-foreground">—</span>;
                          return <Badge variant={badge.variant as any} className="text-xs">{badge.label}</Badge>;
                        })()}
                      </TableCell>
                      <TableCell>
                        {(c.credit_limit > 0 || c.max_overdue_days > 0) ? (
                          <CreditStatusBadge
                            outstanding={due}
                            creditLimit={c.credit_limit}
                            showTooltip={true}
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={c.status === "active" ? "default" : "secondary"}>
                          {c.status === "active" ? t("Active") : t("Inactive")}
                        </Badge>
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="sm" variant="outline" className="h-8 px-3 text-xs">
                              {t("Actions")}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => navigate(`/customers/${c.id}/profile`)}>
                              <Eye className="mr-2 h-4 w-4" /> {t("360° Profile")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => navigate(`/customers/${c.id}/edit`)}>
                              <Pencil className="mr-2 h-4 w-4" /> {t("Edit Customer")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleDuplicate(c)}>
                              <Copy className="mr-2 h-4 w-4" /> {t("Duplicate Customer")}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => navigate(`/sales/new`)}>
                              <ShoppingCart className="mr-2 h-4 w-4" /> {t("Add Sale")}
                            </DropdownMenuItem>
                            {permissions.canRecordCollections && (
                              <DropdownMenuItem onClick={() => navigate(`/collections`)}>
                                <CreditCard className="mr-2 h-4 w-4" /> {t("Add Payment")}
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => navigate(`/ledger?customer=${c.id}`)}>
                              <BookOpen className="mr-2 h-4 w-4" /> {t("View Ledger")}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() =>
                                toggleMutation.mutate({
                                  id: c.id,
                                  status: c.status === "active" ? "inactive" : "active",
                                })
                              }
                            >
                              {c.status === "active" ? (
                                <>
                                  <ToggleLeft className="mr-2 h-4 w-4" /> {t("Deactivate")}
                                </>
                              ) : (
                                <>
                                  <ToggleRight className="mr-2 h-4 w-4" /> {t("Activate")}
                                </>
                              )}
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
      <BulkImportDialog
        open={showImport}
        onOpenChange={setShowImport}
        title={t("Customers")}
        columns={customerColumns}
        sampleData={customerSampleData}
        onImport={async (rows, mode) => {
          const result = await importCustomers(rows, mode, dealerId);
          queryClient.invalidateQueries({ queryKey: ["customers"] });
          return result;
        }}
      />
    </div>
  );
};

const commonColumns = {
  customers: [
    { header: "Name", key: "name" },
    { header: "Type", key: "type" },
    { header: "Phone", key: "phone" },
    { header: "Email", key: "email" },
    { header: "Address", key: "address" },
    { header: "Credit Limit", key: "credit_limit", format: "currency" as const },
    { header: "Opening Balance", key: "opening_balance", format: "currency" as const },
  ],
};

export default CustomerList;

// Import dialog is rendered in the component - need to add before the final closing

