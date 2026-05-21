import React, { useEffect, useMemo, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { purchaseSchema, type PurchaseFormValues } from "@/modules/purchases/purchaseSchema";
import { useQuery } from "@tanstack/react-query";
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";
import { supplierService } from "@/services/supplierService";
import { bankAccountService } from "@/services/bankAccountService";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Trash2, Search, Package, AlertTriangle } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { enrichItemsWithSqft } from "@/lib/tileSqftEnrich";
import { ceilBoxesFromSft } from "@/lib/tileRounding";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { SupplierAdvisoryHint } from "@/components/SupplierAdvisoryHint";
import PurchaseSummaryPanel from "@/modules/purchases/PurchaseSummaryPanel";
import BarcodeScanInput from "@/modules/purchases/BarcodeScanInput";
import PurchaseDraftMenu from "@/modules/purchases/PurchaseDraftMenu";
import type { PurchaseDraft } from "@/services/purchaseService";
import { purchaseService } from "@/services/purchaseService";
import { toast } from "sonner";

interface LastPurchaseInfo {
  purchase_rate: number;
  landed_cost: number;
  purchase_date: string;
  supplier_name: string;
}

interface PurchaseFormProps {
  dealerId: string;
  showOfferPrice: boolean;
  onSubmit: (values: PurchaseFormValues) => Promise<void>;
  isLoading?: boolean;
  /** Phase 3U-31: enable drafts (dealer_admin). */
  enableDrafts?: boolean;
}


