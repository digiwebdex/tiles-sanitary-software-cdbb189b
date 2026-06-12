import { useAuth } from "@/contexts/AuthContext";
import { logAudit } from "@/services/auditService";
import { useCallback } from "react";

/**
 * Hook that provides a guard function for write operations.
 * - Returns `true` if the user can perform write operations.
 * - Returns `false` and logs the attempt if subscription is expired/blocked.
 */
export function useSubscriptionGuard() {
  const { accessLevel, user, profile } = useAuth();

  const canWrite = accessLevel === "full";

  const guardWrite = useCallback(
    async (action: string): Promise<boolean> => {
      if (canWrite) return true;

      // Log the blocked attempt (fire-and-forget via VPS)
      try {
        await logAudit({
          dealer_id: profile?.dealer_id ?? "",
          user_id: user?.id ?? null,
          action: "SUBSCRIPTION_BYPASS_ATTEMPT",
          table_name: "subscription_guard",
          record_id: "",
          new_data: {
            access_level: accessLevel,
            attempted_action: action,
            timestamp: new Date().toISOString(),
          },
        });
      } catch {
        // Swallow — never let logging break the guard
      }

      return false;
    },
    [canWrite, accessLevel, user?.id, profile?.dealer_id]
  );

  return { canWrite, guardWrite };
}
