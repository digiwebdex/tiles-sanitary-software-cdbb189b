import { useState, useMemo } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge as UIBadge } from "@/components/ui/badge";
import { X } from "lucide-react";
import BulkImportDialog from "@/modules/import/BulkImportDialog";
import { productColumns, productSampleData, importProducts } from "@/modules/import/useImportConfigs";
import { formatCurrency } from "@/lib/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { productService } from "@/services/productService";
import Pagination from "@/components/Pagination";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  Plus, Search, AlertTriangle, Printer, Download, Upload, Lock,
} from "lucide-react";
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";
import { TileStockBadge } from "@/components/TileStockBadge";
import BarcodePrintDialog from "./BarcodePrintDialog";
import ProductDetailDialog from "./ProductDetailDialog";
import BrokenStockDialog from "./BrokenStockDialog";
import PurchaseHistoryDialog from "./PurchaseHistoryDialog";
import SalesHistoryDialog from "./SalesHistoryDialog";
import StockAdjustDialog from "./StockAdjustDialog";
import StockMovementDialog from "./StockMovementDialog";
import DeleteConfirmDialog from "@/components/DeleteConfirmDialog";
import ProductActionDropdown from "./ProductActionDropdown";
import UpdateSalePriceDialog from "./UpdateSalePriceDialog";
import UpdateCostPriceDialog from "./UpdateCostPriceDialog";
import ChangeBarcodeDialog from "./ChangeBarcodeDialog";
import SetReorderLevelDialog from "./SetReorderLevelDialog";
import StockSummaryDialog from "./StockSummaryDialog";
import CreateReservationDialog from "./CreateReservationDialog";
import ReservationListDialog from "./ReservationListDialog";
import { usePermissions } from "@/hooks/usePermissions";
import { useDealerInfo } from "@/hooks/useDealerInfo";
import { useAuth } from "@/contexts/AuthContext";
import { exportToExcel } from "@/lib/exportUtils";
import { formatStockUnit } from "@/lib/units";
import { useLanguage } from "@/contexts/LanguageContext";

interface ProductListProps {
  dealerId: string;
}

const PAGE_SIZE = 25;

