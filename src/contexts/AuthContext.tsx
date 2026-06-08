import { createContext, useContext, useEffect, useState, useRef, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";
import { parseLocalDate } from "@/lib/utils";
import { subLog } from "@/lib/logger";
import { env } from "@/lib/env";
import { vpsAuthApi, vpsTokenStore, type VpsUser } from "@/lib/vpsAuthClient";
import { saImpersonation } from "@/lib/saImpersonation";

interface Profile {
  id: string;
  name: string;
  email: string;
  dealer_id: string | null;
  status: string;
}

interface UserRole {
  role: "super_admin" | "dealer_admin" | "manager" | "accountant" | "salesman";
}

interface Subscription {
  id: string;
  dealer_id: string;
  plan_id: string;
  status: "active" | "expired" | "suspended";
  start_date: string;
  end_date: string | null;
}

export type AccessLevel = "full" | "grace" | "readonly" | "blocked";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  roles: UserRole[];
  subscription: Subscription | null;
  accessLevel: AccessLevel;
  isSuperAdmin: boolean;
  isDealerAdmin: boolean;
  isDemo: boolean;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

/**
 * Computes access level based on role and subscription state.
 *
 * Rules:
 *  1. super_admin  → always "full", subscription never checked
 *  2. dealer_admin / salesman with no dealer_id → "blocked"
 *  3. dealer_admin / salesman subscription states → full / grace / readonly / blocked
 *  4. Any other authenticated user (edge case) → "full"
 */
function computeAccessLevel(
  sub: Subscription | null,
  fetchedRoles: UserRole[],
  dealerId: string | null
): AccessLevel {
  const isSuperAdmin = fetchedRoles.some((r) => r.role === "super_admin");
  const isDealerRole = fetchedRoles.some(
    (r) => r.role === "dealer_admin" || r.role === "salesman"
  );

  // Rule 1: super_admin always gets full access — never check subscription
  if (isSuperAdmin) return "full";

  // Rule 2: dealer roles without a dealer_id are blocked
  if (isDealerRole && !dealerId) return "blocked";

  // Rule 3: apply subscription logic for dealer roles
  if (isDealerRole) {
    if (!sub) return "blocked";

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Parse end_date as LOCAL midnight (timezone-safe — avoids UTC off-by-one)
    const endDate = parseLocalDate(sub.end_date);

    // Suspended → blocked immediately
    if (sub.status === "suspended") return "blocked";

    // Date is the source of truth: if today <= end_date → full access
    // (regardless of DB status field, which may lag behind)
    if (endDate && today <= endDate) return "full";

    // Grace window: end_date < today <= end_date + 3 days
    if (endDate) {
      const graceEnd = new Date(endDate);
      graceEnd.setDate(graceEnd.getDate() + 3);
      if (today > endDate && today <= graceEnd) return "grace";
    }

    // Beyond grace → readonly
    return "readonly";
  }

  // Rule 4: any other authenticated role gets full access
  return "full";
}

function toSupabaseCompatibleUser(vpsUser: VpsUser): User {
  return {
    id: vpsUser.userId,
    email: vpsUser.email,
    aud: "authenticated",
    role: "authenticated",
    app_metadata: {},
    user_metadata: {},
    identities: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as User;
}

function toProfile(vpsUser: VpsUser): Profile {
  return {
    id: vpsUser.userId,
    email: vpsUser.email,
    name: vpsUser.email,
    dealer_id: vpsUser.dealerId,
    status: "active",
  };
}

function toRoles(vpsUser: VpsUser): UserRole[] {
  return vpsUser.roles.map((role) => ({ role })) as UserRole[];
}

function toSubscription(vpsUser: VpsUser): Subscription | null {
  const sub = vpsUser.subscription;
  if (!sub || !vpsUser.dealerId) return null;

  return {
    id: sub.id,
    dealer_id: vpsUser.dealerId,
    plan_id: sub.planId,
    status: sub.status,
    start_date: sub.startDate,
    end_date: sub.endDate,
  };
}

/**
 * Validates and reconciles dealer subscription status against current date.
 * Mutates DB status to "expired" or "active" as needed.
 * Returns the latest subscription record.
 * Retries once on transient network/RLS failures.
 */
async function validateAndSyncSubscription(
  dealerId: string
): Promise<Subscription | null> {
  let sub: Subscription | null = null;
  let fetchError: { message: string } | null = null;

  // Retry up to 2 times for transient failures (network hiccup, cold session)
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { data, error } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("dealer_id", dealerId)
      .order("start_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error) {
      sub = data as Subscription | null;
      fetchError = null;
      break;
    }

    fetchError = error;
    subLog.warn(`Subscription fetch attempt ${attempt} failed:`, error.message);

    if (attempt < 2) {
      // Small delay before retry
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  if (fetchError) {
    subLog.error("Fetch error after retries:", fetchError.message);
    return null;
  }

  if (!sub) {
    subLog.warn("No subscription found for dealer_id:", dealerId);
    return null;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Parse end_date as LOCAL midnight (timezone-safe — avoids UTC off-by-one)
  const endDate = parseLocalDate(sub.end_date);

  // --- Debug logging ---
  subLog.debug("dealer_id     :", dealerId);
  subLog.debug("sub.dealer_id :", sub.dealer_id);
  subLog.debug("status        :", sub.status);
  subLog.debug("end_date      :", sub.end_date ?? "null");
  subLog.debug("current_date  :", today.toISOString().split("T")[0]);
  subLog.debug("parsed endDate:", endDate?.toLocaleDateString() ?? "null");

  // Validate dealer_id match (sanity check)
  if (sub.dealer_id !== dealerId) {
    subLog.error("dealer_id MISMATCH — blocking access.");
    return null;
  }

  if (!endDate) {
    subLog.warn("No end_date on subscription — treating as blocked.");
    return sub as Subscription;
  }

  const graceEnd = new Date(endDate);
  graceEnd.setDate(graceEnd.getDate() + 3);

  // Case 1: Within end_date → ensure status is "active"
  if (today <= endDate) {
    if (sub.status !== "active") {
      await supabase.from("subscriptions").update({ status: "active" }).eq("id", sub.id);
      subLog.info("Status corrected → active");
      return { ...(sub as Subscription), status: "active" };
    }
    subLog.info("Access: FULL (active, end_date:", sub.end_date, ")");
    return sub as Subscription;
  }

  // Case 2: Within grace period (end_date < today <= end_date + 3)
  if (today > endDate && today <= graceEnd) {
    if (sub.status !== "expired") {
      await supabase.from("subscriptions").update({ status: "expired" }).eq("id", sub.id);
      subLog.info("Status updated → expired (grace window)");
      return { ...(sub as Subscription), status: "expired" };
    }
    subLog.info("Access: GRACE period");
    return sub as Subscription;
  }

  // Case 3: Beyond grace → expired, block access
  if (sub.status !== "expired") {
    await supabase.from("subscriptions").update({ status: "expired" }).eq("id", sub.id);
    subLog.info("Status updated → expired (past grace)");
  }
  subLog.info("Access: BLOCKED (expired past grace)");
  return { ...(sub as Subscription), status: "expired" };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [loading, setLoading] = useState(true);

  // Keep a ref of loaded roles so we can compute access synchronously
  // inside loadUserData before React re-renders.
  const loadedRolesRef = useRef<UserRole[]>([]);

  /**
   * Guard: true while initialize() is still running.
   * Prevents onAuthStateChange from double-loading user data when
   * INITIAL_SESSION fires concurrently with the getSession() call.
   */
  const initializingRef = useRef(true);

  const isSuperAdmin = roles.some((r) => r.role === "super_admin");
  const isDealerAdmin = roles.some((r) => r.role === "dealer_admin");

  // ── SA impersonation: override dealer_id when SA is "viewing as" a dealer ──
  // Re-render whenever the impersonation target changes (custom event + storage).
  const [impersonationVersion, setImpersonationVersion] = useState(0);
  useEffect(() => saImpersonation.subscribe(() => setImpersonationVersion((v) => v + 1)), []);

  const impersonation = isSuperAdmin ? saImpersonation.get() : null;
  const effectiveProfile: Profile | null = profile && impersonation
    ? { ...profile, dealer_id: impersonation.dealerId }
    : profile;
  // Touch the version so React picks up impersonation updates.
  void impersonationVersion;

  const accessLevel = computeAccessLevel(subscription, roles, effectiveProfile?.dealer_id ?? null);

  async function fetchUserRolesWithRetry(userId: string): Promise<UserRole[]> {
    for (let attempt = 1; attempt <= 4; attempt++) {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId);

      if (error) {
        subLog.error(`Roles fetch attempt ${attempt} failed:`, error.message);
      } else if (Array.isArray(data) && data.length > 0) {
        return data as UserRole[];
      } else if (attempt === 4) {
        return [];
      }

      await new Promise((resolve) => setTimeout(resolve, attempt * 400));
    }

    return [];
  }

  async function loadUserData(userId: string) {
    try {
      // Fetch profile first, then roles with retry. Fresh self-signups can hit
      // a short auth/session propagation window where roles return [] once.
      const profileRes = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();

      if (profileRes.error) {
        subLog.error("Profile fetch error:", profileRes.error.message);
      }

      // Safe null fallbacks — never crash if DB returns null/undefined
      const prof = (profileRes.data as Profile | null) ?? null;
      const fetchedRoles = await fetchUserRolesWithRetry(userId);

      if (prof && fetchedRoles.length === 0) {
        subLog.error("No roles found after retry; account provisioning is incomplete. user_id:", userId);
      }

      // Persist in ref for synchronous checks below
      loadedRolesRef.current = fetchedRoles;

      const userIsSuperAdmin = fetchedRoles.some((r) => r.role === "super_admin");
      const userIsDealerRole = fetchedRoles.some(
        (r) => r.role === "dealer_admin" || r.role === "salesman"
      );

      // Set profile & roles together so the first render after loading
      // already has the correct role context.
      setProfile(prof);
      setRoles(fetchedRoles);

      // Only validate subscription for dealer roles with a dealer_id.
      // super_admin path is untouched.
      if (userIsDealerRole && !userIsSuperAdmin) {
        const dealerId = prof?.dealer_id ?? null;
        if (dealerId) {
          const validatedSub = await validateAndSyncSubscription(dealerId);
          setSubscription(validatedSub ?? null);
        } else {
          // Dealer role but no dealer_id — log and block
          subLog.error("Dealer role user has no dealer_id! user_id:", userId);
          setSubscription(null);
        }
      } else {
        // super_admin or no dealer role — no subscription needed
        setSubscription(null);
      }
    } catch (err) {
      // Catch-all: never let loadUserData crash the auth flow.
      // Log the error and clear state so the user sees login instead of a blank screen.
      subLog.error("loadUserData unhandled exception:", err);
      setProfile(null);
      setRoles([]);
      setSubscription(null);
    }
  }

  useEffect(() => {
    let isMounted = true;

    if (env.AUTH_BACKEND === "vps") {
      const applyVpsUser = (vpsUser: VpsUser | null) => {
        if (!isMounted) return;
        setSession(null);
        setUser(vpsUser ? toSupabaseCompatibleUser(vpsUser) : null);
        setProfile(vpsUser ? toProfile(vpsUser) : null);
        setRoles(vpsUser ? toRoles(vpsUser) : []);
        setSubscription(vpsUser ? toSubscription(vpsUser) : null);
        setIsDemo(!!vpsUser?.isDemo);
      };

      const initializeVps = async () => {
        setLoading(true);
        try {
          const me = await vpsAuthApi.me();
          applyVpsUser(me ?? vpsTokenStore.user);
        } catch (err) {
          subLog.error("VPS auth init error:", err);
          applyVpsUser(null);
        } finally {
          if (isMounted) setLoading(false);
        }
      };

      const onAuthChange = () => applyVpsUser(vpsTokenStore.user);
      const onStorage = (e: StorageEvent) => {
        if (e.key === "vps.accessToken" || e.key === "vps.refreshToken" || e.key === "vps.user") {
          applyVpsUser(vpsTokenStore.user);
        }
      };

      // Re-fetch /me when the tab regains focus so subscription/role
      // changes from Super Admin propagate without forcing a re-login.
      const onFocus = async () => {
        if (!vpsTokenStore.access) return;
        try {
          const me = await vpsAuthApi.me();
          if (me) {
            applyVpsUser(me);
          }
        } catch (err) {
          subLog.warn("VPS me() refresh on focus failed:", err);
        }
      };

      initializeVps();
      window.addEventListener("vps-auth-change", onAuthChange);
      window.addEventListener("storage", onStorage);
      window.addEventListener("focus", onFocus);

      // Periodic refresh every 60s (in case tab stays focused but sub changes)
      const intervalId = window.setInterval(onFocus, 60_000);

      return () => {
        isMounted = false;
        window.removeEventListener("vps-auth-change", onAuthChange);
        window.removeEventListener("storage", onStorage);
        window.removeEventListener("focus", onFocus);
        window.clearInterval(intervalId);
      };
    }

    /**
     * Phase 1 — Initial session bootstrap.
     *
     * getSession() returns the persisted session from localStorage synchronously
     * (via the Supabase JS client). We load ALL user data here first, then mark
     * initialization complete so the auth state listener knows it can safely
     * handle subsequent events (SIGNED_IN after login, SIGNED_OUT, etc.).
     */
    const initialize = async () => {
      try {
        const { data: { session: initialSession } } = await supabase.auth.getSession();
        if (!isMounted) return;

        setSession(initialSession);
        setUser(initialSession?.user ?? null);

        if (initialSession?.user) {
          await loadUserData(initialSession.user.id);
        }
      } catch (err) {
        subLog.error("Auth init error:", err);
      } finally {
        if (isMounted) {
          // Mark initialization complete BEFORE clearing loading so the auth
          // state listener can distinguish INITIAL_SESSION from later events.
          initializingRef.current = false;
          setLoading(false);
        }
      }
    };

    initialize();

    /**
     * Phase 2 — Ongoing auth state changes (login, logout, token refresh).
     *
     * Skip if initializingRef is still true: that means initialize() hasn't
     * finished yet and already handles this session — processing it twice
     * would clear loading prematurely (double-load race condition).
     *
     * For post-init events (actual sign-in / sign-out), set loading = true
     * BEFORE starting the async fetch so ProtectedRoute never evaluates
     * with partial / stale auth state.
     */
    const { data: { subscription: authSub } } = supabase.auth.onAuthStateChange(
      (event, newSession) => {
        if (!isMounted) return;

        // Skip INITIAL_SESSION — initialize() is the single source of truth
        // for the first load. Supabase fires this event almost immediately on
        // mount; without this guard it races with initialize() and can clear
        // loading before profile/roles/subscription have been fetched.
        if (initializingRef.current) {
          subLog.info("onAuthStateChange skipped during init (event:", event, ")");
          return;
        }

        // For all post-init events, reset loading so ProtectedRoute waits.
        setLoading(true);
        setSession(newSession);
        setUser(newSession?.user ?? null);

        if (newSession?.user) {
          // Defer to avoid Supabase internal auth deadlock
          setTimeout(async () => {
            if (!isMounted) return;
            try {
              await loadUserData(newSession.user.id);
            } catch (err) {
              subLog.error("loadUserData error in onAuthStateChange:", err);
            } finally {
              if (isMounted) setLoading(false);
            }
          }, 0);
        } else {
          // Signed out — clear everything immediately
          setProfile(null);
          setRoles([]);
          setSubscription(null);
          setLoading(false);
        }
      }
    );

    return () => {
      isMounted = false;
      authSub.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    saImpersonation.clear();
    if (env.AUTH_BACKEND === "vps") {
      await vpsAuthApi.logout();
    } else {
      await supabase.auth.signOut();
    }
    setUser(null);
    setSession(null);
    setProfile(null);
    setRoles([]);
    setSubscription(null);
    setIsDemo(false);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile: effectiveProfile,
        roles,
        subscription,
        accessLevel,
        isSuperAdmin,
        isDealerAdmin,
        isDemo,
        loading,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
