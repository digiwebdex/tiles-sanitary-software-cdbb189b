import { saImpersonation } from "@/lib/saImpersonation";
import { vpsAuthApi, vpsTokenStore, resolveVpsUser, userFromAccessToken } from "@/lib/vpsAuthClient";

export async function getAuthenticatedDealerId(): Promise<string> {
  let user = resolveVpsUser();

  if (!user && vpsTokenStore.access) user = await vpsAuthApi.me();
  if (!user && vpsTokenStore.access) user = userFromAccessToken();
  if (user && !vpsTokenStore.user) vpsTokenStore.setUser(user);

  if (!user) throw new Error("Session expired — please log out and log in again");

  if (user.roles.includes("super_admin")) {
    const viewAs = saImpersonation.get();
    if (viewAs?.dealerId) return viewAs.dealerId;
  }

  if (!user.dealerId) throw new Error("Could not resolve dealer_id for authenticated user");

  return user.dealerId;
}

export async function assertDealerId(claimedDealerId: string): Promise<void> {
  const actualDealerId = await getAuthenticatedDealerId();
  if (claimedDealerId !== actualDealerId) {
    throw new Error("Access denied: dealer_id mismatch. You cannot operate on another dealer's data.");
  }
}