const ProductList = ({ dealerId }: ProductListProps) => {
  const { t } = useLanguage();
  const permissions = usePermissions();
  const { planFeatures, isSuperAdmin } = useAuth();
  const barcodeEnabled = isSuperAdmin || !!(planFeatures?.barcodeEnabled);
  const { data: dealerInfo } = useDealerInfo();
  const reservationsEnabled = dealerInfo?.enable_reservations ?? false;
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [brandFilter, setBrandFilter] = useState<string>("all");
  const [unitFilter, setUnitFilter] = useState<string>("all");
  const [stockFilter, setStockFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("name-asc");
  const [barcodeOpen, setBarcodeOpen] = useState(false);
  const [barcodeSingle, setBarcodeSingle] = useState<{ id: string; sku: string; name: string; default_sale_rate: number } | null>(null);
  const [detailProduct, setDetailProduct] = useState<typeof products[0] | null>(null);
  const [brokenProduct, setBrokenProduct] = useState<typeof products[0] | null>(null);
  const [purchaseHistoryProduct, setPurchaseHistoryProduct] = useState<typeof products[0] | null>(null);
  const [salesHistoryProduct, setSalesHistoryProduct] = useState<typeof products[0] | null>(null);
  const [adjustStockProduct, setAdjustStockProduct] = useState<typeof products[0] | null>(null);
  const [deleteProduct, setDeleteProduct] = useState<typeof products[0] | null>(null);
  const [movementProduct, setMovementProduct] = useState<typeof products[0] | null>(null);
  const [salePriceProduct, setSalePriceProduct] = useState<typeof products[0] | null>(null);
  const [costPriceProduct, setCostPriceProduct] = useState<typeof products[0] | null>(null);
  const [barcodeChangeProduct, setBarcodeChangeProduct] = useState<typeof products[0] | null>(null);
  const [reorderProduct, setReorderProduct] = useState<typeof products[0] | null>(null);
  const [stockSummaryProduct, setStockSummaryProduct] = useState<typeof products[0] | null>(null);
  const [reserveProduct, setReserveProduct] = useState<typeof products[0] | null>(null);
  const [showReservations, setShowReservations] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["products", dealerId, search, page],
    queryFn: () => productService.list(dealerId, search, page),
    enabled: !!dealerId,
  });

  const { data: summaryData } = useQuery({
    queryKey: ["products-summary", dealerId],
    enabled: !!dealerId,
    queryFn: async () => {
      const res = await vpsAuthedFetch(`/api/products/summary-rows?dealerId=${dealerId}`);
      const body = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error((body as any)?.error || t("Failed to load"));
      return (body.rows ?? []) as any[];
    },
  });

  const { data: stockData } = useQuery({
    queryKey: ["products-stock-map", dealerId],
    queryFn: async () => {
      const res = await vpsAuthedFetch(`/api/products/stock-map?dealerId=${dealerId}`);
      const body = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error((body as any)?.error || t("Failed to load"));
      const map = new Map<string, { total: number; box: number; sft: number; piece: number; totalPieces: number; reservedBox: number; reservedPiece: number }>();
      for (const s of (body.rows ?? []) as any[]) {
        const box = Number(s.box_qty) || 0;
        const sft = Number(s.sft_qty) || 0;
        const piece = Number(s.piece_qty) || 0;
        const totalPieces = Number(s.total_pieces) || 0;
        const reservedBox = Number(s.reserved_box_qty) || 0;
        const reservedPiece = Number(s.reserved_piece_qty) || 0;
        map.set(s.product_id, { total: box + piece, box, sft, piece, totalPieces, reservedBox, reservedPiece });
      }
      return map;
    },
    enabled: !!dealerId,
  });

  const { data: costData } = useQuery({
    queryKey: ["products-cost-map", dealerId],
    queryFn: async () => {
      const res = await vpsAuthedFetch(`/api/products/cost-map?dealerId=${dealerId}`);
      const body = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error((body as any)?.error || t("Failed to load"));
      const map = new Map<string, number>();
      for (const [k, v] of Object.entries(body.rows ?? {})) map.set(k, Number(v) || 0);
      return map;
    },
    enabled: !!dealerId && permissions.canViewCostPrice,
  });

  const { data: lastCostData } = useQuery({
    queryKey: ["products-last-cost-map", dealerId],
    queryFn: async () => {
      const res = await vpsAuthedFetch(`/api/products/last-cost-map?dealerId=${dealerId}`);
      const body = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error((body as any)?.error || t("Failed to load"));
      const map = new Map<string, number>();
      for (const [k, v] of Object.entries(body.rows ?? {})) map.set(k, Number(v) || 0);
      return map;
    },
    enabled: !!dealerId && permissions.canViewCostPrice,
  });

  const { data: txProducts } = useQuery({
    queryKey: ["products-tx-check", dealerId],
    queryFn: async () => {
      const res = await vpsAuthedFetch(`/api/products/tx-check?dealerId=${dealerId}`);
      const body = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error((body as any)?.error || t("Failed to load"));
      return new Set<string>((body.ids ?? []) as string[]);
    },
    enabled: !!dealerId,
  });

  const products = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  // Dealer-wide summary metrics (across ALL products, not just current page)
  const summary = useMemo(() => {
    const all = summaryData ?? [];
    let totalProducts = all.length;
    let lowStock = 0;
    let outOfStock = 0;
    let stockValue = 0;
    for (const p of all) {
      const si = stockData?.get(p.id);
      const qty = si?.total ?? 0;
      const reorder = Number(p.reorder_level) || 0;
      const cost = Number(p.cost_price) || 0;
      stockValue += qty * cost;
      if (qty <= 0) outOfStock += 1;
      else if (qty <= reorder) lowStock += 1;
    }
    return { totalProducts, lowStock, outOfStock, stockValue };
  }, [summaryData, stockData]);


  // Build available brand options from current page products
  const brandOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) if (p.brand) set.add(p.brand);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [products]);

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) if (p.category) set.add(p.category);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [products]);

  // Apply client-side filters and sort to current page results
  const filteredProducts = useMemo(() => {
    let list = products.filter((p) => {
      if (categoryFilter !== "all" && p.category !== categoryFilter) return false;
      if (brandFilter !== "all" && (p.brand || "") !== brandFilter) return false;
      if (unitFilter !== "all" && p.unit_type !== unitFilter) return false;
      if (stockFilter !== "all") {
        const si = stockData?.get(p.id);
        const qty = si?.total ?? 0;
        const reorder = p.reorder_level ?? 0;
        if (stockFilter === "in" && qty <= 0) return false;
        if (stockFilter === "out" && qty > 0) return false;
        if (stockFilter === "low" && !(qty > 0 && qty <= reorder)) return false;
        if (stockFilter === "negative" && qty >= 0) return false;
      }
      return true;
    });

    const sorters: Record<string, (a: typeof products[0], b: typeof products[0]) => number> = {
      "name-asc": (a, b) => a.name.localeCompare(b.name),
      "name-desc": (a, b) => b.name.localeCompare(a.name),
      "price-asc": (a, b) => (a.default_sale_rate || 0) - (b.default_sale_rate || 0),
      "price-desc": (a, b) => (b.default_sale_rate || 0) - (a.default_sale_rate || 0),
      "qty-asc": (a, b) => (stockData?.get(a.id)?.total ?? 0) - (stockData?.get(b.id)?.total ?? 0),
      "qty-desc": (a, b) => (stockData?.get(b.id)?.total ?? 0) - (stockData?.get(a.id)?.total ?? 0),
      "sku-asc": (a, b) => (a.sku || "").localeCompare(b.sku || ""),
    };
    list = [...list].sort(sorters[sortBy] ?? sorters["name-asc"]);
    return list;
  }, [products, categoryFilter, brandFilter, unitFilter, stockFilter, sortBy, stockData]);

  const activeFilterCount =
    (categoryFilter !== "all" ? 1 : 0) +
    (brandFilter !== "all" ? 1 : 0) +
    (unitFilter !== "all" ? 1 : 0) +
    (stockFilter !== "all" ? 1 : 0) +
    (search.trim() ? 1 : 0);

  const clearAllFilters = () => {
    setSearch("");
    setCategoryFilter("all");
    setBrandFilter("all");
    setUnitFilter("all");
    setStockFilter("all");
    setSortBy("name-asc");
    setPage(1);
  };

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      productService.toggleActive(id, active),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      toast.success(t("Product updated"));
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await productService.remove(id, dealerId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      toast.success(t("Product deleted"));
      setDeleteProduct(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === filteredProducts.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredProducts.map((p) => p.id)));
    }
  };

  const selectedProducts = products.filter((p) => selected.has(p.id));

  const openBulkBarcode = () => {
    setBarcodeSingle(null);
    setBarcodeOpen(true);
  };

  const openSingleBarcode = (p: typeof products[0]) => {
    setBarcodeSingle({ id: p.id, sku: p.sku, name: p.name, default_sale_rate: p.default_sale_rate });
    setBarcodeOpen(true);
  };

  const handleDuplicate = async (p: typeof products[0]) => {
    try {
      const suffix = Math.random().toString(36).substring(2, 6).toUpperCase();
      const newSku = `${p.sku}-${suffix}`;
      await productService.create({
        dealer_id: dealerId,
        name: `${p.name} (Copy)`,
        sku: newSku,
        category: p.category,
        unit_type: p.unit_type,
        per_box_sft: p.per_box_sft,
        default_sale_rate: p.default_sale_rate,
        cost_price: p.cost_price,
        reorder_level: p.reorder_level,
        brand: p.brand,
        size: p.size,
        color: p.color,
        material: p.material,
        weight: p.weight,
        warranty: p.warranty,
      });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      toast.success(t("Product duplicated successfully."));
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleExport = () => {
    if (!permissions.canExportReports) {
      toast.error(t("You don't have permission to export."));
      return;
    }
    const exportData = products.map((p) => {
      const si = stockData?.get(p.id) ?? { total: 0, box: 0, sft: 0, piece: 0, totalPieces: 0, reservedBox: 0, reservedPiece: 0 };
      const avgCost = costData?.get(p.id) ?? 0;
      const isTile = p.unit_type === "box_sft";
      const ppb = Number((p as any).pieces_per_box) || 1;
      const qty = isTile ? si.box : si.piece;
      return {
        sku: p.sku,
        name: p.name,
        brand: p.brand || "",
        category: p.category,
        unitType: isTile ? "Box/Sft" : "Piece",
        stock: formatStockUnit(qty, ppb, isTile),
        boxQty: si.box,
        sftQty: si.sft,
        pieceQty: si.piece,
        saleRate: p.default_sale_rate,
        ...(permissions.canViewCostPrice ? { avgCost, stockValue: avgCost * si.total } : {}),
        reorderLevel: p.reorder_level,
      };
    });
    const cols = [
      { header: "SKU", key: "sku" },
      { header: "Name", key: "name" },
      { header: "Brand", key: "brand" },
      { header: "Category", key: "category" },
      { header: "Unit Type", key: "unitType" },
      { header: "Stock", key: "stock" },
      { header: "Box Qty", key: "boxQty", format: "number" as const },
      { header: "SFT Qty", key: "sftQty", format: "number" as const },
      { header: "Piece Qty", key: "pieceQty", format: "number" as const },
      { header: "Sale Rate", key: "saleRate", format: "currency" as const },
      ...(permissions.canViewCostPrice ? [
        { header: "Avg Cost", key: "avgCost", format: "currency" as const },
        { header: "Stock Value", key: "stockValue", format: "currency" as const },
      ] : []),
      { header: "Reorder Level", key: "reorderLevel", format: "number" as const },
    ];
    exportToExcel(exportData, cols, `products-${new Date().toISOString().split("T")[0]}`);
    toast.success(t("Products exported"));
  };

  const barcodeProducts = barcodeSingle ? [barcodeSingle] : selectedProducts;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-foreground">{t("Products")}</h1>
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
          {barcodeEnabled && selected.size > 0 && (
            <Button variant="outline" onClick={openBulkBarcode}>
              <Printer className="mr-2 h-4 w-4" /> {t("Print Barcodes")} ({selected.size})
            </Button>
          )}
          {reservationsEnabled && (
            <Button variant="outline" onClick={() => setShowReservations(true)}>
              <Lock className="mr-2 h-4 w-4" /> {t("Reservations")}
            </Button>
          )}
          <Button onClick={() => navigate("/products/new")}>
            <Plus className="mr-2 h-4 w-4" /> {t("Add Product")}
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{t("Total Products")}</div>
          <div className="mt-1 text-2xl font-bold text-foreground">{summary.totalProducts}</div>
        </div>
        {permissions.canViewCostPrice && (
          <div className="rounded-lg border bg-card p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{t("Total Stock Value")}</div>
            <div className="mt-1 text-2xl font-bold text-primary">{formatCurrency(summary.stockValue)}</div>
          </div>
        )}
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{t("Low Stock")}</div>
          <div className="mt-1 text-2xl font-bold text-amber-500">{summary.lowStock}</div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{t("Out of Stock")}</div>
          <div className="mt-1 text-2xl font-bold text-destructive">{summary.outOfStock}</div>
        </div>
      </div>

      {/* Smart Filter Bar */}
      <div className="rounded-lg border bg-card p-3 space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t("Search by SKU, name, or barcode…")}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="pl-9"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[150px]"><SelectValue placeholder={t("Category")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("All Categories")}</SelectItem>
                {categoryOptions.map((c) => (
                  <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={brandFilter} onValueChange={setBrandFilter}>
              <SelectTrigger className="w-[150px]"><SelectValue placeholder={t("Brand")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("All Brands")}</SelectItem>
                {brandOptions.map((b) => (
                  <SelectItem key={b} value={b}>{b}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={unitFilter} onValueChange={setUnitFilter}>
              <SelectTrigger className="w-[140px]"><SelectValue placeholder={t("Unit Type")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("All Units")}</SelectItem>
                <SelectItem value="box_sft">{t("Box / Sft")}</SelectItem>
                <SelectItem value="piece">{t("Piece")}</SelectItem>
              </SelectContent>
            </Select>

            <Select value={stockFilter} onValueChange={setStockFilter}>
              <SelectTrigger className="w-[150px]"><SelectValue placeholder={t("Stock")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("All Stock")}</SelectItem>
                <SelectItem value="in">{t("In Stock")}</SelectItem>
                <SelectItem value="low">{t("Low Stock")}</SelectItem>
                <SelectItem value="out">{t("Out of Stock")}</SelectItem>
                <SelectItem value="negative">{t("Negative")}</SelectItem>
              </SelectContent>
            </Select>

            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-[170px]"><SelectValue placeholder={t("Sort by")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="name-asc">{t("Name (A → Z)")}</SelectItem>
                <SelectItem value="name-desc">{t("Name (Z → A)")}</SelectItem>
                <SelectItem value="sku-asc">{t("SKU (A → Z)")}</SelectItem>
                <SelectItem value="price-asc">{t("Price (Low → High)")}</SelectItem>
                <SelectItem value="price-desc">{t("Price (High → Low)")}</SelectItem>
                <SelectItem value="qty-desc">{t("Qty (High → Low)")}</SelectItem>
                <SelectItem value="qty-asc">{t("Qty (Low → High)")}</SelectItem>
              </SelectContent>
            </Select>

            {activeFilterCount > 0 && (
              <Button variant="ghost" size="sm" onClick={clearAllFilters} className="gap-1">
                <X className="h-4 w-4" /> {t("Clear")}
              </Button>
            )}
          </div>
        </div>

        {activeFilterCount > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t("Active:")}</span>
            {search.trim() && <UIBadge variant="secondary">{t("Search:")} {search}</UIBadge>}
            {categoryFilter !== "all" && <UIBadge variant="secondary" className="capitalize">{t("Category:")} {categoryFilter}</UIBadge>}
            {brandFilter !== "all" && <UIBadge variant="secondary">{t("Brand:")} {brandFilter}</UIBadge>}
            {unitFilter !== "all" && <UIBadge variant="secondary">{t("Unit:")} {unitFilter === "box_sft" ? t("Box/Sft") : t("Piece")}</UIBadge>}
            {stockFilter !== "all" && <UIBadge variant="secondary" className="capitalize">{t("Stock:")} {stockFilter}</UIBadge>}
            <span className="ml-auto text-muted-foreground">
              {t("Showing")} {filteredProducts.length} {t("of")} {products.length} {t("on this page")}
            </span>
          </div>
        )}
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">{t("Loading…")}</p>
      ) : products.length === 0 ? (
        <div className="text-center py-12 space-y-3">
          <p className="text-muted-foreground">{t("No products found.")}</p>
          <Button onClick={() => navigate("/products/new")}>
            <Plus className="mr-2 h-4 w-4" /> {t("Add Your First Product")}
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
                      checked={filteredProducts.length > 0 && selected.size === filteredProducts.length}
                      onCheckedChange={toggleAll}
                    />
                  </TableHead>
                  <TableHead>{t("Code")}</TableHead>
                  <TableHead>{t("Name")}</TableHead>
                  <TableHead>{t("Brand")}</TableHead>
                  <TableHead>{t("Category")}</TableHead>
                  {permissions.canViewCostPrice && <TableHead className="text-right">{t("Avg Cost")}</TableHead>}
                  {permissions.canViewCostPrice && <TableHead className="text-right">{t("Last Cost")}</TableHead>}
                  <TableHead className="text-right">{t("Price")}</TableHead>
                  <TableHead className="text-right">{t("Quantity")}</TableHead>
                  <TableHead className="min-w-[60px]">{t("Unit")}</TableHead>
                  <TableHead className="w-[100px] min-w-[100px] text-center sticky right-0 bg-background z-10 shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.1)]">{t("Actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProducts.map((p) => {
                  const stockInfo = stockData?.get(p.id) ?? { total: 0, box: 0, sft: 0, piece: 0, totalPieces: 0, reservedBox: 0, reservedPiece: 0 };
                  const qty = stockInfo.total;
                  const costPerUnit = Math.max(0, costData?.get(p.id) ?? 0);
                  const reorder = p.reorder_level ?? 0;
                  const lastCost = Math.max(0, lastCostData?.get(p.id) ?? 0);
                  const isBoxSft = p.unit_type === "box_sft";
                  const perBoxSft = Number(p.per_box_sft) || 0;
                  const boxCost = isBoxSft && perBoxSft > 0 ? costPerUnit * perBoxSft : 0;
                  const lastBoxCost = isBoxSft && perBoxSft > 0 ? lastCost * perBoxSft : 0;
                  const hasTx = txProducts?.has(p.id) ?? false;

                  return (
                    <TableRow key={p.id} className="cursor-pointer" onClick={() => setDetailProduct(p)}>
                      <TableCell>
                        <Checkbox
                          checked={selected.has(p.id)}
                          onCheckedChange={() => toggleSelect(p.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-sm">{p.sku}</TableCell>
                      <TableCell>
                        <div>
                          <span>{p.name}</span>
                          {p.size && <span className="text-xs text-muted-foreground ml-1">({t("Size:")} {p.size})</span>}
                          {isBoxSft && perBoxSft > 0 && <span className="text-xs text-muted-foreground ml-1">({t("Box:")} {perBoxSft}sft)</span>}
                        </div>
                      </TableCell>
                      <TableCell>{p.brand || "—"}</TableCell>
                      <TableCell className="capitalize">{p.category}</TableCell>
                      {permissions.canViewCostPrice && (
                        <TableCell className="text-right">
                          {isBoxSft && perBoxSft > 0 ? (
                            <div>
                              <div>{formatCurrency(costPerUnit)}<span className="text-xs text-muted-foreground">/sft</span></div>
                              <div className="text-xs text-muted-foreground">{formatCurrency(boxCost)}/box</div>
                            </div>
                          ) : (
                            <span>{formatCurrency(costPerUnit)}</span>
                          )}
                        </TableCell>
                      )}
                      {permissions.canViewCostPrice && (
                        <TableCell className="text-right">
                          {lastCost > 0 ? (
                            isBoxSft && perBoxSft > 0 ? (
                              <div>
                                <div>{formatCurrency(lastCost)}<span className="text-xs text-muted-foreground">/sft</span></div>
                                <div className="text-xs text-muted-foreground">{formatCurrency(lastBoxCost)}/box</div>
                              </div>
                            ) : (
                              <span>{formatCurrency(lastCost)}</span>
                            )
                          ) : "—"}
                        </TableCell>
                      )}
                      <TableCell className="text-right">{formatCurrency(p.default_sale_rate)}</TableCell>
                      <TableCell className={`text-right font-medium ${qty < 0 ? "text-destructive" : ""}`}>
                        <TileStockBadge
                          totalPieces={stockInfo.totalPieces || (p.unit_type === "box_sft" ? stockInfo.box * (Number((p as any).pieces_per_box) || 1) : stockInfo.piece)}
                          piecesPerBox={Number((p as any).pieces_per_box) || 1}
                          perBoxSft={Number(p.per_box_sft) || 0}
                          isTile={p.unit_type === "box_sft"}
                          className="items-end"
                        />
                      </TableCell>
                      <TableCell className="min-w-[60px]">{p.unit_type === "box_sft" ? "Sft" : "Piece"}</TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()} className="sticky right-0 bg-background z-10 shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.1)]">
                        <ProductActionDropdown
                          onViewDetails={() => setDetailProduct(p)}
                          onEdit={() => navigate(`/products/${p.id}/edit`)}
                          onDuplicate={() => handleDuplicate(p)}
                          onDelete={() => setDeleteProduct(p)}
                          canDelete={!hasTx && permissions.canDeleteRecords}
                          onReserve={() => setReserveProduct(p)}
                          showReserve={reservationsEnabled}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
                {filteredProducts.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={permissions.canViewCostPrice ? 11 : 9} className="text-center py-8 text-muted-foreground">
                      {t("No products match the current filters.")}
                    </TableCell>
                  </TableRow>
                )}
                {/* Summary Footer */}
                {filteredProducts.length > 0 && (() => {
                  const totals = filteredProducts.reduce(
                    (acc, p) => {
                      const si = stockData?.get(p.id) ?? { total: 0, box: 0, sft: 0, piece: 0, totalPieces: 0, reservedBox: 0, reservedPiece: 0 };
                      acc.box += si.box;
                      acc.sft += si.sft;
                      acc.piece += si.piece;
                      return acc;
                    },
                    { box: 0, sft: 0, piece: 0 }
                  );
                  return (
                    <TableRow className="bg-muted/50 font-semibold">
                      <TableCell colSpan={permissions.canViewCostPrice ? 8 : 6} className="text-right">{t("Stock Totals:")}</TableCell>
                      <TableCell className="text-right">
                        <div className="space-y-0.5">
                          {totals.box > 0 && <div>{totals.box} Box ({totals.sft.toFixed(2)} Sft)</div>}
                          {totals.piece > 0 && <div>{totals.piece} Pcs</div>}
                        </div>
                      </TableCell>
                      <TableCell colSpan={2} />
                    </TableRow>
                  );
                })()}
              </TableBody>
            </Table>
          </div>
          {totalPages > 1 && (
            <Pagination page={page} totalItems={total} pageSize={PAGE_SIZE} onPageChange={setPage} />
          )}
        </>
      )}

      <BarcodePrintDialog
        open={barcodeOpen}
        onOpenChange={setBarcodeOpen}
        products={barcodeProducts}
      />

      <ProductDetailDialog
        open={!!detailProduct}
        onOpenChange={(open) => { if (!open) setDetailProduct(null); }}
        product={detailProduct}
        cost={detailProduct && permissions.canViewCostPrice ? (costData?.get(detailProduct.id) ?? 0) : 0}
        lastCost={detailProduct && permissions.canViewCostPrice ? (lastCostData?.get(detailProduct.id) ?? 0) : 0}
        quantity={detailProduct ? (stockData?.get(detailProduct.id)?.total ?? 0) : 0}
        showCost={permissions.canViewCostPrice}
        onEdit={() => { if (detailProduct) { setDetailProduct(null); navigate(`/products/${detailProduct.id}/edit`); } }}
        onPrintBarcode={barcodeEnabled ? () => { if (detailProduct) { setDetailProduct(null); openSingleBarcode(detailProduct); } } : undefined}
        onPurchase={() => { if (detailProduct) { setDetailProduct(null); navigate(`/purchases/new?product=${detailProduct.id}`); } }}
      />

      <BrokenStockDialog
        open={!!brokenProduct}
        onOpenChange={(open) => { if (!open) setBrokenProduct(null); }}
        product={brokenProduct}
        dealerId={dealerId}
        onSuccess={() => {
          setBrokenProduct(null);
          queryClient.invalidateQueries({ queryKey: ["products-stock-map"] });
        }}
      />

      <PurchaseHistoryDialog
        open={!!purchaseHistoryProduct}
        onOpenChange={(open) => { if (!open) setPurchaseHistoryProduct(null); }}
        productId={purchaseHistoryProduct?.id ?? null}
        productName={purchaseHistoryProduct?.name ?? ""}
        dealerId={dealerId}
      />

      <SalesHistoryDialog
        open={!!salesHistoryProduct}
        onOpenChange={(open) => { if (!open) setSalesHistoryProduct(null); }}
        productId={salesHistoryProduct?.id ?? null}
        productName={salesHistoryProduct?.name ?? ""}
        dealerId={dealerId}
      />

      {permissions.canAdjustStock && (
        <StockAdjustDialog
          open={!!adjustStockProduct}
          onOpenChange={(open) => { if (!open) setAdjustStockProduct(null); }}
          product={adjustStockProduct ? {
            ...adjustStockProduct,
            pieces_per_box: Number((adjustStockProduct as any).pieces_per_box) || 1,
            per_box_sft: Number(adjustStockProduct.per_box_sft) || 0,
          } : null}
          dealerId={dealerId}
          onSuccess={() => {
            setAdjustStockProduct(null);
            queryClient.invalidateQueries({ queryKey: ["products-stock-map"] });
            queryClient.invalidateQueries({ queryKey: ["products-cost-map"] });
          }}
        />
      )}

      {permissions.canDeleteRecords && (
        <DeleteConfirmDialog
          open={!!deleteProduct}
          onOpenChange={(open) => { if (!open) setDeleteProduct(null); }}
          title={t("Delete Product")}
          description={`${t("Are you sure you want to permanently delete")} "${deleteProduct?.name}"? ${t("This action cannot be undone.")}`}
          onConfirm={() => { if (deleteProduct) deleteMutation.mutate(deleteProduct.id); }}
        />
      )}

      <StockMovementDialog
        open={!!movementProduct}
        onOpenChange={(open) => { if (!open) setMovementProduct(null); }}
        productId={movementProduct?.id ?? null}
        productName={movementProduct?.name ?? ""}
        dealerId={dealerId}
        unitType={movementProduct?.unit_type ?? "box_sft"}
        piecesPerBox={Number((movementProduct as any)?.pieces_per_box) || 1}
      />

      {permissions.canEditPrices && (
        <UpdateSalePriceDialog
          open={!!salePriceProduct}
          onOpenChange={(open) => { if (!open) setSalePriceProduct(null); }}
          product={salePriceProduct}
          dealerId={dealerId}
        />
      )}

      {permissions.canEditPrices && (
        <UpdateCostPriceDialog
          open={!!costPriceProduct}
          onOpenChange={(open) => { if (!open) setCostPriceProduct(null); }}
          product={costPriceProduct}
          currentCost={costPriceProduct ? (costData?.get(costPriceProduct.id) ?? 0) : 0}
          dealerId={dealerId}
        />
      )}

      <ChangeBarcodeDialog
        open={!!barcodeChangeProduct}
        onOpenChange={(open) => { if (!open) setBarcodeChangeProduct(null); }}
        product={barcodeChangeProduct}
        dealerId={dealerId}
      />

      <SetReorderLevelDialog
        open={!!reorderProduct}
        onOpenChange={(open) => { if (!open) setReorderProduct(null); }}
        product={reorderProduct}
      />

      <StockSummaryDialog
        open={!!stockSummaryProduct}
        onOpenChange={(open) => { if (!open) setStockSummaryProduct(null); }}
        product={stockSummaryProduct}
        dealerId={dealerId}
      />
      <BulkImportDialog
        open={showImport}
        onOpenChange={setShowImport}
        title={t("Products")}
        columns={productColumns}
        sampleData={productSampleData}
        onImport={async (rows, mode) => {
          const result = await importProducts(rows, mode, dealerId);
          queryClient.invalidateQueries({ queryKey: ["products"] });
          return result;
        }}
      />

      {reserveProduct && (
        <CreateReservationDialog
          open={!!reserveProduct}
          onOpenChange={(open) => { if (!open) setReserveProduct(null); }}
          product={{ ...reserveProduct, pieces_per_box: Number((reserveProduct as any).pieces_per_box) || 1 }}
          dealerId={dealerId}
        />
      )}

      <ReservationListDialog
        open={showReservations}
        onOpenChange={setShowReservations}
        dealerId={dealerId}
      />
    </div>
  );
};

export default ProductList;
