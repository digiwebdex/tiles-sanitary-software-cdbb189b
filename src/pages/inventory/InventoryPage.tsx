/**
 * InventoryPage — V2 Sprint 3A (Inventory Core).
 *
 * A dedicated, dealer-wide stock screen: Current Stock, Inventory Search,
 * Stock Dashboard, and drill-down into Stock Summary / Stock Movement /
 * Stock Adjustment / Stock Ledger (History) — reusing the exact same
 * services, endpoints, and dialogs the (frozen) Products module already
 * uses. Nothing in src/modules/products or src/pages/products is modified;
 * this page only imports and reuses them.
 *
 * Explicitly NOT implemented here (later Inventory sprints, per scope):
 * Reservation, Backorder, Warehouse, Rack, Barcode.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDealerId } from "@/hooks/useDealerId";
import { usePermissions } from "@/hooks/usePermissions";
import { productService } from "@/services/productService";
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";
import { formatCurrency } from "@/lib/utils";
import { TileStockBadge } from "@/components/TileStockBadge";
import Pagination from "@/components/Pagination";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Search, Boxes, AlertTriangle, PackageX, Wallet, MoreHorizontal, History } from "lucide-react";
import StockAdjustDialog from "@/modules/products/StockAdjustDialog";
import StockMovementDialog from "@/modules/products/StockMovementDialog";
import StockSummaryDialog from "@/modules/products/StockSummaryDialog";
import StockLedgerDialog from "@/modules/inventory/StockLedgerDialog";

const PAGE_SIZE = 25;

type ProductRow = {
  id: string;
  sku: string;
  name: string;
  brand: string | null;
  unit_type: string;
  pieces_per_box: number | null;
  per_box_sft: number | null;
  reorder_level: number;
  active: boolean;
};

const InventoryPage = () => {
  const dealerId = useDealerId();
  const permissions = usePermissions();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const [adjustProduct, setAdjustProduct] = useState<ProductRow | null>(null);
  const [summaryProduct, setSummaryProduct] = useState<ProductRow | null>(null);
  const [movementProduct, setMovementProduct] = useState<ProductRow | null>(null);
  const [historyProduct, setHistoryProduct] = useState<ProductRow | null>(null);
  const [showFullLedger, setShowFullLedger] = useState(false);

  // Current Stock / Inventory Search — paginated, dealer-scoped product list.
  // Reuses productService.list() exactly as ProductList does (Sprint 2.1
  // extended it with server-side filters; this page only uses `search`).
  const { data, isLoading } = useQuery({
    queryKey: ["inventory-products", dealerId, search, page],
    queryFn: () => productService.list(dealerId, search, page),
    enabled: !!dealerId,
  });
  // The generated Supabase types (still used for shape only — reads/writes
  // are all VPS) don't include every real column (e.g. pieces_per_box);
  // ProductList.tsx works around the same gap the same way.
  const products = (data?.data ?? []) as unknown as ProductRow[];
  const total = data?.total ?? 0;

  // Dealer-wide stock quantities — same endpoint ProductList already uses.
  const { data: stockData } = useQuery({
    queryKey: ["products-stock-map", dealerId],
    queryFn: async () => {
      const res = await vpsAuthedFetch(`/api/products/stock-map?dealerId=${dealerId}`);
      const body = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error((body as any)?.error || "Failed to load stock");
      const map = new Map<string, { total: number; box: number; piece: number; totalPieces: number }>();
      for (const s of (body.rows ?? []) as any[]) {
        const box = Number(s.box_qty) || 0;
        const piece = Number(s.piece_qty) || 0;
        map.set(s.product_id, { total: box + piece, box, piece, totalPieces: Number(s.total_pieces) || 0 });
      }
      return map;
    },
    enabled: !!dealerId,
  });

  // Stock Dashboard — dealer-wide totals (all products, not just this page),
  // same source + math as ProductList's own summary widget.
  const { data: summaryData } = useQuery({
    queryKey: ["products-summary", dealerId],
    queryFn: async () => {
      const res = await vpsAuthedFetch(`/api/products/summary-rows?dealerId=${dealerId}`);
      const body = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error((body as any)?.error || "Failed to load");
      return (body.rows ?? []) as Array<{ id: string; cost_price?: number; reorder_level: number; unit_type: string }>;
    },
    enabled: !!dealerId,
  });

  const dashboard = useMemo(() => {
    const all = summaryData ?? [];
    let lowStock = 0;
    let outOfStock = 0;
    let stockValue = 0;
    for (const p of all) {
      const qty = stockData?.get(p.id)?.total ?? 0;
      const reorder = Number(p.reorder_level) || 0;
      const cost = Number(p.cost_price) || 0;
      stockValue += qty * cost;
      if (qty <= 0) outOfStock += 1;
      else if (qty <= reorder) lowStock += 1;
    }
    return { totalProducts: all.length, lowStock, outOfStock, stockValue };
  }, [summaryData, stockData]);

  const filteredProducts = useMemo(() => {
    if (statusFilter === "all") return products;
    return products.filter((p) => {
      const qty = stockData?.get(p.id)?.total ?? 0;
      const reorder = p.reorder_level ?? 0;
      if (statusFilter === "out") return qty <= 0;
      if (statusFilter === "low") return qty > 0 && qty <= reorder;
      if (statusFilter === "in") return qty > reorder;
      return true;
    });
  }, [products, statusFilter, stockData]);

  return (
    <div className="container mx-auto max-w-6xl p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Inventory</h1>
        <p className="text-sm text-muted-foreground">Current stock, movements, and adjustments across all products.</p>
      </div>

      {/* Stock Dashboard */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Products</CardTitle>
            <Boxes className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">{dashboard.totalProducts}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Low Stock</CardTitle>
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold text-amber-600">{dashboard.lowStock}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Out of Stock</CardTitle>
            <PackageX className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold text-destructive">{dashboard.outOfStock}</div></CardContent>
        </Card>
        {permissions.canViewCostPrice && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-sm font-medium text-muted-foreground">Stock Value</CardTitle>
              <Wallet className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><div className="text-2xl font-bold">{formatCurrency(dashboard.stockValue)}</div></CardContent>
          </Card>
        )}
      </div>

      {/* Inventory Search + filters */}
      <div className="rounded-lg border bg-card p-3 space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by SKU, name, brand, series…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Stock Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Stock</SelectItem>
              <SelectItem value="in">In Stock</SelectItem>
              <SelectItem value="low">Low Stock</SelectItem>
              <SelectItem value="out">Out of Stock</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => setShowFullLedger(true)}>
            <History className="mr-2 h-4 w-4" /> Stock Ledger
          </Button>
        </div>
      </div>

      {/* Current Stock table */}
      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : filteredProducts.length === 0 ? (
        <p className="text-muted-foreground">No products found.</p>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Brand</TableHead>
                <TableHead className="text-right">Current Stock</TableHead>
                <TableHead className="text-right">Reorder Level</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredProducts.map((p) => {
                const stockInfo = stockData?.get(p.id);
                const qty = stockInfo?.total ?? 0;
                const reorder = p.reorder_level ?? 0;
                const isTile = p.unit_type === "box_sft";
                const status = qty <= 0 ? "out" : qty <= reorder ? "low" : "in";
                return (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                    <TableCell>{p.name}</TableCell>
                    <TableCell className="text-muted-foreground">{p.brand || "—"}</TableCell>
                    <TableCell className="text-right">
                      <TileStockBadge
                        totalPieces={stockInfo?.totalPieces ?? 0}
                        piecesPerBox={Number(p.pieces_per_box) || 1}
                        perBoxSft={Number(p.per_box_sft) || 0}
                        isTile={isTile}
                        className="items-end"
                      />
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">{reorder || "—"}</TableCell>
                    <TableCell>
                      {status === "out" && <Badge variant="destructive">Out of Stock</Badge>}
                      {status === "low" && <Badge variant="secondary" className="bg-amber-100 text-amber-800 hover:bg-amber-100">Low Stock</Badge>}
                      {status === "in" && <Badge variant="outline">In Stock</Badge>}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setSummaryProduct(p)}>Stock Summary</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setMovementProduct(p)}>Stock Movement</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setHistoryProduct(p)}>Stock History</DropdownMenuItem>
                          {permissions.canAdjustStock && (
                            <DropdownMenuItem onClick={() => setAdjustProduct(p)}>Adjust Stock</DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Pagination page={page} totalItems={total} pageSize={PAGE_SIZE} onPageChange={setPage} />

      {/* Reused, unmodified dialogs from the Products module */}
      {permissions.canAdjustStock && (
        <StockAdjustDialog
          open={!!adjustProduct}
          onOpenChange={(open) => { if (!open) setAdjustProduct(null); }}
          product={adjustProduct ? {
            ...adjustProduct,
            pieces_per_box: Number(adjustProduct.pieces_per_box) || 1,
            per_box_sft: Number(adjustProduct.per_box_sft) || 0,
          } : null}
          dealerId={dealerId}
          onSuccess={() => setAdjustProduct(null)}
        />
      )}

      <StockSummaryDialog
        open={!!summaryProduct}
        onOpenChange={(open) => { if (!open) setSummaryProduct(null); }}
        product={summaryProduct}
        dealerId={dealerId}
      />

      <StockMovementDialog
        open={!!movementProduct}
        onOpenChange={(open) => { if (!open) setMovementProduct(null); }}
        productId={movementProduct?.id ?? null}
        productName={movementProduct?.name ?? ""}
        dealerId={dealerId}
        unitType={movementProduct?.unit_type ?? "box_sft"}
        piecesPerBox={Number(movementProduct?.pieces_per_box) || 1}
      />

      {/* New in Sprint 3A — Stock Ledger / Stock History */}
      <StockLedgerDialog
        open={!!historyProduct}
        onOpenChange={(open) => { if (!open) setHistoryProduct(null); }}
        dealerId={dealerId}
        productId={historyProduct?.id}
        productName={historyProduct?.name}
      />
      <StockLedgerDialog
        open={showFullLedger}
        onOpenChange={setShowFullLedger}
        dealerId={dealerId}
      />
    </div>
  );
};

export default InventoryPage;
