import { supabase } from "@/integrations/supabase/client";
import { env } from "@/lib/env";
import { saImpersonation } from "@/lib/saImpersonation";
import { vpsAuthApi, vpsTokenStore } from "@/lib/vpsAuthClient";

/**
 * Resolves the authenticated user's dealer_id from their profile.
 * Used in services to verify that the caller's dealer_id matches
 * what they claim — preventing horizontal privilege escalation
 * at the application layer (in addition to RLS at the DB layer).
 */
export async function getAuthenticatedDealerId(): Promise<string> {
  if (env.AUTH_BACKEND === "vps") {
    let user = vpsTokenStore.user;

    // AuthContext may have hydrated from /me while vps.user was missing
    // from localStorage (stale tab, partial clear, older builds). Re-fetch
    // once before failing mutations like purchase create.
    if (!user && vpsTokenStore.access) {
      user = await vpsAuthApi.me();
    }

    if (!user) throw new Error("Not authenticated");

    if (user.roles.includes("super_admin")) {
      const viewAs = saImpersonation.get();
      if (viewAs?.dealerId) return viewAs.dealerId;
    }

    if (!user.dealerId) {
      throw new Error("Could not resolve dealer_id for authenticated user");
    }

    return user.dealerId;
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("dealer_id")
    .eq("id", user.id)
    .single();

  if (error || !profile?.dealer_id) {
    throw new Error("Could not resolve dealer_id for authenticated user");
  }

  return profile.dealer_id;
}

/**
 * Asserts that the provided dealer_id matches the authenticated user's dealer_id.
 * Throws immediately if there's a mismatch — this catches any attempt to
 * pass a forged dealer_id through the frontend.
 * 
 * NOTE: This is a defense-in-depth measure. RLS policies at the DB level
 * are the primary enforcement mechanism.
 */
export async function assertDealerId(claimedDealerId: string): Promise<void> {
  const actualDealerId = await getAuthenticatedDealerId();
  if (claimedDealerId !== actualDealerId) {
    throw new Error(
      "Access denied: dealer_id mismatch. You cannot operate on another dealer's data."
    );
  }
}
