/**
 * PriceLevelsPanel — V2 Sprint 2 (Product Master).
 *
 * Shows this product's rate across the dealer's Price Tiers (Settings →
 * Pricing Tiers) — the existing mechanism this reuses instead of adding
 * dedicated Dealer/Retail/Wholesale/Project columns. A dealer that hasn't
 * set up tiers yet can one-click create the four standard levels; any
 * dealer already using custom tier names keeps them unchanged.
 *
 * Reuses: GET /api/products/:id/price-levels (new, read-only aggregation)
 *         pricingTierService.createTier / setTierRate (existing, unchanged)
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";
import { pricingTierService } from "@/services/pricingTierService";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Save, Plus } from "lucide-react";
import { toast } from "sonner";

interface PriceLevel {
  tierId: string;
  tierName: string;
  isDefault: boolean;
  rate: number | null;
}

interface PriceLevelsResponse {
  defaultSaleRate: number;
  tiers: PriceLevel[];
}

const STANDARD_LEVELS = ["Dealer", "Retail", "Wholesale", "Project"];

interface PriceLevelsPanelProps {
  productId: string;
  dealerId: string;
}

const PriceLevelsPanel = ({ productId, dealerId }: PriceLevelsPanelProps) => {
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingTierId, setSavingTierId] = useState<string | null>(null);
  const [creatingStandard, setCreatingStandard] = useState(false);

  const queryKey = ["product-price-levels", productId, dealerId];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await vpsAuthedFetch(
        `/api/products/${productId}/price-levels?dealerId=${encodeURIComponent(dealerId)}`,
      );
      if (!res.ok) throw new Error("Failed to load price levels");
      return (await res.json()) as PriceLevelsResponse;
    },
    enabled: !!productId && !!dealerId,
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey });
    // Keep the Settings → Pricing Tiers page's own cache in sync.
    queryClient.invalidateQueries({ queryKey: ["price-tiers", dealerId] });
    queryClient.invalidateQueries({ queryKey: ["price-tier-products", dealerId] });
  };

  const handleSaveRate = async (tierId: string) => {
    const raw = drafts[tierId];
    const rate = raw === undefined || raw === "" ? null : Number(raw);
    if (rate !== null && (!Number.isFinite(rate) || rate < 0)) {
      toast.error("Rate must be a number ≥ 0");
      return;
    }
    setSavingTierId(tierId);
    try {
      await pricingTierService.setTierRate(dealerId, tierId, productId, rate);
      toast.success("Price level saved");
      setDrafts((d) => {
        const next = { ...d };
        delete next[tierId];
        return next;
      });
      invalidateAll();
    } catch (err: any) {
      toast.error(err?.message || "Failed to save price level");
    } finally {
      setSavingTierId(null);
    }
  };

  const handleAddStandardLevels = async () => {
    if (!data) return;
    const existingNames = new Set(data.tiers.map((t) => t.tierName.trim().toLowerCase()));
    const missing = STANDARD_LEVELS.filter((n) => !existingNames.has(n.toLowerCase()));
    if (missing.length === 0) {
      toast.info("All standard levels already exist");
      return;
    }
    setCreatingStandard(true);
    try {
      for (const name of missing) {
        await pricingTierService.createTier(dealerId, { name });
      }
      toast.success(`Added: ${missing.join(", ")}`);
      invalidateAll();
    } catch (err: any) {
      toast.error(err?.message || "Failed to add standard levels");
    } finally {
      setCreatingStandard(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-semibold uppercase text-muted-foreground">
              Price Levels
            </CardTitle>
            <CardDescription className="mt-1">
              Dealer / Retail / Wholesale / Project rates for this product.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={creatingStandard || isLoading}
            onClick={handleAddStandardLevels}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add standard levels
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <p className="text-sm text-muted-foreground">Loading price levels…</p>}

        {!isLoading && data && (
          <>
            <div className="rounded-md border bg-muted/30 px-3 py-2 flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Default (base) sale rate</span>
              <span className="text-sm font-semibold">{data.defaultSaleRate.toFixed(2)}</span>
            </div>

            {data.tiers.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No price tiers yet. Click "Add standard levels" or create custom ones in Settings → Pricing Tiers.
              </p>
            )}

            {data.tiers.map((tier) => {
              const draftValue = drafts[tier.tierId];
              const displayValue = draftValue !== undefined ? draftValue : (tier.rate ?? "");
              const isDirty = draftValue !== undefined;
              return (
                <div key={tier.tierId} className="flex items-center gap-2">
                  <div className="flex-1 flex items-center gap-2">
                    <span className="text-sm font-medium">{tier.tierName}</span>
                    {tier.isDefault && <Badge variant="secondary" className="text-[10px]">default</Badge>}
                  </div>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder={data.defaultSaleRate.toFixed(2)}
                    className="w-32"
                    value={displayValue}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [tier.tierId]: e.target.value }))
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    disabled={!isDirty || savingTierId === tier.tierId}
                    onClick={() => handleSaveRate(tier.tierId)}
                    title="Save this price level"
                  >
                    <Save className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
            <p className="text-xs text-muted-foreground">
              Leave blank to fall back to the default sale rate above.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default PriceLevelsPanel;
