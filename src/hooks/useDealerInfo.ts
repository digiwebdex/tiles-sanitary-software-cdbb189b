import { useQuery } from "@tanstack/react-query";
import { useDealerId } from "@/hooks/useDealerId";
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

export interface DealerInfo {
  name: string;
  phone: string | null;
  address: string | null;
  challan_template: string;
  enable_reservations: boolean;
  default_wastage_pct: number;
  /** Phase 3U-30: surfaced from `/api/dealers/:id` so SaleForm can gate backorders without a separate Supabase round-trip. */
  allow_backorder: boolean;
  /** Phase 1 dual-unit: when true, Purchase/Sale/Return forms split Qty into Box + Pc. */
  dual_unit_enabled: boolean;
  /** Phase 5 — dealer BIN for Mushak tax invoice */
  tax_id: string | null;
  vat_enabled: boolean;
  default_vat_rate: number;
}

/**
 * Phase 3U-27: Migrated from Supabase `dealers` select to VPS GET /api/dealer-settings.
 */
export function useDealerInfo() {
  const dealerId = useDealerId();

  return useQuery({
    queryKey: ["dealer-info", dealerId],
    queryFn: async (): Promise<DealerInfo> => {
      const res = await vpsAuthedFetch(
        `/api/dealer-settings?dealerId=${encodeURIComponent(dealerId)}`,
      );
      const body = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        const msg = (body as any)?.error || `Failed to load dealer info (${res.status})`;
        throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
      }
      const row = (body as any)?.dealer ?? {};
      return {
        name: String(row.name ?? ""),
        phone: (row.phone as string | null) ?? null,
        address: (row.address as string | null) ?? null,
        challan_template: String(row.challan_template ?? "classic"),
        enable_reservations: Boolean(row.enable_reservations),
        default_wastage_pct: Number(row.default_wastage_pct ?? 10),
        allow_backorder: Boolean(row.allow_backorder),
        dual_unit_enabled: Boolean(row.dual_unit_enabled),
        tax_id: (row.tax_id as string | null) ?? null,
        vat_enabled: row.vat_enabled === true,
        default_vat_rate: Number(row.default_vat_rate ?? 15),
      };
    },
    enabled: !!dealerId,
    staleTime: 5 * 60 * 1000, // cache 5 min
  });
}
