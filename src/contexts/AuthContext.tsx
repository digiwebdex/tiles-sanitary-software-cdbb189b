import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import type { User, Session } from "@supabase/supabase-js";
import { parseLocalDate } from "@/lib/utils";
import { subLog } from "@/lib/logger";
import { vpsAuthApi, vpsTokenStore, type VpsUser, type PlanFeatures, type SaEmployeePermissions, resolveVpsUser } from "@/lib/vpsAuthClient";
import { saImpersonation } from "@/lib/saImpersonation";

interface Profile {
  id: string;
  name: string;
  email: string;
  dealer_id: string | null;
  status: string;
}

interface UserRole {
  role: "super_admin" | "dealer_admin" | "manager" | "accountant" | "salesman" | "sa_employee";
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

export type { PlanFeatures, SaEmployeePermissions };

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  roles: UserRole[];
  subscription: Subscription | null;
  planFeatures: PlanFeatures | null;
  accessLevel: AccessLevel;
  isSuperAdmin: boolean;
  isSaEmployee: boolean;
  isDealerAdmin: boolean;
  isDemo: boolean;
  saPermissions: SaEmployeePermissions | null;
  menuMode: "simple" | "advanced";
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

function computeAccessLevel(
  sub: Subscription | null,
  fetchedRoles: UserRole[],
  dealerId: string | null
): AccessLevel {
  const isSuperAdmin = fetchedRoles.some((r) => r.role === "super_admin");
  const isDealerRole = fetchedRoles.some(
    (r) => r.role === "dealer_admin" || r.role === "salesman"
  );

  const isSaEmployee = fetchedRoles.some((r) => r.role === "sa_employee");
  if (isSuperAdmin || isSaEmployee) return "full";
  if (isDealerRole && !dealerId) return "blocked";

  if (isDealerRole) {
    if (!sub) return "blocked";
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDate = parseLocalDate(sub.end_date);
    if (sub.status === "suspended") return "blocked";
    if (!endDate && sub.status === "active") return "full";
    if (endDate && today <= endDate) return "full";
    if (endDate) {
      const graceEnd = new Date(endDate);
      graceEnd.setDate(graceEnd.getDate() + 3);
      if (today > endDate && today <= graceEnd) return "grace";
    }
    return "readonly";
  }

  return "full";
}

function toUser(vpsUser: VpsUser): User {
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [menuMode, setMenuMode] = useState<"simple" | "advanced">("advanced");
  const [planFeatures, setPlanFeatures] = useState<PlanFeatures | null>(null);
  const [saPermissions, setSaPermissions] = useState<SaEmployeePermissions | null>(null);
  const [loading, setLoading] = useState(true);

  const isSuperAdmin = roles.some((r) => r.role === "super_admin");
  const isSaEmployee = roles.some((r) => r.role === "sa_employee");
  const isDealerAdmin = roles.some((r) => r.role === "dealer_admin");

  const [impersonationVersion, setImpersonationVersion] = useState(0);
  useEffect(() => saImpersonation.subscribe(() => setImpersonationVersion((v) => v + 1)), []);

  const impersonation = isSuperAdmin ? saImpersonation.get() : null;
  const effectiveProfile: Profile | null = profile && impersonation
    ? { ...profile, dealer_id: impersonation.dealerId }
    : profile;
  void impersonationVersion;

  const accessLevel = computeAccessLevel(subscription, roles, effectiveProfile?.dealer_id ?? null);

  useEffect(() => {
    let isMounted = true;

    const applyVpsUser = (vpsUser: VpsUser | null) => {
      if (!isMounted) return;
      setUser(vpsUser ? toUser(vpsUser) : null);
      setProfile(vpsUser ? toProfile(vpsUser) : null);
      setRoles(vpsUser ? toRoles(vpsUser) : []);
      setSubscription(vpsUser ? toSubscription(vpsUser) : null);
      setIsDemo(!!vpsUser?.isDemo);
      setMenuMode(vpsUser?.menuMode === "simple" ? "simple" : "advanced");
      setPlanFeatures(vpsUser?.planFeatures ?? null);
      setSaPermissions(vpsUser?.saPermissions ?? null);
    };

    const initializeVps = async () => {
      setLoading(true);
      try {
        const me = await vpsAuthApi.me();
        if (me) {
          // Fresh data from server — always authoritative
          if (!vpsTokenStore.user) vpsTokenStore.setUser(me);
          applyVpsUser(me);
        } else if (vpsTokenStore.access) {
          // Server returned null with a token present → token is invalid; clear it
          vpsTokenStore.clear();
          applyVpsUser(null);
        } else {
          // No token at all → unauthenticated
          applyVpsUser(null);
        }
      } catch (err) {
        // Network error: fall back to stale localStorage so user stays logged in
        subLog.warn("VPS auth init error (network?):", err);
        applyVpsUser(resolveVpsUser());
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    const onAuthChange = () => applyVpsUser(resolveVpsUser());

    const onStorage = (e: StorageEvent) => {
      if (e.key === "vps.accessToken" || e.key === "vps.refreshToken" || e.key === "vps.user") {
        applyVpsUser(vpsTokenStore.user);
      }
    };

    const onFocus = async () => {
      if (!vpsTokenStore.access) return;
      try {
        const me = await vpsAuthApi.me();
        if (me) applyVpsUser(me);
      } catch (err) {
        subLog.warn("VPS me() refresh on focus failed:", err);
      }
    };

    initializeVps();
    window.addEventListener("vps-auth-change", onAuthChange);
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    const intervalId = window.setInterval(onFocus, 60_000);

    return () => {
      isMounted = false;
      window.removeEventListener("vps-auth-change", onAuthChange);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
      window.clearInterval(intervalId);
    };
  }, []);

  const signOut = async () => {
    saImpersonation.clear();
    await vpsAuthApi.logout();
    setUser(null);
    setProfile(null);
    setRoles([]);
    setSubscription(null);
    setPlanFeatures(null);
    setSaPermissions(null);
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
        planFeatures,
        accessLevel,
        isSuperAdmin,
        isSaEmployee,
        isDealerAdmin,
        saPermissions,
        isDemo,
        menuMode,
        loading,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
