/**
 * Entitlements service — Sprint 1 (V2 Foundation).
 *
 * Single, authoritative resolver for a dealer's plan entitlements (the 15
 * feature flags + the three numeric limits), including per-dealer overrides
 * stored in `subscriptions.custom_features` (JSON).
 *
 * WHY this exists separately from authService.buildJwtPayload():
 *   - buildJwtPayload only attaches planFeatures for dealer_admin / salesman
 *     tokens, so managers/accountants have no entitlements in their JWT.
 *   - Enforcement must work for EVERY dealer-scoped role, so the server
 *     resolves entitlements from `dealer_id` (not from the token), with a
 *     short in-memory cache to keep it cheap.
 *   - It deliberately duplicates the plan query rather than refactor the
 *     login path (zero-risk to authentication). The two should be DRY-ed up
 *     in a later sprint; the shape is identical to PlanFeatures on purpose.
 *
 * This module is READ-ONLY and additive. It changes no existing behaviour.
 */
import { db } from '../db/connection';
import type { PlanFeatures } from './authService';

export type Entitlements = PlanFeatures;

/** Boolean feature keys on Entitlements (the numeric limits are excluded). */
export type FeatureKey =
  | 'whatsappEnabled'
  | 'hrmEnabled'
  | 'campaignsEnabled'
  | 'portalEnabled'
  | 'advancedFinanceEnabled'
  | 'advancedReportsEnabled'
  | 'posEnabled'
  | 'barcodeEnabled'
  | 'leadsEnabled'
  | 'projectsEnabled'
  | 'quotationsEnabled'
  | 'backordersEnabled';

/** Numeric limit keys on Entitlements. */
export type LimitKey = 'maxWarehouses' | 'maxBranches' | 'maxStaffUsers';

/** Value >= this is treated as "unlimited" (matches team.ts convention). */
export const UNLIMITED = 9999;

interface CacheEntry {
  value: Entitlements | null;
  expires: number;
}
const CACHE_TTL_MS = 60_000; // 60s — plan changes are rare; refresh is cheap.
const cache = new Map<string, CacheEntry>();

/** Drop a dealer's cached entitlements (call after a plan/override change). */
export function invalidateEntitlements(dealerId: string): void {
  cache.delete(dealerId);
}

/** Clear the whole cache (tests / admin). */
export function clearEntitlementsCache(): void {
  cache.clear();
}

/**
 * Resolve a dealer's entitlements (plan flags + limits + custom_features
 * overrides). Returns null when the dealer has no subscription/plan.
 * Cached for 60s per dealer.
 */
export async function getEntitlements(dealerId: string): Promise<Entitlements | null> {
  if (!dealerId) return null;

  const now = Date.now();
  const hit = cache.get(dealerId);
  if (hit && hit.expires > now) return hit.value;

  const sub = await db('subscriptions as s')
    .leftJoin('plans as p', 'p.id', 's.plan_id')
    .where({ 's.dealer_id': dealerId })
    .orderBy('s.start_date', 'desc')
    .orderBy('s.created_at', 'desc')
    .select(
      'p.max_warehouses', 'p.max_branches', 'p.max_staff_users',
      'p.whatsapp_enabled', 'p.hrm_enabled', 'p.campaigns_enabled',
      'p.portal_enabled', 'p.advanced_finance_enabled', 'p.advanced_reports_enabled',
      'p.pos_enabled', 'p.barcode_enabled', 'p.leads_enabled',
      'p.projects_enabled', 'p.quotations_enabled', 'p.backorders_enabled',
      's.custom_features',
    )
    .first();

  let value: Entitlements | null = null;
  if (sub) {
    const base: Entitlements = {
      maxWarehouses: sub.max_warehouses ?? 1,
      maxBranches: sub.max_branches ?? 1,
      maxStaffUsers: sub.max_staff_users ?? 3,
      whatsappEnabled: !!sub.whatsapp_enabled,
      hrmEnabled: !!sub.hrm_enabled,
      campaignsEnabled: !!sub.campaigns_enabled,
      portalEnabled: !!sub.portal_enabled,
      advancedFinanceEnabled: !!sub.advanced_finance_enabled,
      advancedReportsEnabled: !!sub.advanced_reports_enabled,
      posEnabled: !!sub.pos_enabled,
      barcodeEnabled: !!sub.barcode_enabled,
      leadsEnabled: !!sub.leads_enabled,
      projectsEnabled: !!sub.projects_enabled,
      quotationsEnabled: !!sub.quotations_enabled,
      backordersEnabled: !!sub.backorders_enabled,
    };
    let overrides: Partial<Entitlements> = {};
    if (sub.custom_features) {
      try {
        overrides = typeof sub.custom_features === 'string'
          ? JSON.parse(sub.custom_features)
          : sub.custom_features;
      } catch {
        overrides = {};
      }
    }
    value = { ...base, ...overrides };
  }

  cache.set(dealerId, { value, expires: now + CACHE_TTL_MS });
  return value;
}

