/**
 * <Can> — Sprint 1 (V2 Foundation).
 *
 * Role-based render gate (RBAC counterpart to <FeatureGate>). Renders
 * `children` only when the current user holds one of `roles`
 * (super_admin always passes). Otherwise renders `fallback`.
 *
 *   <Can roles={["dealer_admin"]}>
 *     <DeleteButton />
 *   </Can>
 *
 * Additive — introduces no restrictions on existing screens until adopted.
 */
import type { ReactNode } from "react";
import { usePermission, type AppRole } from "@/hooks/usePermission";

interface CanProps {
  roles: AppRole[];
  children: ReactNode;
  fallback?: ReactNode;
}

export function Can({ roles, children, fallback = null }: CanProps) {
  const { has } = usePermission();
  return has(...roles) ? <>{children}</> : <>{fallback}</>;
}

export default Can;
