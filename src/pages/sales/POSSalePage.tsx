import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useDealerId } from "@/hooks/useDealerId";
import { useAuth } from "@/contexts/AuthContext";
import { salesService } from "@/services/salesService";
import { bankAccountService } from "@/services/bankAccountService";
import { PayFromAccountSelect } from "@/components/PayFromAccountSelect";
import { PaymentModeSelect } from "@/components/PaymentModeSelect";
import { paymentModeRequiresBankAccount } from "@/lib/paymentModes";
import { pricingTierService, type RateSource } from "@/services/pricingTierService";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Minus, Trash2, ShoppingCart, Search } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useNavigate } from "react-router-dom";
import RateSourceBadge from "@/components/RateSourceBadge";

interface CartItem {
  product_id: string;
  name: string;
  sku: string;
  unit_type: string;
  per_box_sft: number | null;
  default_sale_rate: number;
  quantity: number;
  sale_rate: number;
  rate_source: RateSource;
  tier_id: string | null;
  original_resolved_rate?: number;
}

const POSSalePage = () => {
  const dealerId = useDealerId();
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [paymentMode, setPaymentMode] = useState("cash");
  const [paidAccountId, setPaidAccountId] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const barcodeRef = useRef<HTMLInputElement>(null);
  const paidRef = useRef<HTMLInputElement>(null);

  // Auto-focus barcode input on load
  useEffect(() => {
    setTimeout(() => barcodeRef.current?.focus(), 100);
  }, []);

  // Keyboard shortcuts
  useKeyboardShortcuts({
    F2: () => {
      setCart([]);
      setCustomerId("");
      setSearch("");
      barcodeRef.current?.focus();
    },
    F5: () => paidRef.current?.focus(),
    F12: () => handleCheckout(),
    Escape: () => navigate("/sales"),
  });

  const { data: bankAccounts = [] } = useQuery({
    queryKey: ["bank-accounts", dealerId],
    queryFn: () => bankAccountService.list(dealerId),
    enabled: !!dealerId,
  });

  const { data: products = [] } = useQuery({
    queryKey: ["pos-products", dealerId, search],
    queryFn: async () => {
      let query = supabase
        .from("products")
        .select("id, name, sku, unit_type, per_box_sft, default_sale_rate, barcode")
        .eq("dealer_id", dealerId)
        .eq("active", true)
        .order("name")
        .limit(20);
      if (search.trim()) {
        query = query.or(`name.ilike.%${search.trim()}%,sku.ilike.%${search.trim()}%,barcode.ilike.%${search.trim()}%`);
      }
      const { data } = await query;
      return data ?? [];
    },
    enabled: !!dealerId,
  });

  const { data: customers = [] } = useQuery({
    queryKey: ["pos-customers", dealerId],
    queryFn: async () => {
      const { data } = await supabase
        .from("customers")
        .select("id, name, price_tier_id")
        .eq("dealer_id", dealerId)
        .eq("status", "active")
        .order("name");
      return data ?? [];
    },
  });

  const selectedCustomer = customers.find((c) => c.id === customerId);
  const customerTierId = (selectedCustomer as { price_tier_id?: string | null } | undefined)?.price_tier_id ?? null;

  // Auto-select walk-in customer
  useEffect(() => {
    if (!customerId && customers.length > 0) {
      const walkIn = customers.find((c) => c.name.toLowerCase().includes("walk"));
      if (walkIn) setCustomerId(walkIn.id);
    }
  }, [customers, customerId]);

  // Re-price cart when customer changes; preserve manual overrides
  useEffect(() => {
    if (!dealerId) return;
    if (cart.length === 0) return;
    void (async () => {
      const productIds = cart.map((c) => c.product_id);
      const resolved = await pricingTierService.resolvePricesBatch(dealerId, productIds, customerTierId);
      let changedCount = 0;
      let keptManual = 0;
      setCart((prev) =>
        prev.map((c) => {
          if (c.rate_source === "manual") { keptManual += 1; return c; }
          const r = resolved.get(c.product_id);
          if (!r) return c;
          if (c.sale_rate === r.rate && c.rate_source === r.source) return c;
          changedCount += 1;
          return { ...c, sale_rate: r.rate, rate_source: r.source, tier_id: r.tier_id };
        })
      );
      if (changedCount > 0 || keptManual > 0) {
        const parts: string[] = [];
        if (changedCount > 0) parts.push(`Re-priced ${changedCount}`);
        if (keptManual > 0) parts.push(`${keptManual} manual kept`);
        toast({ title: parts.join(" · ") });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, customerTierId, dealerId]);

  const addToCart = useCallback(async (product: any) => {
    let resolvedRate = Number(product.default_sale_rate);
    let source: RateSource = "default";
    let tierId: string | null = null;
    try {
      const r = await pricingTierService.resolvePrice(dealerId, product.id, customerTierId);
      resolvedRate = r.rate;
      source = r.source;
      tierId = r.tier_id;
    } catch { /* fallback */ }
    setCart((prev) => {
      const existing = prev.find((c) => c.product_id === product.id);
      if (existing) {
        return prev.map((c) =>
          c.product_id === product.id ? { ...c, quantity: c.quantity + 1 } : c
        );
      }
      return [...prev, {
        product_id: product.id,
        name: product.name,
        sku: product.sku,
        unit_type: product.unit_type,
        per_box_sft: product.per_box_sft,
        default_sale_rate: Number(product.default_sale_rate),
        quantity: 1,
        sale_rate: resolvedRate,
        rate_source: source,
        tier_id: tierId,
        original_resolved_rate: resolvedRate,
      } as CartItem & { original_resolved_rate: number }];
    });
  }, [dealerId, customerTierId]);

  // Scan-to-add: on Enter in barcode field, match exact barcode/sku and add
  const handleBarcodeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && search.trim()) {
      e.preventDefault();
      const match = products.find(
        (p) => p.barcode === search.trim() || p.sku === search.trim()
      );
      if (match) {
        addToCart(match);
        setSearch("");
        barcodeRef.current?.focus();
      }
    }
  };

  const updateQty = (productId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((c) => c.product_id === productId ? { ...c, quantity: Math.max(0, c.quantity + delta) } : c)
        .filter((c) => c.quantity > 0)
    );
  };

  const removeFromCart = (productId: string) => {
    setCart((prev) => prev.filter((c) => c.product_id !== productId));
  };

  const grandTotal = cart.reduce((s, c) => {
    if (c.unit_type === "box_sft" && c.per_box_sft) {
      return s + c.quantity * c.per_box_sft * c.sale_rate;
    }
    return s + c.quantity * c.sale_rate;
  }, 0);

  const handleCheckout = async () => {
    if (!customerId) {
      toast({ title: "Please select a customer", variant: "destructive" });
      return;
    }
    if (cart.length === 0) {
      toast({ title: "Cart is empty", variant: "destructive" });
      return;
    }

    const selected = customers.find((c) => c.id === customerId);
    if (!selected) {
      toast({ title: "Please select a customer", variant: "destructive" });
      return;
    }

    if (paymentModeRequiresBankAccount(paymentMode) && !paidAccountId) {
      toast({ title: "Select a bank account for this payment mode", variant: "destructive" });
      return;
    }

    setProcessing(true);
    try {
      await salesService.create({
        dealer_id: dealerId,
        customer_name: selected.name,
        sale_date: new Date().toISOString().split("T")[0],
        sale_type: "direct_invoice",
        paid_amount: grandTotal,
        discount: 0,
        discount_reference: "",
        client_reference: "",
        fitter_reference: "",
        payment_mode: paymentMode,
        paid_account_id: paymentMode === "cash" ? null : paidAccountId ?? null,
        notes: "POS Sale",
        created_by: user?.id,
        items: cart.map((c) => ({
          product_id: c.product_id,
          quantity: c.quantity,
          sale_rate: c.sale_rate,
          rate_source: c.rate_source,
          tier_id: c.tier_id,
          original_resolved_rate: c.original_resolved_rate ?? c.sale_rate,
        })),
      });
      toast({ title: "Sale completed!" });
      setCart([]);
      setSearch("");
      barcodeRef.current?.focus();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden">
      {/* Top bar: search + customer */}
      <div className="shrink-0 border-b bg-card px-3 py-2 sm:px-4 sm:py-3 space-y-2">
        <div className="flex items-center gap-2">
          <ShoppingCart className="h-5 w-5 text-primary shrink-0 hidden sm:block" />
          <h1 className="text-base sm:text-lg font-bold text-foreground">POS</h1>
          <div className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground hidden md:flex">
            <kbd className="px-1.5 py-0.5 rounded bg-muted border text-[10px]">F2</kbd> New
            <kbd className="px-1.5 py-0.5 rounded bg-muted border text-[10px] ml-2">F5</kbd> Pay
            <kbd className="px-1.5 py-0.5 rounded bg-muted border text-[10px] ml-2">F12</kbd> Save
            <kbd className="px-1.5 py-0.5 rounded bg-muted border text-[10px] ml-2">Esc</kbd> Exit
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={barcodeRef}
              placeholder="Scan barcode or search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleBarcodeKeyDown}
              className="pl-8 h-10 text-sm"
            />
          </div>
          <Select value={customerId} onValueChange={setCustomerId}>
            <SelectTrigger className="w-full sm:w-48 h-10">
              <SelectValue placeholder="Customer" />
            </SelectTrigger>
            <SelectContent>
              {customers.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Main area: product grid + cart side-by-side on desktop, stacked on mobile */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Product grid */}
        <div className="flex-1 overflow-y-auto p-2 sm:p-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
            {products.map((p) => (
              <button
                key={p.id}
                onClick={() => addToCart(p)}
                className="flex flex-col items-start rounded-lg border bg-card p-2.5 sm:p-3 text-left hover:border-primary/50 active:scale-[0.98] transition-all min-h-[68px]"
              >
                <p className="font-medium text-xs sm:text-sm truncate w-full">{p.name}</p>
                <p className="text-[10px] sm:text-xs text-muted-foreground font-mono">{p.sku}</p>
                <p className="text-xs sm:text-sm font-semibold mt-auto text-primary">{formatCurrency(p.default_sale_rate)}</p>
              </button>
            ))}
            {products.length === 0 && (
              <p className="col-span-full text-center text-sm text-muted-foreground py-8">
                {search ? "No products found" : "Type to search products"}
              </p>
            )}
          </div>
        </div>

        {/* Cart panel - collapsible on mobile, always visible on desktop */}
        <div className="lg:w-80 xl:w-96 shrink-0 border-t lg:border-t-0 lg:border-l bg-card flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b flex items-center justify-between">
            <span className="text-sm font-semibold">Cart ({cart.length})</span>
            <div className="w-40">
              <PaymentModeSelect
                value={paymentMode}
                onChange={(v) => {
                  setPaymentMode(v);
                  if (v === "cash") setPaidAccountId(null);
                }}
                label=""
                triggerClassName="h-8 text-xs"
              />
            </div>
          </div>

          {paymentMode !== "cash" && (
            <div className="px-3 py-2 border-b">
              <PayFromAccountSelect
                value={paidAccountId}
                onChange={setPaidAccountId}
                bankAccounts={bankAccounts}
                label={paymentModeRequiresBankAccount(paymentMode) ? "Deposit To (required)" : "Settlement Account (optional)"}
                triggerClassName="h-8 text-xs"
              />
            </div>
          )}

          {/* Cart items - scrollable */}
          <div className="flex-1 overflow-y-auto">
            {cart.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-6">Add products to cart</p>
            ) : (
              <div className="divide-y">
                {cart.map((item) => (
                  <div key={item.product_id} className="flex items-center gap-2 px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-xs sm:text-sm font-medium truncate">{item.name}</p>
                        <RateSourceBadge source={item.rate_source} className="text-[9px] px-1 py-0 h-4 shrink-0" />
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        {formatCurrency(item.sale_rate)} × {item.quantity}
                        {item.unit_type === "box_sft" && item.per_box_sft ? ` × ${item.per_box_sft} sft` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => updateQty(item.product_id, -1)}>
                        <Minus className="h-3 w-3" />
                      </Button>
                      <span className="text-sm w-7 text-center font-medium">{item.quantity}</span>
                      <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => updateQty(item.product_id, 1)}>
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                    <span className="text-sm font-semibold w-16 text-right shrink-0">
                      {formatCurrency(
                        item.unit_type === "box_sft" && item.per_box_sft
                          ? item.quantity * item.per_box_sft * item.sale_rate
                          : item.quantity * item.sale_rate
                      )}
                    </span>
                    <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => removeFromCart(item.product_id)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Fixed bottom payment bar */}
      <div className="shrink-0 border-t bg-card px-3 py-2.5 sm:px-4 sm:py-3">
        <div className="flex items-center gap-3 justify-between">
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-lg sm:text-xl font-bold text-foreground">{formatCurrency(grandTotal)}</p>
          </div>
          <Button
            size="lg"
            className="h-12 px-6 sm:px-8 text-sm sm:text-base font-semibold min-w-[140px]"
            onClick={handleCheckout}
            disabled={processing || cart.length === 0}
          >
            {processing ? "Processing…" : "Checkout"}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default POSSalePage;