const PurchaseForm = ({ dealerId, showOfferPrice, onSubmit, isLoading, enableDrafts }: PurchaseFormProps) => {
  const [searchParams] = useSearchParams();
  const prefillProductId = searchParams.get("product");
  const prefilledRef = useRef(false);
  const [productSearch, setProductSearch] = useState("");
  // Per-row UI: tile entry mode ("box" default, or "sft" to type SFT and auto-round to next full box).
  // Not persisted; backend still receives `quantity` (= box count) for tiles.
  const [entryModes, setEntryModes] = useState<Record<string, "box" | "sft">>({});
  const [sftInputs, setSftInputs] = useState<Record<string, string>>({});
  // Phase 3U-31: track the loaded draft so re-saving updates instead of duplicating.
  const [draftId, setDraftId] = useState<string | null>(null);

  const form = useForm<PurchaseFormValues>({
    resolver: zodResolver(purchaseSchema),
    defaultValues: {
      supplier_id: "",
      invoice_number: "",
      purchase_date: new Date().toISOString().split("T")[0],
      notes: "",
      voucher_discount: 0,
      paid_on_create: 0,
      paid_account_id: null,
      items: [],
    },
  });


  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "items",
  });

  // Use the same supplierService.list that the Suppliers page uses, so this
  // dropdown stays in lockstep with the Supplier list (any auth/scoping fix
  // applied there flows here automatically).
  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers-picker", dealerId],
    queryFn: async () => {
      // Page size 200 is the backend's hard cap; pull all by paginating if needed.
      const pages: { id: string; name: string }[] = [];
      let page = 1;
      // Most dealers have <200 suppliers; loop just in case.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data, total } = await supplierService.list(dealerId, "", page);
        pages.push(...data.map((s) => ({ id: s.id, name: s.name })));
        if (pages.length >= total || data.length === 0) break;
        page += 1;
        if (page > 20) break; // safety
      }
      return pages;
    },
    enabled: !!dealerId,
  });

  // Phase 3U-30: VPS GET /api/products (active).
  const { data: products = [] } = useQuery({
    queryKey: ["products-active", dealerId],
    queryFn: async () => {
      const res = await vpsAuthedFetch(
        `/api/products?dealerId=${dealerId}&pageSize=500&orderBy=name&orderDir=asc&f.active=true`,
      );
      const body = await res.json().catch(() => ({} as any));
      return ((body as any)?.rows ?? []) as Array<{
        id: string;
        name: string;
        sku: string;
        unit_type: string;
        per_box_sft: number | null;
        pieces_per_box: number | null;
        category: string;
        stock_base_unit?: string | null;
        sqft_per_piece?: number | null;
      }>;
    },
    enabled: !!dealerId,
  });

  // Phase 3U-30: VPS GET /api/products/last-purchase-map (dealer_admin only).
  const { data: lastPurchaseMap = new Map<string, LastPurchaseInfo>() } = useQuery({
    queryKey: ["products-last-purchase-info", dealerId],
    queryFn: async () => {
      const res = await vpsAuthedFetch(
        `/api/products/last-purchase-map?dealerId=${dealerId}`,
      );
      if (!res.ok) return new Map<string, LastPurchaseInfo>();
      const body = await res.json().catch(() => ({} as any));
      const obj = (body ?? {}) as Record<string, LastPurchaseInfo>;
      return new Map<string, LastPurchaseInfo>(Object.entries(obj));
    },
    enabled: !!dealerId,
  });

  // Phase 3U-30: VPS GET /api/products/cost-map (dealer_admin only).
  const { data: avgCostMap = new Map<string, number>() } = useQuery({
    queryKey: ["products-avg-cost", dealerId],
    queryFn: async () => {
      const res = await vpsAuthedFetch(`/api/products/cost-map?dealerId=${dealerId}`);
      if (!res.ok) return new Map<string, number>();
      const body = await res.json().catch(() => ({} as any));
      const obj = (body ?? {}) as Record<string, number>;
      return new Map<string, number>(
        Object.entries(obj).map(([k, v]) => [k, Number(v) || 0]),
      );
    },
    enabled: !!dealerId,
  });

  // Phase 3U-31: Bank accounts for "Paid From" selector.
  const { data: bankAccounts = [] } = useQuery({
    queryKey: ["bank-accounts-active", dealerId],
    queryFn: () => bankAccountService.list(dealerId),
    enabled: !!dealerId && !!enableDrafts, // dealer_admin only — mirrors enableDrafts gate
  });

  const watchItems = form.watch("items");
  const watchSupplierId = form.watch("supplier_id");
  const watchVoucherDiscount = form.watch("voucher_discount") || 0;
  const watchPaidOnCreate = form.watch("paid_on_create") || 0;
  const watchPaidAccountId = form.watch("paid_account_id") ?? null;


  const getItemProduct = (productId: string) =>
    products.find((p) => p.id === productId);

  const calcBaseCost = (idx: number) => {
    const item = watchItems[idx];
    if (!item) return 0;
    const product = getItemProduct(item.product_id);
    if (product?.unit_type === "box_sft" && product.per_box_sft) {
      // box_qty × per_box_sft × rate_per_sft
      return (item.quantity || 0) * product.per_box_sft * (item.purchase_rate || 0);
    }
    // piece: qty × rate
    return (item.quantity || 0) * (item.purchase_rate || 0);
  };

  const calcLandedCost = (idx: number) => {
    const item = watchItems[idx];
    if (!item) return 0;
    const baseCost = calcBaseCost(idx);
    return baseCost + (item.transport_cost || 0) + (item.labor_cost || 0) + (item.other_cost || 0);
  };

  const calcLandedCostPerSft = (idx: number) => {
    const totalSft = calcTotalSft(idx);
    if (!totalSft || totalSft === 0) return null;
    return calcLandedCost(idx) / totalSft;
  };

  const calcTotalSft = (idx: number) => {
    const item = watchItems[idx];
    if (!item) return null;
    const product = getItemProduct(item.product_id);
    if (product?.unit_type === "box_sft" && product.per_box_sft) {
      return (item.quantity || 0) * product.per_box_sft;
    }
    return null;
  };

  const filteredProducts = products.filter((p) => {
    if (!productSearch.trim()) return true;
    const q = productSearch.toLowerCase();
    return p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
  });

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  };

  const addProduct = (productId: string) => {
    if (watchItems.some((item) => item.product_id === productId)) return;
    append({
      product_id: productId,
      quantity: 0,
      purchase_rate: 0,
      offer_price: 0,
      transport_cost: 0,
      labor_cost: 0,
      other_cost: 0,
      batch_no: "",
      lot_no: "",
      shade_code: "",
      caliber: "",
    });
    setProductSearch("");
  };

  // Prefill an item when navigated with ?product=ID (e.g. from product detail "Purchase" button).
  useEffect(() => {
    if (prefilledRef.current) return;
    if (!prefillProductId) return;
    if (products.length === 0) return;
    const match = products.find((p) => p.id === prefillProductId);
    if (!match) return;
    prefilledRef.current = true;
    addProduct(match.id);
  }, [prefillProductId, products]);

  // Phase 3U-31: barcode scan → resolve to product → addProduct.
  const handleBarcodeScan = (code: string) => {
    if (!watchSupplierId) {
      toast.error("Select a supplier first");
      return;
    }
    const lc = code.toLowerCase();
    const match = products.find(
      (p) => p.sku?.toLowerCase() === lc || p.name?.toLowerCase() === lc,
    );
    if (!match) {
      toast.error(`No product matches "${code}"`);
      return;
    }
    if (watchItems.some((i) => i.product_id === match.id)) {
      toast.message(`${match.name} already in cart`);
      return;
    }
    addProduct(match.id);
    toast.success(`Added ${match.sku}`);
  };

  // Phase 3U-31: load a saved draft.
  const handleLoadDraft = (draft: PurchaseDraft) => {
    const p = (draft.payload || {}) as Partial<PurchaseFormValues>;
    form.reset({
      supplier_id: p.supplier_id || "",
      invoice_number: p.invoice_number || "",
      purchase_date: p.purchase_date || new Date().toISOString().split("T")[0],
      notes: p.notes || "",
      voucher_discount: Number(p.voucher_discount) || 0,
      paid_on_create: Number(p.paid_on_create) || 0,
      paid_account_id: p.paid_account_id ?? null,
      items: Array.isArray(p.items) ? (p.items as any) : [],
    });
    setDraftId(draft.id);
    toast.success("Draft loaded");
  };

  const handleSaveDraft = async () => {
    try {
      const values = form.getValues();
      const label =
        values.invoice_number?.trim() ||
        `Draft ${new Date().toLocaleString()}`;
      const saved = await purchaseService.saveDraft(dealerId, values, {
        id: draftId ?? undefined,
        label,
      });
      setDraftId(saved.id);
      toast.success("Draft saved");
    } catch (e: any) {
      toast.error(e?.message || "Failed to save draft");
    }
  };

  // Aggregates for the summary panel.
  const subtotalLanded = watchItems.reduce((s, _, i) => s + calcLandedCost(i), 0);
  const transportSum = watchItems.reduce((s, it) => s + (Number(it.transport_cost) || 0), 0);
  const laborSum = watchItems.reduce((s, it) => s + (Number(it.labor_cost) || 0), 0);
  const otherSum = watchItems.reduce((s, it) => s + (Number(it.other_cost) || 0), 0);
  const grandTotal = subtotalLanded;


  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(async (values) => {
          // Phase T4b: for tile products on SQFT base, attach qty_sqft + rate_unit per line.
          const map = new Map(products.map((p) => [p.id, p]));
          const enriched = enrichItemsWithSqft(values.items as any[], map as any, { defaultRateUnit: "per_sqft" });
          await onSubmit({ ...values, items: enriched } as PurchaseFormValues);
        })}
        className="grid gap-5 lg:grid-cols-[1fr_340px]"
      >
        <div className="space-y-5 min-w-0">
          {/* Drafts toolbar */}
          {enableDrafts && (
            <div className="flex items-center justify-end">
              <PurchaseDraftMenu dealerId={dealerId} onLoad={handleLoadDraft} />
            </div>
          )}

        {/* Top section: Reference, Date */}
        <Card>
          <CardContent className="pt-5">
            <p className="mb-4 text-sm text-muted-foreground">
              Please fill in the information below. The field labels marked with <span className="text-destructive">*</span> are required input fields.
            </p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="invoice_number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reference No</FormLabel>
                    <FormControl><Input placeholder="Auto-generated if left blank" {...field} /></FormControl>
                    <p className="text-xs text-muted-foreground mt-1">Leave blank to auto-generate a unique number (PUR-YYYYMMDD-NNNN).</p>
                    <FormMessage />
                  </FormItem>

                )}
              />
              <FormField
                control={form.control}
                name="purchase_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Purchase Date <span className="text-destructive">*</span></FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </CardContent>
        </Card>

        {/* Supplier selection */}
        <Alert className="border-accent bg-accent/50">
          <AlertDescription className="text-accent-foreground">
            Please select a supplier before adding any product
          </AlertDescription>
        </Alert>

        <Card>
          <CardContent className="pt-5">
            <FormField
              control={form.control}
              name="supplier_id"
              render={({ field }) => (
                <FormItem className="max-w-sm">
                  <FormLabel>Supplier <span className="text-destructive">*</span></FormLabel>
                  <Select onValueChange={field.onChange} value={field.value} disabled={suppliers.length === 0}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={suppliers.length === 0 ? "No suppliers available" : "Select Supplier"} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {suppliers.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {suppliers.length === 0 && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      No suppliers found.{" "}
                      <Link to="/suppliers" className="font-medium text-primary underline">
                        Add a supplier
                      </Link>{" "}
                      first to create a purchase.
                    </p>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
            {watchSupplierId && (
              <SupplierAdvisoryHint dealerId={dealerId} supplierId={watchSupplierId} />
            )}
          </CardContent>
        </Card>

        {/* Product search + barcode scanner */}
        <Card>
          <CardContent className="pt-5 space-y-3">
            <BarcodeScanInput onScan={handleBarcodeScan} disabled={!watchSupplierId} />
            <div className="relative">
              <div className="flex items-center gap-2 rounded-md border bg-background">
                <Package className="ml-3 h-5 w-5 text-muted-foreground" />
                <Input
                  placeholder="Search products by name or SKU to add..."
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  className="border-0 shadow-none focus-visible:ring-0"
                  disabled={!watchSupplierId}
                />
                <Search className="mr-3 h-4 w-4 text-muted-foreground" />
              </div>
              {productSearch.trim() && watchSupplierId && (
                <div className="absolute z-50 mt-1 max-h-48 w-full overflow-auto rounded-md border bg-popover shadow-lg">
                  {filteredProducts.length === 0 ? (
                    <div className="p-3 text-sm text-muted-foreground">No products found</div>
                  ) : (
                    filteredProducts.map((p) => {
                      const lastInfo = lastPurchaseMap.get(p.id);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-50"
                          onClick={() => addProduct(p.id)}
                          disabled={watchItems.some((item) => item.product_id === p.id)}
                        >
                          <span className="font-medium">{p.sku}</span>
                          <span className="text-muted-foreground">— {p.name}</span>
                          {lastInfo && (
                            <span className="ml-auto text-xs text-primary font-medium">
                              Last: {formatCurrency(lastInfo.purchase_rate)}
                            </span>
                          )}
                          {watchItems.some((item) => item.product_id === p.id) && (
                            <span className={`${lastInfo ? '' : 'ml-auto'} text-xs text-muted-foreground`}>(added)</span>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>
            {!watchSupplierId && (
              <p className="mt-2 text-xs text-muted-foreground">Select a supplier first to add products</p>
            )}
          </CardContent>
        </Card>

        {/* Items list - card per item, 3 rows of fields */}
        {fields.length > 0 && (
          <div className="space-y-3">
            {fields.map((field, idx) => {
              const product = getItemProduct(watchItems[idx]?.product_id);
              const totalSft = calcTotalSft(idx);
              const landedCost = calcLandedCost(idx);
              const lastInfo = product ? lastPurchaseMap.get(product.id) : undefined;
              const avgCost = product ? avgCostMap.get(product.id) : undefined;
              const currentRate = watchItems[idx]?.purchase_rate || 0;
              const rateChanged = lastInfo && lastInfo.purchase_rate > 0 && currentRate > 0 && currentRate !== lastInfo.purchase_rate;
              const lcPerSft = calcLandedCostPerSft(idx);

              return (
                <Card key={field.id}>
                  <CardContent className="p-4 space-y-3">
                    {/* Header: # + Product info + delete */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <span className="text-sm text-muted-foreground font-medium pt-0.5">#{idx + 1}</span>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold">{product?.name ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">{product?.sku}</div>
                          {lastInfo && (
                            <div className="text-xs text-primary font-medium mt-0.5">
                              Last Rate: {formatCurrency(lastInfo.purchase_rate)} ({formatDate(lastInfo.purchase_date)}) - {lastInfo.supplier_name}
                            </div>
                          )}
                          {avgCost !== undefined && avgCost > 0 && (
                            <div className="text-xs text-muted-foreground mt-0.5">
                              Avg Cost: {formatCurrency(avgCost)}
                            </div>
                          )}
                        </div>
                      </div>
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => remove(idx)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>

                    {/* Rows: Qty, Rate, Offer, Transport, Labor, Other, SFT, Landed — horizontal scroll on narrow */}
                    <div className="overflow-x-auto -mx-4 px-4">
                      <div className="grid gap-3 min-w-[900px]" style={{ gridTemplateColumns: `minmax(180px,1fr) minmax(110px,1fr)${showOfferPrice ? ' minmax(110px,1fr)' : ''} minmax(110px,1fr) minmax(110px,1fr) minmax(110px,1fr) minmax(120px,1fr) minmax(120px,1fr)` }}>
                        <FormField
                          control={form.control}
                          name={`items.${idx}.quantity`}
                          render={({ field: f }) => {
                            const isTile =
                              product?.unit_type === "box_sft" && !!product?.per_box_sft;
                            const ppb = Number(product?.pieces_per_box ?? 1) || 1;
                            const perBoxSft = Number(product?.per_box_sft ?? 0) || 0;
                            const rowKey = field.id;
                            const mode = isTile ? entryModes[rowKey] ?? "box" : "box";
                            const boxQty = Number(f.value) || 0;
                            const totalPcs = Math.round(boxQty * ppb);
                            const wholeBox = Math.floor(totalPcs / Math.max(ppb, 1));
                            const extraPc = totalPcs - wholeBox * Math.max(ppb, 1);
                            const perPieceSft = ppb > 0 ? perBoxSft / ppb : perBoxSft;
                            const totalSftPreview = totalPcs * perPieceSft;

                            return (
                              <FormItem className="space-y-1 min-w-[180px]">
                                <div className="flex items-center justify-between gap-2">
                                  <FormLabel className="text-xs">
                                    {isTile
                                      ? mode === "sft"
                                        ? "Qty (SFT)"
                                        : "Qty (Box)"
                                      : "Qty (Pc)"}
                                  </FormLabel>
                                  {isTile && (
                                    <ToggleGroup
                                      type="single"
                                      size="sm"
                                      value={mode}
                                      onValueChange={(v) => {
                                        if (!v) return;
                                        setEntryModes((prev) => ({ ...prev, [rowKey]: v as "box" | "sft" }));
                                        if (v === "sft") {
                                          const curPcs = Math.round((Number(f.value) || 0) * ppb);
                                          const curSft = curPcs * (ppb > 0 ? perBoxSft / ppb : perBoxSft);
                                          setSftInputs((prev) => ({ ...prev, [rowKey]: curPcs > 0 ? String(curSft) : "" }));
                                        }
                                      }}
                                      className="h-6"
                                    >
                                      <ToggleGroupItem value="box" className="h-6 px-2 text-[10px]">
                                        Box
                                      </ToggleGroupItem>
                                      <ToggleGroupItem value="sft" className="h-6 px-2 text-[10px]">
                                        SFT
                                      </ToggleGroupItem>
                                    </ToggleGroup>
                                  )}
                                </div>
                                <FormControl>
                                  {isTile && mode === "sft" ? (
                                    <Input
                                      type="number"
                                      step="0.01"
                                      className="h-10 text-base min-w-[160px]"
                                      style={{ flexShrink: 0 }}
                                      placeholder="e.g. 200"
                                      value={sftInputs[rowKey] ?? ""}
                                      onChange={(e) => {
                                        const raw = e.target.value;
                                        setSftInputs((prev) => ({ ...prev, [rowKey]: raw }));
                                        const sft = Number(raw) || 0;
                                        // Round up to next PIECE (not full box) — allows partial box buys.
                                        const pps = ppb > 0 ? perBoxSft / ppb : perBoxSft;
                                        const pcs = pps > 0 ? Math.ceil(sft / pps) : 0;
                                        const boxesDecimal = ppb > 0 ? pcs / ppb : pcs;
                                        f.onChange(boxesDecimal);
                                      }}
                                    />
                                  ) : (
                                    <Input
                                      type="number"
                                      step={isTile ? "1" : "0.01"}
                                      className="h-10 text-base min-w-[160px]"
                                      style={{ flexShrink: 0 }}
                                      {...f}
                                    />
                                  )}
                                </FormControl>
                                {isTile ? (
                                  <div className="text-[10px] text-muted-foreground leading-tight">
                                    {mode === "sft" ? (
                                      <>
                                        = <strong className="text-foreground">{wholeBox} Box {extraPc} Pc</strong> = {totalPcs} Pc total = {totalSftPreview.toFixed(2)} SFT
                                        <div className="text-[9px]">Auto-rounded up to next piece</div>
                                      </>
                                    ) : (
                                      <>
                                        = <strong className="text-foreground">{totalPcs} Pc</strong> = {totalSftPreview.toFixed(2)} SFT
                                      </>
                                    )}
                                  </div>
                                ) : (
                                  <div className="text-[10px] text-muted-foreground">Pieces</div>
                                )}
                              </FormItem>
                            );
                          }}
                        />
                        <FormField
                          control={form.control}
                          name={`items.${idx}.purchase_rate`}
                          render={({ field: f }) => (
                            <FormItem className="space-y-1 min-w-[110px]">
                              <FormLabel className="text-xs">Rate (/SFT or /Pc)</FormLabel>
                              <FormControl>
                                <Input type="number" step="0.01" className="h-10 text-base min-w-[90px]" style={{ flexShrink: 0 }} {...f} />
                              </FormControl>
                              {rateChanged && (
                                <Badge variant="outline" className="mt-1 text-[10px] border-destructive/50 text-destructive gap-1">
                                  <AlertTriangle className="h-3 w-3" />
                                  Rate changed
                                </Badge>
                              )}
                            </FormItem>
                          )}
                        />
                        {showOfferPrice && (
                          <FormField
                            control={form.control}
                            name={`items.${idx}.offer_price`}
                            render={({ field: f }) => (
                              <FormItem className="space-y-1 min-w-[110px]">
                                <FormLabel className="text-xs">Offer Price</FormLabel>
                                <FormControl>
                                  <Input type="number" step="0.01" className="h-10 text-base min-w-[90px]" style={{ flexShrink: 0 }} {...f} />
                                </FormControl>
                              </FormItem>
                            )}
                          />
                        )}
                        <FormField
                          control={form.control}
                          name={`items.${idx}.transport_cost`}
                          render={({ field: f }) => (
                            <FormItem className="space-y-1 min-w-[110px]">
                              <FormLabel className="text-xs">Transport</FormLabel>
                              <FormControl>
                                <Input type="number" step="0.01" className="h-10 text-base min-w-[90px]" style={{ flexShrink: 0 }} {...f} />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`items.${idx}.labor_cost`}
                          render={({ field: f }) => (
                            <FormItem className="space-y-1 min-w-[110px]">
                              <FormLabel className="text-xs">Labor</FormLabel>
                              <FormControl>
                                <Input type="number" step="0.01" className="h-10 text-base min-w-[90px]" style={{ flexShrink: 0 }} {...f} />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`items.${idx}.other_cost`}
                          render={({ field: f }) => (
                            <FormItem className="space-y-1 min-w-[110px]">
                              <FormLabel className="text-xs">Other</FormLabel>
                              <FormControl>
                                <Input type="number" step="0.01" className="h-10 text-base min-w-[90px]" style={{ flexShrink: 0 }} {...f} />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                        <div className="space-y-1 min-w-[120px]">
                          <div className="text-xs font-medium">SFT</div>
                          <div className="h-10 rounded-md border bg-muted/40 px-3 flex flex-col justify-center text-sm">
                            {totalSft !== null ? (
                              <>
                                <span>{totalSft.toFixed(2)}</span>
                                {product?.unit_type === "box_sft" && product.per_box_sft && watchItems[idx] && (
                                  <span className="text-[10px] text-muted-foreground">
                                    {watchItems[idx].quantity} × {product.per_box_sft} sft
                                  </span>
                                )}
                              </>
                            ) : "—"}
                          </div>
                          {lcPerSft !== null && lcPerSft > 0 && (
                            <div className="text-[10px] text-primary font-medium">
                              Landed/SFT: {formatCurrency(lcPerSft)}
                            </div>
                          )}
                        </div>
                        <div className="space-y-1 min-w-[120px]">
                          <div className="text-xs font-medium">Landed Cost</div>
                          <div className="h-10 rounded-md border bg-muted/40 px-3 flex items-center justify-end text-sm font-semibold">
                            {formatCurrency(landedCost)}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Batch fields for tiles */}
                    {product?.category === "tiles" && (
                      <div className="flex flex-wrap items-center gap-2 pt-2 border-t">
                        <FormField
                          control={form.control}
                          name={`items.${idx}.batch_no`}
                          render={({ field: f }) => (
                            <FormItem className="space-y-0">
                              <FormControl>
                                <Input placeholder="Batch No" className="h-8 text-xs w-32" {...f} />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`items.${idx}.shade_code`}
                          render={({ field: f }) => (
                            <FormItem className="space-y-0">
                              <FormControl>
                                <Input placeholder="Shade" className="h-8 text-xs w-24" {...f} />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`items.${idx}.caliber`}
                          render={({ field: f }) => (
                            <FormItem className="space-y-0">
                              <FormControl>
                                <Input placeholder="Caliber" className="h-8 text-xs w-24" {...f} />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`items.${idx}.lot_no`}
                          render={({ field: f }) => (
                            <FormItem className="space-y-0">
                              <FormControl>
                                <Input placeholder="Lot No" className="h-8 text-xs w-28" {...f} />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                        <span className="text-[10px] text-muted-foreground">Batch/Shade tracking</span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {fields.length === 0 && watchSupplierId && (
          <div className="rounded-md border border-dashed p-8 text-center text-muted-foreground">
            <Package className="mx-auto mb-2 h-8 w-8" />
            <p>Please add products to order list</p>
            <p className="mt-1 text-xs">Use the search bar above to find and add products</p>
          </div>
        )}

        {/* Notes */}
        <Card>
          <CardContent className="pt-5">
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Note</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Add purchase notes..." rows={4} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        </div>

        {/* Right column: sticky Purchase Summary */}
        <aside className="lg:w-[340px]">
          <PurchaseSummaryPanel
            itemCount={fields.length}
            subtotal={subtotalLanded}
            transport={transportSum}
            labor={laborSum}
            other={otherSum}
            voucherDiscount={watchVoucherDiscount}
            paidOnCreate={watchPaidOnCreate}
            paidAccountId={watchPaidAccountId}
            bankAccounts={bankAccounts}
            onVoucherDiscountChange={(v) => form.setValue("voucher_discount", v, { shouldDirty: true })}
            onPaidOnCreateChange={(v) => form.setValue("paid_on_create", v, { shouldDirty: true })}
            onPaidAccountChange={(v) => form.setValue("paid_account_id", v, { shouldDirty: true })}
            onSubmit={() => form.handleSubmit(async (values) => {
              const map = new Map(products.map((p) => [p.id, p]));
              const enriched = enrichItemsWithSqft(values.items as any[], map as any, { defaultRateUnit: "per_sqft" });
              await onSubmit({ ...values, items: enriched } as PurchaseFormValues);
            })()}
            onSaveDraft={enableDrafts ? handleSaveDraft : undefined}
            isLoading={isLoading}
            canSubmit={fields.length > 0 && !!watchSupplierId}
            canSaveDraft={!!watchSupplierId}
          />
        </aside>
      </form>
    </Form>
  );
};

export default PurchaseForm;

