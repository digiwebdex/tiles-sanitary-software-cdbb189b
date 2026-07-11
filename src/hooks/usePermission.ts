/**
 * usePermission — Sprint 1 (V2 Foundation).
 *
 * Thin, consistent RBAC helper on top of AuthContext. Gives every module one
 * way to ask "can this role do X" without re-reading the roles array. Mirrors
 * the backend requireRole semantics (super_admin always passes).
 *
 * Additive: does not change existing role checks.
 */
import { useAuth } from "@/contexts/AuthContext";

export type AppRole =
  | "super_admin"
  | "dealer_admin"
  | "manager"
  | "accountant"
  | "salesman"
  | "sa_employee";

export function usePermission() {
  const { roles } = useAuth();
  const roleNames = roles.map((r) => r.role) as AppRole[];
  const isSuperAdmin = roleNames.includes("super_admin");

  /** True if the user has any of the allowed roles (super_admin always passes). */
  const has = (...allowed: AppRole[]): boolean =>
    isSuperAdmin || allowed.some((r) => roleNames.includes(r));

  return {
    roles: roleNames,
    isSuperAdmin,
    isDealerAdmin: has("dealer_admin"),
    isManager: has("dealer_admin", "manager"),
    isAccountant: has("dealer_admin", "accountant"),
    isSalesman: has("dealer_admin", "salesman"),
    /** Can perform owner/admin-only actions (delete, approve, settings). */
    canAdminister: has("dealer_admin"),
    has,
  };
}
