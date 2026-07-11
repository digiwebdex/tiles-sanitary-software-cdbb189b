import { useState } from "react";
import BulkImportDialog from "@/modules/import/BulkImportDialog";
import { supplierColumns, supplierSampleData, importSuppliers } from "@/modules/import/useImportConfigs";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supplierService } from "@/services/supplierService";
import { useDealerId } from "@/hooks/useDealerId";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Pagination from "@/components/Pagination";
import { toast } from "sonner";
import { Plus, Search, Eye, Pencil, Copy, ToggleLeft, ToggleRight, ShoppingCart, BookOpen, Download, Upload } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
// supabase import removed — Phase 3U-2 (duplicate handler now uses supplierService.create)
import { usePermissions } from "@/hooks/usePermissions";
import { exportToExcel, commonColumns } from "@/lib/exportUtils";
import { useLanguage } from "@/contexts/LanguageContext";

const PAGE_SIZE = 25;

const SupplierList = () => {
  const dealerId = useDealerId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const permissions = usePermissions();
  const { t } = useLanguage();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showImport, setShowImport] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["suppliers", dealerId, search, page],
    queryFn: () => supplierService.list(dealerId, search, page),
    enabled: !!dealerId,
  });

  const suppliers = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const toggleMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "active" | "inactive" }) =>
      supplierService.toggleStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      toast.success(t("Supplier status updated"));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleDuplicate = async (s: any) => {
    try {
      await supplierService.create(dealerId, {
        name: `${s.name} (Copy)`,
        contact_person: s.contact_person ?? "",
        phone: s.phone ?? "",
        email: s.email ?? "",
        address: s.address ?? "",
        gstin: s.gstin ?? "",
        opening_balance: 0,
        status: s.status,
      } as any);
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      toast.success(t("Supplier duplicated"));
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleExport = () => {
    if (!permissions.canExportReports) {
      toast.error(t("You don't have permission to export."));
      return;
    }
    exportToExcel(
      suppliers.map((s) => ({
        name: s.name,
        phone: s.phone ?? "",
        email: s.email ?? "",
        contact_person: s.contact_person ?? "",
        gstin: s.gstin ?? "",
        address: s.address ?? "",
        opening_balance: s.opening_balance,
      })),
      commonColumns.suppliers,
      `suppliers-${new Date().toISOString().split("T")[0]}`
    );
    toast.success(t("Suppliers exported"));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-foreground">{t("Suppliers")}</h1>
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
          <Button onClick={() => navigate("/suppliers/new")}>
            <Plus className="mr-2 h-4 w-4" /> {t("Add Supplier")}
          </Button>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder={t("Search by name, contact or phone…")}
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">{t("Loading…")}</p>
      ) : suppliers.length === 0 ? (
        <div className="text-center py-12 space-y-3">
          <p className="text-muted-foreground">{t("No suppliers found.")}</p>
          <Button onClick={() => navigate("/suppliers/new")}>
            <Plus className="mr-2 h-4 w-4" /> {t("Add Your First Supplier")}
          </Button>
        </div>
      ) : (
        <>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("Supplier Name")}</TableHead>
                  <TableHead>{t("Contact Person")}</TableHead>
                  <TableHead>{t("Phone")}</TableHead>
                  <TableHead>{t("Email")}</TableHead>
                  <TableHead className="text-right">{t("Opening Bal.")}</TableHead>
                  <TableHead>{t("Status")}</TableHead>
                  <TableHead className="w-24">{t("Actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {suppliers.map((s) => (
                  <TableRow key={s.id} className={`cursor-pointer ${s.status === "inactive" ? "opacity-60" : ""}`} onClick={() => navigate(`/suppliers/${s.id}/edit`)}>
                    <TableCell className="font-medium">
                      <div>{s.name}</div>
                      {s.gstin && <div className="text-xs text-muted-foreground">{s.gstin}</div>}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {s.contact_person ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm">{s.phone ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {s.email ? (
                        <a href={`mailto:${s.email}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                          {s.email}
                        </a>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-sm font-mono">
                      {formatCurrency(s.opening_balance)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={s.status === "active" ? "default" : "secondary"}>
                        {s.status === "active" ? t("Active") : t("Inactive")}
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
                          <DropdownMenuItem onClick={() => navigate(`/suppliers/${s.id}/edit`)}>
                            <Eye className="mr-2 h-4 w-4" /> {t("View Details")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => navigate(`/suppliers/${s.id}/edit`)}>
                            <Pencil className="mr-2 h-4 w-4" /> {t("Edit Supplier")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleDuplicate(s)}>
                            <Copy className="mr-2 h-4 w-4" /> {t("Duplicate Supplier")}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => navigate(`/purchases/new`)}>
                            <ShoppingCart className="mr-2 h-4 w-4" /> {t("Add Purchase")}
                          </DropdownMenuItem>
                          {permissions.canViewSupplierLedger && (
                            <DropdownMenuItem onClick={() => navigate(`/ledger?tab=supplier&supplier=${s.id}`)}>
                              <BookOpen className="mr-2 h-4 w-4" /> {t("View Ledger")}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() =>
                              toggleMutation.mutate({
                                id: s.id,
                                status: s.status === "active" ? "inactive" : "active",
                              })
                            }
                          >
                            {s.status === "active" ? (
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
                ))}
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
        title={t("Suppliers")}
        columns={supplierColumns}
        sampleData={supplierSampleData}
        onImport={async (rows, mode) => {
          const result = await importSuppliers(rows, mode, dealerId);
          queryClient.invalidateQueries({ queryKey: ["suppliers"] });
          return result;
        }}
      />
    </div>
  );
};

export default SupplierList;
