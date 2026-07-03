/**
 * VPS portal API client — uses dealer-app JWT (vpsAuthedFetch).
 * Active when env.PORTAL_BACKEND === "vps".
 */
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

export async function portalVpsJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await vpsAuthedFetch(path, init);
  const body = await res.json().catch(() => ({} as Record<string, unknown>));
  if (!res.ok) {
    const msg = (body as { error?: string })?.error || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return body as T;
}
