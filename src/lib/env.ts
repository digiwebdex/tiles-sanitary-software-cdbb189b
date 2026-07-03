/** Centralized environment configuration with validation */

function requireEnv(key: string): string {
  const value = import.meta.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optionalEnv(key: string, fallback = ""): string {
  const v = import.meta.env[key];
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

/**
 * Phase 1 auth-backend toggle.
 *   "supabase" → existing Lovable Cloud auth path.
 *   "vps"      → frontend authBridge talks to the self-hosted API.
 *
 * Production safety: sanitileserp.com hosts must use VPS auth even if the
 * build env forgot VITE_AUTH_BACKEND. This prevents the live custom domain
 * from posting passwords to the old Lovable Cloud auth endpoint.
 */
export type AuthBackend = "supabase" | "vps";

const rawBackend = optionalEnv("VITE_AUTH_BACKEND", "").toLowerCase();
const isSanitilesHost =
  typeof window !== "undefined" && /(^|\.)sanitileserp\.com$/i.test(window.location.hostname);
const isLovableHost =
  typeof window !== "undefined" &&
  (/\.lovableproject\.com$/i.test(window.location.hostname) || /\.lovable\.app$/i.test(window.location.hostname));
const AUTH_BACKEND: AuthBackend = rawBackend === "vps" || isSanitilesHost || isLovableHost ? "vps" : "supabase";

/**
 * Phase 2 per-resource data backend toggles.
 *
 *   "supabase" (default) → existing Supabase service path is unchanged.
 *   "vps"                → dataClient routes the resource to the self-hosted API.
 *   "shadow"             → reads from Supabase but ALSO mirrors a read against VPS
 *                          for verification (logs diffs, never affects UI).
 *
 * Each resource has its own flag so we can migrate one entity at a time
 * without touching the others. Defaults to "supabase" for safe rollback.
 *
 * Flip via env (rebuild required):
 *   VITE_DATA_CUSTOMERS=vps
 *   VITE_DATA_PRODUCTS=shadow
 *   ...
 */
export type DataBackend = "supabase" | "vps" | "shadow";

/**
 * Phase 6 portal data path.
 *   "supabase" → portal.sanitileserp.com uses Supabase Auth + RPC (default).
 *   "vps"      → portal reads via /api/portal/* with VPS JWT.
 *
 * Flip via VITE_PORTAL_BACKEND=vps (rebuild required).
 * Portal auth must also use VPS JWT before enabling.
 */
export type PortalBackend = "supabase" | "vps";

const rawPortalBackend = optionalEnv("VITE_PORTAL_BACKEND", "").toLowerCase();
const PORTAL_BACKEND: PortalBackend = rawPortalBackend === "vps" ? "vps" : "supabase";

const DATA_RESOURCES = [
  "CUSTOMERS",
  "SUPPLIERS",
  "PRODUCTS",
  "STOCK",
  "BATCHES",
  "SALES",
  "QUOTATIONS",
  "DELIVERIES",
  "PURCHASES",
] as const;

export type DataResource = (typeof DATA_RESOURCES)[number];

function parseDataBackend(raw: string): DataBackend {
  const v = raw.toLowerCase();
  if (v === "vps") return "vps";
  if (v === "shadow") return "shadow";
  return "supabase";
}

const DATA_BACKENDS: Record<DataResource, DataBackend> = DATA_RESOURCES.reduce(
  (acc, key) => {
    const raw = optionalEnv(`VITE_DATA_${key}`, "");
    // Production safety: app.sanitileserp.com must never fall back to the
    // legacy products PostgREST path if the production build env is stale.
    if (key === "PRODUCTS" && !raw && isSanitilesHost) {
      acc[key] = "vps";
      return acc;
    }
    acc[key] = parseDataBackend(raw || "supabase");
    return acc;
  },
  {} as Record<DataResource, DataBackend>,
);

export const env = {
  SUPABASE_URL: requireEnv("VITE_SUPABASE_URL"),
  SUPABASE_ANON_KEY: requireEnv("VITE_SUPABASE_PUBLISHABLE_KEY"),
  AUTH_BACKEND,
  PORTAL_BACKEND,
  DATA_BACKENDS,
  VPS_API_BASE: optionalEnv("VITE_VPS_API_BASE", "https://api.sanitileserp.com"),
  IS_PRODUCTION: import.meta.env.PROD,
  IS_DEVELOPMENT: import.meta.env.DEV,
  MODE: import.meta.env.MODE as string,
} as const;
