/**
 * useEntitlements — Sprint 1 (V2 Foundation).
 *
 * Single frontend source of truth for the current dealer's plan entitlements
 * (the 15 feature flags + 3 limits + current usage). Fetches the authoritative
 * resolution from GET /api/subscription/entitlements (works for ALL dealer
 * roles, unlike the JWT which only carries planFeatures for admin/salesman),
 * and falls back to AuthContext.planFeatures while loading / on error.
 *
 * Additive: does not change any existing gating; modules opt in via
 * <FeatureGate> or this hook.
 */
import { useQuery } from "@tanstack/react-query";
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";
import { useAuth, type PlanFeatures } from "@/contexts/AuthContext";

/** Boolean feature keys (numeric limit keys are excluded). */
export type FeatureKey =
  | "whatsappEnabled"
  | "hrmEnabled"
  | "campaignsEnabled"
  | "portalEnabled"
  | "advancedFinanceEnabled"
  | "advancedReportsEnabled"
  | "posEnabled"
  | "barcodeEnabled"
  | "leadsEnabled"
  | "projectsEnabled"
  | "quotationsEnabled"
  | "backordersEnabled";

export type LimitKey = "maxWarehouses" | "maxBranches" | "maxStaffUsers";

const UNLIMITED = 9999;

interface EntitlementsResponse {
  is_super_admin: boolean;
  entitlements: PlanFeatures | null;
  usage: { branches: number; warehouses: number; staffUsers: number } | null;
}

export function useEntitlements() {
  const { planFeatures, isSuperAdmin } = useAuth();

  const query = useQuery({
    queryKey: ["subscription", "entitlements"],
    queryFn: async () => {
      const res = await vpsAuthedFetch("/api/subscription/entitlements");
      if (!res.ok) throw new Error("Failed to load entitlements");
      return (await res.json()) as EntitlementsResponse;
    },
    staleTime: 5 * 60 * 1000, // entitlements change rarely
  });

  // Authoritative server value, else the JWT value from context, else null.
  const entitlements: PlanFeatures | null = query.data?.entitlements ?? planFeatures ?? null;
  const superAdmin = query.data?.is_super_admin ?? isSuperAdmin;

  const hasFeature = (key: FeatureKey): boolean => superAdmin || !!entitlements?.[key];

  const withinLimit = (key: LimitKey, current: number): boolean => {
    if (superAdmin) return true;
    if (!entitlements) return false;
    const cap = entitlements[key];
    return cap >= UNLIMITED || current < cap;
  };

  return {
    entitlements,
    usage: query.data?.usage ?? null,
    isSuperAdmin: superAdmin,
    hasFeature,
    withinLimit,
    isLoading: query.isLoading,
  };
}
