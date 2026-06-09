import { useState, useEffect } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { saleSchema, type SaleFormValues } from "@/modules/sales/saleSchema";
import { useQuery } from "@tanstack/react-query";
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";
import { pricingTierService } from "@/services/pricingTierService";
import RateSourceBadge from "@/components/RateSourceBadge";
import { ProjectSitePicker } from "@/components/project/ProjectSitePicker";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Search, Barcode, AlertTriangle, PackageX, Layers, Lock, CheckCircle } from "lucide-react";
import { formatCurrency, CURRENCY_CODE } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { previewBatchAllocation } from "@/services/salesService";
import type { FIFOAllocationResult } from "@/services/batchService";
import { getCustomerProductReservations, listReservations, type Reservation } from "@/services/reservationService";
import { useDealerInfo } from "@/hooks/useDealerInfo";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  getApprovalSettings,
  isApprovalRequired,
  createApprovalRequest,
  findValidApproval,
  type ApprovalContextData,
  type ApprovalType,
} from "@/services/approvalService";
import { ApprovalRequestDialog } from "@/components/approval/ApprovalRequestDialog";
import SaleCommissionSection, { type SaleCommissionDraft } from "@/components/sale/SaleCommissionSection";
import { enrichItemsWithSqft } from "@/lib/tileSqftEnrich";

interface StockShortageItem {
  product_name: string;
  unit_label: string;
  requested: number;
  available: number;
  shortage: number;
}

interface SaleFormProps {
  dealerId: string;
  onSubmit: (values: SaleFormValues & { allow_backorder?: boolean; reservation_selections?: Record<string, Array<{ reservation_id: string; consume_qty: number }>>; commission?: SaleCommissionDraft | null }) => Promise<void>;
  isLoading?: boolean;
  defaultValues?: Partial<SaleFormValues>;
  submitLabel?: string;
  priceLocked?: boolean;
  /** Pre-existing commission (edit mode). */
  defaultCommission?: SaleCommissionDraft | null;
}

