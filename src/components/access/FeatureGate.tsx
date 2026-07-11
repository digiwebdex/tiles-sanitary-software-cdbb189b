/**
 * <FeatureGate> — Sprint 1 (V2 Foundation).
 *
 * Renders `children` only when the dealer's plan includes `feature`
 * (super_admin always passes). Otherwise renders `fallback` (default: nothing).
 * The single, consistent way every module should plan-gate UI.
 *
 *   <FeatureGate feature="projectsEnabled">
 *     <ProjectsMenuItem />
 *   </FeatureGate>
 *
 * Additive — introduces no gating on existing screens until adopted.
 */
import type { ReactNode } from "react";
import { useEntitlements, type FeatureKey } from "@/hooks/useEntitlements";

interface FeatureGateProps {
  feature: FeatureKey;
  children: ReactNode;
  /** Rendered when the feature is not in the plan. Default: null. */
  fallback?: ReactNode;
  /** Rendered while entitlements are still loading. Default: null. */
  loadingFallback?: ReactNode;
}

export function FeatureGate({
  feature,
  children,
  fallback = null,
  loadingFallback = null,
}: FeatureGateProps) {
  const { hasFeature, isLoading } = useEntitlements();
  if (isLoading) return <>{loadingFallback}</>;
  return hasFeature(feature) ? <>{children}</> : <>{fallback}</>;
}

export default FeatureGate;