/** True if the dealer's entitlements enable a given feature (null = not entitled). */
export function hasFeature(ent: Entitlements | null, key: FeatureKey): boolean {
  return !!ent && !!ent[key];
}

/** True when `current` is within the plan limit (>= UNLIMITED means no cap). */
export function withinLimit(ent: Entitlements | null, key: LimitKey, current: number): boolean {
  if (!ent) return false;
  const cap = ent[key];
  if (cap >= UNLIMITED) return true;
  return current < cap;
}

/**
 * Central path → feature map for `enforcePlanFeatures`. Only clearly premium
 * modules are listed; core selling/buying/stock/accounts stay ungated. Longest
 * matching prefix wins. Keys map to Entitlements boolean fields.
 *
 * NOTE: /api/portal is intentionally absent — portal routes are called by
 * portal users (separate auth), not dealer users, so portal plan-gating is
 * handled at portal-provisioning time, not here.
 */
export const FEATURE_ROUTE_MAP: Array<{ prefix: string; feature: FeatureKey; label: string }> = [
  { prefix: '/api/reports/projects', feature: 'projectsEnabled', label: 'Project reports' },
  { prefix: '/api/reports/pricing-tier', feature: 'advancedReportsEnabled', label: 'Advanced reports' },
  { prefix: '/api/reports/supplier-performance', feature: 'advancedReportsEnabled', label: 'Advanced reports' },
  { prefix: '/api/projects', feature: 'projectsEnabled', label: 'Projects' },
  { prefix: '/api/leads', feature: 'leadsEnabled', label: 'Leads / CRM' },
  { prefix: '/api/whatsapp', feature: 'whatsappEnabled', label: 'WhatsApp' },
  { prefix: '/api/campaign-gifts', feature: 'campaignsEnabled', label: 'Campaigns' },
  { prefix: '/api/quotations', feature: 'quotationsEnabled', label: 'Quotations' },
  { prefix: '/api/backorders', feature: 'backordersEnabled', label: 'Backorders' },
  // Advanced finance cluster
  { prefix: '/api/emi', feature: 'advancedFinanceEnabled', label: 'EMI plans' },
  { prefix: '/api/directors', feature: 'advancedFinanceEnabled', label: 'Directors' },
  { prefix: '/api/journal', feature: 'advancedFinanceEnabled', label: 'Journal' },
  { prefix: '/api/gl', feature: 'advancedFinanceEnabled', label: 'General ledger' },
  { prefix: '/api/postings', feature: 'advancedFinanceEnabled', label: 'Postings' },
  // HRM cluster
  { prefix: '/api/employees', feature: 'hrmEnabled', label: 'HR' },
  { prefix: '/api/employee-documents', feature: 'hrmEnabled', label: 'HR' },
  { prefix: '/api/employee-loans', feature: 'hrmEnabled', label: 'HR' },
  { prefix: '/api/employee-exits', feature: 'hrmEnabled', label: 'HR' },
  { prefix: '/api/leaves', feature: 'hrmEnabled', label: 'HR' },
  { prefix: '/api/shifts', feature: 'hrmEnabled', label: 'HR' },
  { prefix: '/api/salary-components', feature: 'hrmEnabled', label: 'HR' },
  { prefix: '/api/performance', feature: 'hrmEnabled', label: 'HR' },
  { prefix: '/api/training', feature: 'hrmEnabled', label: 'HR' },
  { prefix: '/api/assets', feature: 'hrmEnabled', label: 'HR' },
  { prefix: '/api/holidays', feature: 'hrmEnabled', label: 'HR' },
];

/** Resolve the required feature for a request path (longest prefix wins). */
export function featureForPath(path: string): { feature: FeatureKey; label: string } | null {
  let best: { feature: FeatureKey; label: string; len: number } | null = null;
  for (const m of FEATURE_ROUTE_MAP) {
    if ((path === m.prefix || path.startsWith(m.prefix + '/')) &&
        (!best || m.prefix.length > best.len)) {
      best = { feature: m.feature, label: m.label, len: m.prefix.length };
    }
  }
  return best ? { feature: best.feature, label: best.label } : null;
}