const SaleForm = ({ dealerId, onSubmit, isLoading, defaultValues: dv, submitLabel, priceLocked, defaultCommission }: SaleFormProps) => {
  const { user, isDealerAdmin } = useAuth();
  const [commission, setCommission] = useState<SaleCommissionDraft | null>(defaultCommission ?? null);
  const [itemSearches, setItemSearches] = useState<Record<number, string>>({});
  const [backorderDialogOpen, setBackorderDialogOpen] = useState(false);
  const [shortageItems, setShortageItems] = useState<StockShortageItem[]>([]);
  const [pendingValues, setPendingValues] = useState<SaleFormValues | null>(null);
  const [mixedBatchDialogOpen, setMixedBatchDialogOpen] = useState(false);
  const [mixedBatchInfo, setMixedBatchInfo] = useState<{
    has_mixed_shade: boolean;
    has_mixed_caliber: boolean;
    item_allocations: Array<{
      product_name: string;
      allocation: FIFOAllocationResult;
    }>;
  } | null>(null);
  // Reservation selections: product_id → [{ reservation_id, consume_qty }]
  const [reservationSelections, setReservationSelections] = useState<
    Record<string, Array<{ reservation_id: string; consume_qty: number }>>
  >({});
  const { data: dealerInfo } = useDealerInfo();
  const reservationsEnabled = dealerInfo?.enable_reservations === true;

  // Approval workflow state
  const [approvalDialogOpen, setApprovalDialogOpen] = useState(false);
  const [approvalType, setApprovalType] = useState<ApprovalType>("backorder_sale");
  const [approvalContext, setApprovalContext] = useState<ApprovalContextData>({});
  const [approvalPendingFlags, setApprovalPendingFlags] = useState<Record<string, any>>({});

  // Fetch approval settings
  const { data: approvalSettings } = useQuery({
    queryKey: ["approval-settings", dealerId],
    queryFn: () => getApprovalSettings(dealerId),
    enabled: !!dealerId,
  });

  const form = useForm<SaleFormValues>({
    resolver: zodResolver(saleSchema),
    defaultValues: {
      customer_name: dv?.customer_name ?? "",
      sale_date: dv?.sale_date ?? new Date().toISOString().split("T")[0],
      sale_type: dv?.sale_type ?? "direct_invoice",
      discount: dv?.discount ?? 0,
      discount_reference: dv?.discount_reference ?? "",
      client_reference: dv?.client_reference ?? "",
      fitter_reference: dv?.fitter_reference ?? "",
      paid_amount: dv?.paid_amount ?? 0,
      notes: dv?.notes ?? "",
      project_id: dv?.project_id ?? null,
      site_id: dv?.site_id ?? null,
      items: dv?.items?.length ? dv.items : [{ product_id: "", quantity: 0, box_qty: 0, piece_qty: 0, sale_rate: 0 }],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "items",
  });

  // Phase 3U-30b: VPS GET /api/products?f.active=true (active products only).
  const { data: products = [] } = useQuery<
    Array<{ id: string; name: string; sku: string; unit_type: string; per_box_sft: number | null; pieces_per_box: number | null; default_sale_rate: number | null; stock_base_unit?: string | null; sqft_per_piece?: number | null }>
  >({
    queryKey: ["products-active", dealerId],
    queryFn: async () => {
      const params = new URLSearchParams({
        dealerId,
        pageSize: "10000",
        "f.active": "true",
      });
      const res = await vpsAuthedFetch(`/api/products?${params.toString()}`);
      const body = await res.json().catch(() => ({} as any));
      const rows = (body as any)?.rows ?? [];
      return rows.map((p: any) => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        unit_type: p.unit_type,
        per_box_sft: p.per_box_sft ?? null,
        pieces_per_box: p.pieces_per_box ?? null,
        default_sale_rate: p.default_sale_rate ?? null,
        stock_base_unit: p.stock_base_unit ?? null,
        sqft_per_piece: p.sqft_per_piece ?? null,
      }));
    },
    enabled: !!dealerId,
  });

  // Phase 3U-30b: backorder flag now sourced from useDealerInfo() (above).
  const backorderEnabled = dealerInfo?.allow_backorder === true;

  // Fetch full stock data for shortage checks (includes reserved columns)
  // Phase 3U-30b: VPS GET /api/stock (paginated, includes reserved columns).
  const { data: fullStockData = [] } = useQuery<
    Array<{
      product_id: string;
      average_cost_per_unit: number | null;
      box_qty: number | null;
      piece_qty: number | null;
      reserved_box_qty: number | null;
      reserved_piece_qty: number | null;
    }>
  >({
    queryKey: ["stock-full-for-sale", dealerId],
    queryFn: async () => {
      const params = new URLSearchParams({ dealerId, pageSize: "10000" });
      const res = await vpsAuthedFetch(`/api/stock?${params.toString()}`);
      const body = await res.json().catch(() => ({} as any));
      const rows = (body as any)?.rows ?? [];
      return rows.map((s: any) => ({
        product_id: s.product_id,
        average_cost_per_unit: s.average_cost_per_unit ?? 0,
        box_qty: s.box_qty ?? 0,
        piece_qty: s.piece_qty ?? 0,
        reserved_box_qty: s.reserved_box_qty ?? 0,
        reserved_piece_qty: s.reserved_piece_qty ?? 0,
      }));
    },
    enabled: !!dealerId,
  });

  const fullStockMap = new Map(fullStockData.map((s) => [s.product_id, s]));

  // Fetch customers for overdue check + tier resolution
  // Phase 3U-30b: VPS GET /api/customers?f.status=active.
  const { data: allCustomers = [] } = useQuery<
    Array<{ id: string; name: string; credit_limit: number; max_overdue_days: number; price_tier_id: string | null }>
  >({
    queryKey: ["customers-for-sale-overdue", dealerId],
    queryFn: async () => {
      const params = new URLSearchParams({
        dealerId,
        pageSize: "10000",
        "f.status": "active",
      });
      const res = await vpsAuthedFetch(`/api/customers?${params.toString()}`);
      const body = await res.json().catch(() => ({} as any));
      const rows = (body as any)?.rows ?? [];
      return rows.map((c: any) => ({
        id: c.id,
        name: c.name,
        credit_limit: Number(c.credit_limit ?? 0),
        max_overdue_days: Number(c.max_overdue_days ?? 0),
        price_tier_id: c.price_tier_id ?? null,
      }));
    },
    enabled: !!dealerId,
  });

  const watchCustomerName = form.watch("customer_name");
  const matchedCustomer = allCustomers.find(
    (c) => c.name.toLowerCase() === (watchCustomerName ?? "").toLowerCase().trim()
  );
  const customerTierId = matchedCustomer?.price_tier_id ?? null;

  const { data: overdueInfo } = useQuery({
    queryKey: ["sale-overdue-check", matchedCustomer?.id],
    queryFn: async () => {
      if (!matchedCustomer) return null;
      const res = await vpsAuthedFetch(
        `/api/reports/sale-overdue-check?dealerId=${dealerId}&customerId=${matchedCustomer.id}`,
      );
      if (!res.ok) return null;
      const body = await res.json();
      return body as {
        outstanding: number;
        daysOverdue: number;
        maxOverdueDays: number;
        creditLimit: number;
        isOverdueViolated: boolean;
        isCreditExceeded: boolean;
      };
    },
    enabled: !!matchedCustomer,
  });

  // Fetch active reservations for matched customer (all products).
  // Phase 3U-30b: VPS GET /api/reservations?customer_id=&status=active.
  const { data: customerReservations = [] } = useQuery<Reservation[]>({
    queryKey: ["sale-customer-reservations", matchedCustomer?.id, dealerId],
    queryFn: async () => {
      if (!matchedCustomer) return [];
      try {
        return await listReservations(dealerId, {
          status: "active",
          customer_id: matchedCustomer.id,
        });
      } catch {
        return [];
      }
    },
    enabled: !!matchedCustomer && reservationsEnabled,
  });

  // Group reservations by product_id for easy lookup
  const reservationsByProduct = new Map<string, typeof customerReservations>();
  for (const r of customerReservations) {
    const existing = reservationsByProduct.get(r.product_id) ?? [];
    existing.push(r);
    reservationsByProduct.set(r.product_id, existing);
  }

  const stockMap = new Map(fullStockData.map((s) => [s.product_id, Number(s.average_cost_per_unit)]));

  const getFilteredProducts = (idx: number) => {
    const q = (itemSearches[idx] ?? "").toLowerCase().trim();
    if (!q) return products;
    return products.filter(
      (p) => p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)
    );
  };

  const watchItems = form.watch("items");
  const watchDiscount = form.watch("discount") || 0;
  const watchPaid = form.watch("paid_amount") || 0;

  const getProduct = (pid: string) => products.find((p) => p.id === pid);

  const calcItemTotal = (idx: number) => {
    const item = watchItems[idx];
    if (!item) return 0;
    const product = getProduct(item.product_id);
    if (product?.unit_type === "box_sft" && product.per_box_sft) {
      return (item.quantity || 0) * product.per_box_sft * (item.sale_rate || 0);
    }
    return (item.quantity || 0) * (item.sale_rate || 0);
  };

  const calcItemSft = (idx: number) => {
    const item = watchItems[idx];
    if (!item) return null;
    const product = getProduct(item.product_id);
    if (product?.unit_type === "box_sft" && product.per_box_sft) {
      return (item.quantity || 0) * product.per_box_sft;
    }
    return null;
  };

  // Get available FREE stock for a product (total - reserved)
  const getAvailableStock = (productId: string): number => {
    const stock = fullStockMap.get(productId);
    if (!stock) return 0;
    const product = getProduct(productId);
    if (product?.unit_type === "box_sft") {
      return Number(stock.box_qty ?? 0) - Number((stock as any).reserved_box_qty ?? 0);
    }
    return Number(stock.piece_qty ?? 0) - Number((stock as any).reserved_piece_qty ?? 0);
  };

  // Check if any item has shortage
  const getItemShortage = (idx: number): number => {
    const item = watchItems[idx];
    if (!item?.product_id || !item.quantity) return 0;
    const available = getAvailableStock(item.product_id);
    return Math.max(0, item.quantity - available);
  };

  const subtotal = watchItems.reduce((s, _, idx) => s + calcItemTotal(idx), 0);
  const totalAmount = subtotal - watchDiscount;
  const dueAmount = Math.max(0, totalAmount - watchPaid);

  const estimatedCogs = watchItems.reduce((acc, item) => {
    if (!item.product_id || !item.quantity) return acc;
    const avgCost = stockMap.get(item.product_id) ?? 0;
    return acc + Number(item.quantity) * avgCost;
  }, 0);
  const estimatedGrossProfit = totalAmount - estimatedCogs;

  const summaryTotals = watchItems.reduce(
    (acc, item) => {
      const product = getProduct(item.product_id);
      if (product?.unit_type === "box_sft") {
        acc.box += item.quantity || 0;
        acc.sft += (item.quantity || 0) * (product.per_box_sft ?? 0);
      } else if (product) {
        acc.piece += item.quantity || 0;
      }
      return acc;
    },
    { box: 0, sft: 0, piece: 0 }
  );

  const handleProductSelect = async (idx: number, productId: string) => {
    form.setValue(`items.${idx}.product_id`, productId);
    const product = getProduct(productId);
    if (!product) return;
    // Resolve rate from tier (falls back to default)
    try {
      const resolved = await pricingTierService.resolvePrice(dealerId, productId, customerTierId);
      form.setValue(`items.${idx}.sale_rate`, resolved.rate);
      form.setValue(`items.${idx}.rate_source`, resolved.source);
      form.setValue(`items.${idx}.tier_id`, resolved.tier_id);
      form.setValue(`items.${idx}.original_resolved_rate`, resolved.rate);
    } catch {
      form.setValue(`items.${idx}.sale_rate`, product.default_sale_rate);
      form.setValue(`items.${idx}.rate_source`, "default");
      form.setValue(`items.${idx}.tier_id`, null);
      form.setValue(`items.${idx}.original_resolved_rate`, product.default_sale_rate);
    }
  };

  // Re-price default/tier lines when customer changes; preserve manual rates
  useEffect(() => {
    if (!matchedCustomer) return;
    void (async () => {
      const current = form.getValues("items");
      const productIds = current.map((it) => it.product_id).filter((id): id is string => !!id);
      if (productIds.length === 0) return;
      const resolved = await pricingTierService.resolvePricesBatch(dealerId, productIds, customerTierId);
      let changedCount = 0;
      let keptManual = 0;
      current.forEach((it, idx) => {
        if (!it.product_id) return;
        if (it.rate_source === "manual") { keptManual += 1; return; }
        const r = resolved.get(it.product_id);
        if (!r) return;
        if (Number(it.sale_rate) === r.rate && it.rate_source === r.source) return;
        form.setValue(`items.${idx}.sale_rate`, r.rate);
        form.setValue(`items.${idx}.rate_source`, r.source);
        form.setValue(`items.${idx}.tier_id`, r.tier_id);
        form.setValue(`items.${idx}.original_resolved_rate`, r.rate);
        changedCount += 1;
      });
      if (changedCount > 0 || keptManual > 0) {
        const parts: string[] = [];
        if (changedCount > 0) parts.push(`Refreshed ${changedCount} line${changedCount === 1 ? "" : "s"}`);
        if (keptManual > 0) parts.push(`kept ${keptManual} manual-rate line${keptManual === 1 ? "" : "s"} unchanged`);
        toast.message(parts.join(", "));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchedCustomer?.id, customerTierId]);

  // Helper: build approval context for the current sale
  const buildApprovalContext = (
    values: SaleFormValues,
    extra?: Partial<ApprovalContextData>
  ): ApprovalContextData => ({
    customer_id: matchedCustomer?.id,
    customer_name: values.customer_name,
    items: values.items
      .filter((i) => i.product_id && i.quantity)
      .map((i) => ({
        product_id: i.product_id!,
        product_name: getProduct(i.product_id!)?.name,
        quantity: i.quantity!,
        sale_rate: i.sale_rate,
      })),
    ...extra,
  });

  // Helper: request or auto-approve
  const requestOrAutoApprove = async (
    type: ApprovalType,
    context: ApprovalContextData,
    reason?: string
  ): Promise<boolean> => {
    // Check if there's already a valid approved request — server consumes on POST.
    const existing = await findValidApproval(dealerId, type, context);
    if (existing) {
      return true;
    }

    // Auto-approve for admins
    if (isDealerAdmin && approvalSettings?.auto_approve_for_admins) {
      await createApprovalRequest({
        dealerId,
        approvalType: type,
        sourceType: "sale_draft",
        requestedBy: user!.id,
        reason,
        context,
        isAdmin: true,
        autoApproveForAdmins: true,
        expiryHours: approvalSettings?.approval_expiry_hours,
      });
      return true;
    }

    // Salesman needs to request
    return false;
  };

  const handleFormSubmit = async (values: SaleFormValues) => {
    // ── Pre-checks: credit / overdue / discount overrides ───────────────
    if (approvalSettings) {
      const subtotalLocal = values.items.reduce((s, item) => {
        if (!item.product_id || !item.quantity) return s;
        const p = getProduct(item.product_id);
        if (p?.unit_type === "box_sft" && p.per_box_sft) {
          return s + (item.quantity || 0) * p.per_box_sft * (item.sale_rate || 0);
        }
        return s + (item.quantity || 0) * (item.sale_rate || 0);
      }, 0);
      const totalLocal = subtotalLocal - (values.discount || 0);
      const discountPct = subtotalLocal > 0 ? ((values.discount || 0) / subtotalLocal) * 100 : 0;

      // Discount override
      if (isApprovalRequired(approvalSettings, "discount_override", { discount_pct: discountPct })) {
        // Find biggest manual override line (if any) to enrich approval context
        let manualLine: typeof values.items[number] | null = null;
        let maxVariance = 0;
        for (const it of values.items) {
          if (it.rate_source !== "manual" || it.original_resolved_rate == null || !it.product_id) continue;
          const variance = Math.abs(Number(it.sale_rate) - Number(it.original_resolved_rate)) * Number(it.quantity || 0);
          if (variance > maxVariance) { maxVariance = variance; manualLine = it; }
        }
        const tierName = customerTierId
          ? (await pricingTierService.getTier(customerTierId).catch(() => null))?.name ?? null
          : null;
        const overrideExtras: Partial<ApprovalContextData> = manualLine
          ? {
              original_resolved_rate: Number(manualLine.original_resolved_rate),
              final_rate: Number(manualLine.sale_rate),
              rate_source_before: manualLine.tier_id ? "tier" : "default",
              tier_name: tierName,
              variance_amount: Number(manualLine.sale_rate) - Number(manualLine.original_resolved_rate),
              variance_pct: Number(manualLine.original_resolved_rate) > 0
                ? Math.round(((Number(manualLine.sale_rate) - Number(manualLine.original_resolved_rate)) / Number(manualLine.original_resolved_rate)) * 10000) / 100
                : 0,
              override_product_id: manualLine.product_id,
              override_product_name: getProduct(manualLine.product_id)?.name,
            }
          : {};
        const ctx = buildApprovalContext(values, {
          discount_pct: Math.round(discountPct * 100) / 100,
          discount_amount: values.discount,
          sale_total: totalLocal,
          ...overrideExtras,
        });
        const ok = await requestOrAutoApprove("discount_override", ctx);
        if (!ok) {
          setApprovalType("discount_override");
          setApprovalContext(ctx);
          setApprovalPendingFlags({});
          setPendingValues(values);
          setApprovalDialogOpen(true);
          return;
        }
      }

      // Credit limit override
      if (
        overdueInfo?.isCreditExceeded &&
        isApprovalRequired(approvalSettings, "credit_override")
      ) {
        const ctx = buildApprovalContext(values, {
          outstanding: overdueInfo.outstanding,
          credit_limit: overdueInfo.creditLimit,
          sale_total: totalLocal,
        });
        const ok = await requestOrAutoApprove("credit_override", ctx);
        if (!ok) {
          setApprovalType("credit_override");
          setApprovalContext(ctx);
          setApprovalPendingFlags({});
          setPendingValues(values);
          setApprovalDialogOpen(true);
          return;
        }
      }

      // Overdue override
      if (
        overdueInfo?.isOverdueViolated &&
        isApprovalRequired(approvalSettings, "overdue_override")
      ) {
        const ctx = buildApprovalContext(values, {
          overdue_days: overdueInfo.daysOverdue,
          outstanding: overdueInfo.outstanding,
          sale_total: totalLocal,
        });
        const ok = await requestOrAutoApprove("overdue_override", ctx);
        if (!ok) {
          setApprovalType("overdue_override");
          setApprovalContext(ctx);
          setApprovalPendingFlags({});
          setPendingValues(values);
          setApprovalDialogOpen(true);
          return;
        }
      }
    }

    // Check for stock shortages
    const shortages: StockShortageItem[] = [];
    for (const item of values.items) {
      if (!item.product_id || !item.quantity) continue;
      const product = getProduct(item.product_id);
      const available = getAvailableStock(item.product_id);
      const shortage = Math.max(0, item.quantity - available);
      if (shortage > 0) {
        shortages.push({
          product_name: product?.name ?? "Unknown",
          unit_label: product?.unit_type === "box_sft" ? "box" : "pc",
          requested: item.quantity,
          available,
          shortage,
        });
      }
    }

    if (shortages.length > 0) {
      if (!backorderEnabled) {
        const msg = shortages.map(s =>
          `${s.product_name}: Available ${s.available} ${s.unit_label}, Requested ${s.requested} ${s.unit_label}`
        ).join("\n");
        throw new Error(`Insufficient stock:\n${msg}\n\nEnable "Allow Sale Below Stock" in dealer settings to create backorder sales.`);
      }

      // Check if backorder approval is required
      if (approvalSettings && isApprovalRequired(approvalSettings, "backorder_sale")) {
        const totalShortage = shortages.reduce((s, i) => s + i.shortage, 0);
        const ctx = buildApprovalContext(values, { shortage_qty: totalShortage });
        const canProceed = await requestOrAutoApprove("backorder_sale", ctx);
        if (!canProceed) {
          // Show approval request dialog
          setApprovalType("backorder_sale");
          setApprovalContext(ctx);
          setApprovalPendingFlags({ allow_backorder: true });
          setPendingValues(values);
          setApprovalDialogOpen(true);
          return;
        }
      }

      // If no approval needed or auto-approved, show confirm dialog
      setShortageItems(shortages);
      setPendingValues(values);
      setBackorderDialogOpen(true);
      return;
    }

    // Check for mixed shade/caliber batches (tiles only)
    await checkMixedBatchAndSubmit(values);
  };

  const checkMixedBatchAndSubmit = async (values: SaleFormValues, flags?: { allow_backorder?: boolean }) => {
    try {
      const tileItems = values.items.filter(i => {
        if (!i.product_id || !i.quantity) return false;
        const p = getProduct(i.product_id);
        return p?.unit_type === "box_sft";
      });

      if (tileItems.length > 0) {
        const validItems = tileItems.map(i => ({
          product_id: i.product_id!,
          quantity: i.quantity!,
          sale_rate: i.sale_rate ?? 0,
        }));
        const preview = await previewBatchAllocation(dealerId, validItems);
        if (preview.has_mixed_shade || preview.has_mixed_caliber) {
          // Check if approval is required for mixed shade/caliber
          const needsShadeApproval = preview.has_mixed_shade && approvalSettings && isApprovalRequired(approvalSettings, "mixed_shade");
          const needsCaliberApproval = preview.has_mixed_caliber && approvalSettings && isApprovalRequired(approvalSettings, "mixed_caliber");

          if (needsShadeApproval || needsCaliberApproval) {
            const type: ApprovalType = needsShadeApproval ? "mixed_shade" : "mixed_caliber";
            const shades = preview.item_allocations
              .filter(ia => ia.allocation.has_mixed_shade)
              .flatMap(ia => ia.allocation.allocations.map(a => a.shade_code).filter(Boolean) as string[]);
            const calibers = preview.item_allocations
              .filter(ia => ia.allocation.has_mixed_caliber)
              .flatMap(ia => ia.allocation.allocations.map(a => a.caliber).filter(Boolean) as string[]);

            const ctx = buildApprovalContext(values, {
              mixed_shades: [...new Set(shades)],
              mixed_calibers: [...new Set(calibers)],
            });

            const canProceed = await requestOrAutoApprove(type, ctx);
            if (!canProceed) {
              setApprovalType(type);
              setApprovalContext(ctx);
              setApprovalPendingFlags({ ...flags, mixed_batch_acknowledged: true });
              setPendingValues(values);
              setApprovalDialogOpen(true);
              return;
            }
          }

          // Show warning dialog (non-blocking or already approved)
          setMixedBatchInfo({
            has_mixed_shade: preview.has_mixed_shade,
            has_mixed_caliber: preview.has_mixed_caliber,
            item_allocations: preview.item_allocations.filter(
              ia => ia.allocation.has_mixed_shade || ia.allocation.has_mixed_caliber
            ),
          });
          setPendingValues(values);
          setMixedBatchDialogOpen(true);
          return;
        }
      }
    } catch {
      // If batch preview fails, proceed without warning (legacy/unbatched stock)
    }

    // Include reservation selections + commission draft in submit
    const hasReservations = Object.values(reservationSelections).some(arr => arr.length > 0);
    // Phase T4b: enrich tile-SQFT items with qty_sqft + rate_unit.
    const productMap = new Map(products.map((p) => [p.id, p as any]));
    const enrichedItems = enrichItemsWithSqft(values.items as any[], productMap, { defaultRateUnit: "per_sqft" });
    await onSubmit({ ...values, items: enrichedItems, ...flags, commission, ...(hasReservations ? { reservation_selections: reservationSelections } : {}) } as any);
  };

  const handleBackorderConfirm = async () => {
    setBackorderDialogOpen(false);
    if (pendingValues) {
      await checkMixedBatchAndSubmit(pendingValues, { allow_backorder: true });
      setShortageItems([]);
    }
  };

  const handleMixedBatchConfirm = async () => {
    setMixedBatchDialogOpen(false);
    if (pendingValues) {
      const hasReservations = Object.values(reservationSelections).some(arr => arr.length > 0);
      const productMap = new Map(products.map((p) => [p.id, p as any]));
      const enrichedItems = enrichItemsWithSqft(pendingValues.items as any[], productMap, { defaultRateUnit: "per_sqft" });
      await onSubmit({ ...pendingValues, items: enrichedItems, mixed_batch_acknowledged: true, commission, ...(hasReservations ? { reservation_selections: reservationSelections } : {}) } as any);
      setPendingValues(null);
      setMixedBatchInfo(null);
    }
  };

  const handleApprovalRequest = async (reason: string) => {
    try {
      await createApprovalRequest({
        dealerId,
        approvalType: approvalType,
        sourceType: "sale_draft",
        requestedBy: user!.id,
        reason,
        context: approvalContext,
        isAdmin: false,
        expiryHours: approvalSettings?.approval_expiry_hours,
      });
      toast.success("Approval request submitted. Please wait for manager approval before proceeding.");
      setApprovalDialogOpen(false);
      setPendingValues(null);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleFormSubmit)} className="space-y-5 pb-28">
          {/* Backorder Mode Badge */}
          {backorderEnabled && (
            <div className="rounded-md border border-blue-300 bg-blue-50 dark:bg-blue-950/20 px-4 py-2 text-xs text-blue-800 dark:text-blue-200 flex items-center gap-2">
              <PackageX className="h-4 w-4" />
              <span><strong>Backorder Mode Active</strong> — Sales can be created even when stock is insufficient. Shortages will be tracked automatically.</span>
            </div>
          )}

          {/* Sale Info Card */}
          <Card>
            <CardContent className="pt-5 space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <FormField
                  control={form.control}
                  name="client_reference"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Reference No</FormLabel>
                      <FormControl><Input placeholder="Auto or manual" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="sale_date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Sale Date *</FormLabel>
                      <FormControl><Input type="date" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="sale_type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Sale Type</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="direct_invoice">Direct Invoice</SelectItem>
                          <SelectItem value="challan_mode">Challan Mode</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          {/* Customer & References */}
          <Card>
            <CardContent className="pt-5 space-y-4">
              <div className="rounded-md border border-yellow-300 bg-yellow-50 px-4 py-2 text-xs text-yellow-800">
                Please select customer before adding any product
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="customer_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Customer *</FormLabel>
                      <FormControl><Input placeholder="Type customer name" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="customer_type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Customer Type</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="retailer">Retailer</SelectItem>
                          <SelectItem value="customer">Customer</SelectItem>
                          <SelectItem value="project">Project</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="fitter_reference"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Fitter Reference</FormLabel>
                      <FormControl><Input placeholder="Fitter ID" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Project / Site (optional) */}
              <div className="rounded-md border bg-muted/30 px-4 py-3 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Project / Site (optional)
                </p>
                <FormField
                  control={form.control}
                  name="project_id"
                  render={({ field: projectField }) => (
                    <FormField
                      control={form.control}
                      name="site_id"
                      render={({ field: siteField }) => (
                        <ProjectSitePicker
                          dealerId={dealerId}
                          customerId={matchedCustomer?.id ?? null}
                          projectId={projectField.value ?? null}
                          siteId={siteField.value ?? null}
                          onChange={({ projectId, siteId }) => {
                            projectField.onChange(projectId);
                            siteField.onChange(siteId);
                          }}
                        />
                      )}
                    />
                  )}
                />
                {!matchedCustomer && (
                  <p className="text-[11px] text-muted-foreground">
                    Pick or create a customer above first to attach a project / site.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Overdue / Credit Warning */}
          {overdueInfo && (overdueInfo.isOverdueViolated || overdueInfo.isCreditExceeded) && (
            <div className="rounded-md border border-destructive/50 bg-destructive/5 px-4 py-3 space-y-1">
              <div className="flex items-center gap-2 text-sm font-semibold text-destructive">
                <AlertTriangle className="h-4 w-4" />
                Credit / Overdue Warning
              </div>
              {overdueInfo.isOverdueViolated && (
                <p className="text-xs text-destructive">
                  ⚠ This customer is <strong>{overdueInfo.daysOverdue} days</strong> overdue (max: {overdueInfo.maxOverdueDays} days).
                </p>
              )}
              {overdueInfo.isCreditExceeded && (
                <p className="text-xs text-destructive">
                  ⚠ Outstanding <strong>৳{overdueInfo.outstanding.toLocaleString()}</strong> exceeds credit limit of ৳{overdueInfo.creditLimit.toLocaleString()}.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Owner approval may be required. Proceed with caution.
              </p>
            </div>
          )}
          {overdueInfo && !overdueInfo.isOverdueViolated && !overdueInfo.isCreditExceeded && overdueInfo.outstanding > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 px-4 py-2 text-xs text-amber-800 dark:text-amber-200">
              ℹ Current outstanding: <strong>৳{overdueInfo.outstanding.toLocaleString()}</strong>
              {overdueInfo.daysOverdue > 0 && <> · {overdueInfo.daysOverdue} days since oldest due</>}
            </div>
          )}

          {/* Product Search Bar */}
          <Card>
            <CardContent className="pt-5">
              <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-3">
                <Barcode className="h-5 w-5 text-muted-foreground shrink-0" />
                <span className="text-sm text-muted-foreground">Please add products to order list</span>
              </div>
            </CardContent>
          </Card>

          {/* Payment Lock Warning */}
          {priceLocked && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-2 text-xs text-destructive font-medium">
              🔒 Price editing is locked because a payment has been recorded against this sale. Only notes and non-financial fields can be changed.
            </div>
          )}

          {/* Order Items */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Order Items *</h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => append({ product_id: "", quantity: 0, box_qty: 0, piece_qty: 0, sale_rate: 0 })}
                disabled={priceLocked}
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> Add Item
              </Button>
            </div>

            {/* Table header */}
            <div className="hidden md:grid md:grid-cols-12 gap-2 rounded-t-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground">
              <div className="col-span-5">Product (Code - Name)</div>
              <div className="col-span-2 text-center">Quantity</div>
              <div className="col-span-2 text-right">Unit Price</div>
              <div className="col-span-2 text-right">Subtotal ({CURRENCY_CODE})</div>
              <div className="col-span-1 text-center">⋯</div>
            </div>

            {fields.map((field, idx) => {
              const selectedProduct = getProduct(watchItems[idx]?.product_id);
              const itemSft = calcItemSft(idx);
              const itemTotal = calcItemTotal(idx);
              const filtered = getFilteredProducts(idx);
              const searchVal = itemSearches[idx] ?? "";
              const shortage = getItemShortage(idx);
              const availableStock = watchItems[idx]?.product_id ? getAvailableStock(watchItems[idx].product_id) : 0;

              return (
                <div key={field.id}>
                  <div
                    className={`grid grid-cols-1 gap-2 rounded-md border bg-background p-3 md:grid-cols-12 md:items-center md:gap-2 md:p-2 ${shortage > 0 ? "border-amber-400 dark:border-amber-600" : ""}`}
                  >
                    {/* Product */}
                    <div className="col-span-5 relative">
                      <FormField
                        control={form.control}
                        name={`items.${idx}.product_id`}
                        render={() => (
                          <FormItem className="space-y-0">
                            {selectedProduct ? (
                              <div className="flex items-center gap-1.5">
                                <div className="flex-1 rounded border px-2 py-1.5 text-sm bg-muted/30">
                                  <span className="font-mono text-xs text-muted-foreground">{selectedProduct.sku}</span>
                                  {" — "}
                                  <span>{selectedProduct.name}</span>
                                </div>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 shrink-0"
                                  onClick={() => {
                                    form.setValue(`items.${idx}.product_id`, "");
                                    form.setValue(`items.${idx}.sale_rate`, 0);
                                    setItemSearches((s) => ({ ...s, [idx]: "" }));
                                  }}
                                >
                                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                </Button>
                              </div>
                            ) : (
                              <div className="relative">
                                <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                  placeholder="Search SKU or name…"
                                  value={searchVal}
                                  onChange={(e) =>
                                    setItemSearches((s) => ({ ...s, [idx]: e.target.value }))
                                  }
                                  className="pl-7 h-8 text-sm"
                                  autoComplete="off"
                                />
                                {searchVal.length > 0 && filtered.length > 0 && (
                                  <div className="absolute z-50 mt-1 max-h-48 w-full overflow-auto rounded-md border bg-popover shadow-md">
                                    {filtered.map((p) => (
                                      <button
                                        key={p.id}
                                        type="button"
                                        className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent text-left"
                                        onClick={() => {
                                          handleProductSelect(idx, p.id);
                                          setItemSearches((s) => ({ ...s, [idx]: "" }));
                                        }}
                                      >
                                        <span className="font-mono text-xs text-muted-foreground">{p.sku}</span>
                                        <span className="truncate">{p.name}</span>
                                      </button>
                                    ))}
                                  </div>
                                )}
                                {searchVal.length > 0 && filtered.length === 0 && (
                                  <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover p-3 text-sm text-muted-foreground shadow-md">
                                    No products found
                                  </div>
                                )}
                              </div>
                            )}
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    {/* Quantity (Box + Pc for tiles, Pc only for sanitary) */}
                    <div className="col-span-2">
                      {(() => {
                        const ppb = Number(selectedProduct?.pieces_per_box ?? 0);
                        const isTile = selectedProduct?.unit_type === "box_sft";
                        const showDual = isTile && ppb > 0;
                        const item = watchItems[idx];
                        // Derive displayed box/pc: prefer explicit fields; else split from quantity.
                        const qty = Number(item?.quantity ?? 0);
                        const explicitBox = item?.box_qty;
                        const explicitPc = item?.piece_qty;
                        const dispBox = explicitBox != null && explicitBox !== undefined
                          ? Number(explicitBox)
                          : (showDual ? Math.floor(qty) : 0);
                        const dispPc = explicitPc != null && explicitPc !== undefined
                          ? Number(explicitPc)
                          : (showDual ? Math.round((qty - Math.floor(qty)) * ppb) : (isTile ? 0 : qty));

                        const syncQuantity = (boxV: number, pcV: number) => {
                          const safeBox = Number.isFinite(boxV) ? Math.max(0, boxV) : 0;
                          const safePc = Number.isFinite(pcV) ? Math.max(0, pcV) : 0;
                          form.setValue(`items.${idx}.box_qty`, safeBox, { shouldDirty: true });
                          form.setValue(`items.${idx}.piece_qty`, safePc, { shouldDirty: true });
                          if (showDual) {
                            form.setValue(`items.${idx}.quantity`, safeBox + safePc / ppb, { shouldDirty: true, shouldValidate: true });
                          } else if (isTile) {
                            // Tile without ppb: legacy box-only
                            form.setValue(`items.${idx}.quantity`, safeBox, { shouldDirty: true, shouldValidate: true });
                          } else {
                            // Sanitary: pc-only
                            form.setValue(`items.${idx}.quantity`, safePc, { shouldDirty: true, shouldValidate: true });
                          }
                        };

                        if (showDual) {
                          return (
                            <FormItem className="space-y-0">
                              <div className="flex gap-1">
                                <Input
                                  type="number"
                                  step="1"
                                  min="0"
                                  placeholder="Box"
                                  className="h-8 text-sm text-center px-1"
                                  disabled={priceLocked}
                                  value={dispBox || ""}
                                  onChange={(e) => syncQuantity(Math.floor(Number(e.target.value) || 0), dispPc)}
                                />
                                <Input
                                  type="number"
                                  step="1"
                                  min="0"
                                  placeholder="Pc"
                                  className="h-8 text-sm text-center px-1"
                                  disabled={priceLocked}
                                  value={dispPc || ""}
                                  onChange={(e) => syncQuantity(dispBox, Math.floor(Number(e.target.value) || 0))}
                                />
                              </div>
                              {itemSft !== null && (
                                <p className="text-[10px] text-muted-foreground text-center mt-0.5">
                                  {itemSft.toFixed(2)} Sft · {dispBox} box {dispPc} pc
                                </p>
                              )}
                              <FormMessage />
                            </FormItem>
                          );
                        }

                        // Sanitary (pc-only) or tile without ppb fallback to single input
                        return (
                          <FormField
                            control={form.control}
                            name={`items.${idx}.quantity`}
                            render={({ field: f }) => (
                              <FormItem className="space-y-0">
                                <FormControl>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    placeholder={isTile ? "Box qty" : "Qty"}
                                    className="h-8 text-sm text-center"
                                    disabled={priceLocked}
                                    {...f}
                                    onChange={(e) => {
                                      const v = Number(e.target.value) || 0;
                                      f.onChange(e);
                                      if (isTile) {
                                        form.setValue(`items.${idx}.box_qty`, v);
                                        form.setValue(`items.${idx}.piece_qty`, 0);
                                      } else {
                                        form.setValue(`items.${idx}.box_qty`, 0);
                                        form.setValue(`items.${idx}.piece_qty`, v);
                                      }
                                    }}
                                    onBlur={(e) => {
                                      if (isTile) {
                                        const v = Number(e.target.value);
                                        if (Number.isFinite(v) && v > 0 && v !== Math.ceil(v)) {
                                          f.onChange(Math.ceil(v));
                                          form.setValue(`items.${idx}.box_qty`, Math.ceil(v));
                                        }
                                      }
                                      f.onBlur();
                                    }}
                                  />
                                </FormControl>
                                {itemSft !== null && (
                                  <p className="text-[10px] text-muted-foreground text-center mt-0.5">
                                    {itemSft.toFixed(2)} Sft
                                  </p>
                                )}
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        );
                      })()}
                    </div>

                    {/* Unit Price */}
                    <div className="col-span-2">
                      <FormField
                        control={form.control}
                        name={`items.${idx}.sale_rate`}
                        render={({ field: f }) => {
                          const item = watchItems[idx];
                          const orig = item?.original_resolved_rate;
                          const isManual = item?.rate_source === "manual";
                          const tier = (allCustomers.find((c) => c.id === matchedCustomer?.id) as { price_tier_id?: string | null } | undefined)?.price_tier_id;
                          return (
                            <FormItem className="space-y-0">
                              <FormControl>
                                <Input
                                  type="number"
                                  step="0.01"
                                  placeholder="Rate"
                                  className={`h-8 text-sm text-right ${isManual ? "border-warning/50 bg-warning/5" : ""}`}
                                  disabled={priceLocked}
                                  {...f}
                                  onChange={(e) => {
                                    f.onChange(e);
                                    const newVal = Number(e.target.value);
                                    const baseline = orig ?? Number(item?.sale_rate ?? 0);
                                    if (orig == null) {
                                      form.setValue(`items.${idx}.original_resolved_rate`, baseline);
                                    }
                                    if (newVal !== baseline) {
                                      form.setValue(`items.${idx}.rate_source`, "manual");
                                    }
                                  }}
                                />
                              </FormControl>
                              {item?.product_id && (
                                <div className="flex items-center justify-end gap-1 mt-0.5">
                                  <RateSourceBadge source={item?.rate_source} className="text-[9px] px-1 py-0 h-4" />
                                  {isManual && orig != null && Number(orig) !== Number(item?.sale_rate) && (
                                    <span className="text-[9px] text-muted-foreground" title="Original resolved rate">
                                      was {formatCurrency(Number(orig))}
                                    </span>
                                  )}
                                </div>
                              )}
                              <FormMessage />
                            </FormItem>
                          );
                        }}
                      />
                    </div>

                    {/* Subtotal */}
                    <div className="col-span-2 text-right text-sm font-semibold text-foreground py-1">
                      {formatCurrency(itemTotal)}
                    </div>

                    {/* Remove */}
                    <div className="col-span-1 flex justify-center">
                      {fields.length > 1 && !priceLocked && (
                        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => remove(idx)}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Stock shortage inline warning */}
                  {shortage > 0 && selectedProduct && (
                    <div className="mt-1 ml-2 flex items-center gap-2 text-[11px]">
                      <PackageX className="h-3.5 w-3.5 text-amber-600" />
                      <span className="text-amber-700 dark:text-amber-400">
                        Stock: <strong>{availableStock} {selectedProduct.unit_type === "box_sft" ? "box" : "pc"}</strong>
                        {" · "}Short: <strong className="text-destructive">{shortage} {selectedProduct.unit_type === "box_sft" ? "box" : "pc"}</strong>
                        {backorderEnabled && (
                          <Badge variant="outline" className="ml-2 text-[10px] px-1.5 py-0 border-amber-400 text-amber-700 dark:text-amber-400">
                            Backorder
                          </Badge>
                        )}
                      </span>
                    </div>
                  )}

                  {/* Reservation picker — show when customer has active holds for this product */}
                  {reservationsEnabled && selectedProduct && watchItems[idx]?.product_id && (() => {
                    const productReservations = reservationsByProduct.get(watchItems[idx].product_id) ?? [];
                    if (productReservations.length === 0) return null;
                    const selectedForProduct = reservationSelections[watchItems[idx].product_id] ?? [];
                    const selectedIds = new Set(selectedForProduct.map(s => s.reservation_id));

                    return (
                      <div className="mt-2 ml-2 rounded-md border border-primary/20 bg-primary/5 p-2.5">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <Lock className="h-3.5 w-3.5 text-primary" />
                          <span className="text-xs font-semibold text-foreground">
                            Active Reservations for {matchedCustomer?.name}
                          </span>
                        </div>
                        <div className="space-y-1">
                          {productReservations.map((res: any) => {
                            const remaining = Number(res.reserved_qty) - Number(res.fulfilled_qty) - Number(res.released_qty);
                            if (remaining <= 0) return null;
                            const isSelected = selectedIds.has(res.id);
                            const batchInfo = res.product_batches;

                            return (
                              <label
                                key={res.id}
                                className="flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted/50 cursor-pointer"
                              >
                                <Checkbox
                                  checked={isSelected}
                                  onCheckedChange={(checked) => {
                                    const pid = watchItems[idx].product_id;
                                    setReservationSelections(prev => {
                                      const current = [...(prev[pid] ?? [])];
                                      if (checked) {
                                        current.push({ reservation_id: res.id, consume_qty: remaining });
                                      } else {
                                        const filtered = current.filter(s => s.reservation_id !== res.id);
                                        return { ...prev, [pid]: filtered };
                                      }
                                      return { ...prev, [pid]: current };
                                    });
                                  }}
                                />
                                <div className="flex-1">
                                  <span className="font-medium">{remaining} {selectedProduct.unit_type === "box_sft" ? "Box" : "Pcs"}</span>
                                  {batchInfo && (
                                    <span className="text-muted-foreground ml-1">
                                      · Batch: {batchInfo.batch_no}
                                      {batchInfo.shade_code && ` · Shade: ${batchInfo.shade_code}`}
                                      {batchInfo.caliber && ` · Cal: ${batchInfo.caliber}`}
                                    </span>
                                  )}
                                  {res.reason && <span className="text-muted-foreground ml-1">· {res.reason}</span>}
                                </div>
                                {isSelected && <CheckCircle className="h-3.5 w-3.5 text-primary" />}
                              </label>
                            );
                          })}
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          Select reservations to consume with this sale. Unselected holds stay active.
                        </p>
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>

          {/* Discount, Payment & Notes */}
          <Card>
            <CardContent className="pt-5 space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <FormField
                  control={form.control}
                  name="discount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Order Discount (৳)</FormLabel>
                      <FormControl><Input type="number" step="0.01" disabled={priceLocked} {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="discount_reference"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Discount Reference</FormLabel>
                      <FormControl><Input placeholder="Reason / approval" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="paid_amount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Paid Amount (৳)</FormLabel>
                      <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <Separator />

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sale Note</FormLabel>
                    <FormControl><Textarea placeholder="Optional notes…" rows={3} {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* Live Profit Preview — Owner only */}
          {isDealerAdmin && estimatedCogs > 0 && (
            <div className="grid grid-cols-3 gap-3 rounded-md border border-primary/20 bg-primary/5 p-4 text-sm">
              <div>
                <span className="text-muted-foreground text-xs uppercase font-semibold">Est. COGS</span>
                <p className="font-semibold text-destructive">{formatCurrency(estimatedCogs)}</p>
              </div>
              <div>
                <span className="text-muted-foreground text-xs uppercase font-semibold">Est. Gross Profit</span>
                <p className={`font-semibold ${estimatedGrossProfit >= 0 ? "text-primary" : "text-destructive"}`}>
                  {formatCurrency(estimatedGrossProfit)}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground text-xs uppercase font-semibold">Est. Margin</span>
                <p className={`font-semibold ${estimatedGrossProfit >= 0 ? "text-primary" : "text-destructive"}`}>
                  {totalAmount > 0 ? `${((estimatedGrossProfit / totalAmount) * 100).toFixed(1)}%` : "—"}
                </p>
              </div>
            </div>
          )}

          {/* Optional referral / commission */}
          <SaleCommissionSection
            dealerId={dealerId}
            baseAmount={Math.max(0, totalAmount)}
            value={commission}
            onChange={setCommission}
            disabled={priceLocked}
          />

          {/* Submit + Reset */}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={isLoading}>
              {isLoading ? "Processing…" : (submitLabel ?? (form.watch("sale_type") === "challan_mode" ? "Create Sale (Challan)" : "Submit"))}
            </Button>
            <Button type="button" variant="destructive" onClick={() => form.reset()}>
              Reset
            </Button>
          </div>

          {/* Sticky bottom summary bar */}
          <div className="fixed bottom-0 left-0 right-0 z-20 border-t bg-amber-50 dark:bg-amber-950/30 px-4 py-2">
            <div className="mx-auto max-w-4xl flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs font-medium">
              <span>Items <strong>{watchItems.filter(i => i.product_id).length}</strong></span>
              <span>Total <strong>{formatCurrency(subtotal)}</strong></span>
              <span>Discount <strong>{formatCurrency(watchDiscount)}</strong></span>
              <span>Paid <strong>{formatCurrency(watchPaid)}</strong></span>
              <span className={dueAmount > 0 ? "text-destructive font-bold" : ""}>
                Due <strong>{formatCurrency(dueAmount)}</strong>
              </span>
              <span className="font-bold text-sm">
                Grand Total <strong>{formatCurrency(totalAmount)}</strong>
              </span>
            </div>
          </div>
        </form>
      </Form>

      {/* Backorder Confirmation Dialog */}
      <AlertDialog open={backorderDialogOpen} onOpenChange={setBackorderDialogOpen}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-amber-700">
              <PackageX className="h-5 w-5" />
              Stock Shortage Detected
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  The following items have insufficient stock. They will be placed on <strong>backorder</strong> and fulfilled when new stock arrives.
                </p>
                <div className="rounded-md border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium">Product</th>
                        <th className="text-center px-3 py-2 font-medium">Ordered</th>
                        <th className="text-center px-3 py-2 font-medium">Available</th>
                        <th className="text-center px-3 py-2 font-medium text-destructive">Short</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shortageItems.map((item, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-3 py-2 text-left">{item.product_name}</td>
                          <td className="px-3 py-2 text-center">{item.requested} {item.unit_label}</td>
                          <td className="px-3 py-2 text-center">{item.available} {item.unit_label}</td>
                          <td className="px-3 py-2 text-center font-bold text-destructive">{item.shortage} {item.unit_label}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-muted-foreground">
                  💡 Short quantities will be auto-fulfilled when you receive stock through purchases.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setPendingValues(null); setShortageItems([]); }}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBackorderConfirm}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              Confirm Backorder Sale
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Mixed Shade/Caliber Warning Dialog */}
      <AlertDialog open={mixedBatchDialogOpen} onOpenChange={setMixedBatchDialogOpen}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <Layers className="h-5 w-5" />
              Mixed Shade / Caliber Warning
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  The following items will be allocated from <strong>batches with different {mixedBatchInfo?.has_mixed_shade ? "shades" : ""}{mixedBatchInfo?.has_mixed_shade && mixedBatchInfo?.has_mixed_caliber ? " and " : ""}{mixedBatchInfo?.has_mixed_caliber ? "calibers" : ""}</strong>.
                  This may cause visual inconsistency for the customer.
                </p>
                <div className="rounded-md border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium">Product</th>
                        <th className="text-left px-3 py-2 font-medium">Batch</th>
                        <th className="text-center px-3 py-2 font-medium">Shade</th>
                        <th className="text-center px-3 py-2 font-medium">Caliber</th>
                        <th className="text-center px-3 py-2 font-medium">Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mixedBatchInfo?.item_allocations.map((ia, i) =>
                        ia.allocation.allocations.map((alloc, j) => (
                          <tr key={`${i}-${j}`} className="border-t">
                            {j === 0 && (
                              <td className="px-3 py-2 text-left font-medium" rowSpan={ia.allocation.allocations.length}>
                                {ia.product_name}
                              </td>
                            )}
                            <td className="px-3 py-2 text-left font-mono text-xs">{alloc.batch_no}</td>
                            <td className="px-3 py-2 text-center">
                              {alloc.shade_code ? (
                                <Badge variant="outline" className="text-[10px]">{alloc.shade_code}</Badge>
                              ) : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="px-3 py-2 text-center">
                              {alloc.caliber ? (
                                <Badge variant="outline" className="text-[10px]">{alloc.caliber}</Badge>
                              ) : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="px-3 py-2 text-center font-semibold">{alloc.allocated_qty}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-muted-foreground">
                  ⚠ Proceeding will allocate stock from mixed batches. Consider splitting the order or waiting for matching stock.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setPendingValues(null); setMixedBatchInfo(null); }}>
              Cancel Sale
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleMixedBatchConfirm}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              Proceed with Mixed Batches
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Approval Request Dialog */}
      <ApprovalRequestDialog
        open={approvalDialogOpen}
        onClose={() => {
          setApprovalDialogOpen(false);
          setPendingValues(null);
        }}
        onRequestApproval={handleApprovalRequest}
        approvalType={approvalType}
        context={approvalContext}
        isLoading={isLoading}
      />
    </>
  );
};

export default SaleForm;
