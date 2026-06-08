/**
 * VPS auth HTTP client.
 *
 * Owns:
 *   - access + refresh token storage in localStorage
 *   - automatic refresh on 401 (single-flight, no parallel races)
 *   - typed wrappers for the /api/auth endpoints
 *
 * Used exclusively via authBridge — never imported by features/services
 * directly (so the Phase 1 backend toggle stays clean).
 */
import { env } from "./env";

const ACCESS_KEY = "vps.accessToken";
const REFRESH_KEY = "vps.refreshToken";
const USER_KEY = "vps.user";

export interface VpsUser {
  userId: string;
  email: string;
  dealerId: string | null;
  roles: string[];
  isDemo?: boolean;
  subscription?: {
    id: string;
    planId: string;
    status: "active" | "expired" | "suspended";
    startDate: string;
    endDate: string | null;
  } | null;
}

export interface LockStatus {
  locked: boolean;
  remaining_minutes?: number;
  remaining_attempts?: number;
}

export interface VpsAuthError extends Error {
  code?: string;
  status?: number;
  lock?: LockStatus;
}

function makeError(message: string, status: number, body: any): VpsAuthError {
  const err = new Error(message) as VpsAuthError;
  err.status = status;
  err.code = body?.code;
  err.lock = body?.lock;
  return err;
}

// ── Token store ───────────────────────────────────────────────────────────

function notifyAuthChanged() {
  try {
    window.dispatchEvent(new Event("vps-auth-change"));
  } catch {
    /* non-browser context */
  }
}

/** Decode JWT access token payload (client-side; backend still verifies signatures). */
export function userFromAccessToken(): VpsUser | null {
  const token = vpsTokenStore.access;
  if (!token) return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
    const payload = JSON.parse(atob(b64 + pad)) as Record<string, unknown>;
    if (!payload.userId) return null;
    return {
      userId: String(payload.userId),
      email: String(payload.email ?? ""),
      dealerId: (payload.dealerId as string | null) ?? null,
      roles: Array.isArray(payload.roles) ? (payload.roles as string[]) : [],
      isDemo: !!payload.isDemo,
      subscription: (payload.subscription as VpsUser["subscription"]) ?? null,
    };
  } catch {
    return null;
  }
}

/** Best-effort user snapshot: localStorage → JWT decode. */
export function resolveVpsUser(): VpsUser | null {
  return vpsTokenStore.user ?? userFromAccessToken();
}

export const vpsTokenStore = {
  get access(): string | null {
    try { return localStorage.getItem(ACCESS_KEY); } catch { return null; }
  },
  get refresh(): string | null {
    try { return localStorage.getItem(REFRESH_KEY); } catch { return null; }
  },
  get user(): VpsUser | null {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? (JSON.parse(raw) as VpsUser) : null;
    } catch {
      return null;
    }
  },
  set(tokens: { accessToken: string; refreshToken: string; user: VpsUser }) {
    try {
      localStorage.setItem(ACCESS_KEY, tokens.accessToken);
      localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
      localStorage.setItem(USER_KEY, JSON.stringify(tokens.user));
      notifyAuthChanged();
    } catch {
      /* ignore quota errors */
    }
  },
  clear() {
    try {
      localStorage.removeItem(ACCESS_KEY);
      localStorage.removeItem(REFRESH_KEY);
      localStorage.removeItem(USER_KEY);
      notifyAuthChanged();
    } catch {
      /* ignore */
    }
  },
  /** Persist user snapshot while keeping existing tokens. */
  setUser(user: VpsUser) {
    try {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      notifyAuthChanged();
    } catch {
      /* ignore quota errors */
    }
  },
};

// ── Single-flight refresh ─────────────────────────────────────────────────

let refreshInFlight: Promise<void> | null = null;

async function performRefresh(): Promise<void> {
  const refreshToken = vpsTokenStore.refresh;
  if (!refreshToken) throw makeError("No refresh token", 401, { code: "NO_REFRESH" });

  const res = await fetch(`${env.VPS_API_BASE}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    vpsTokenStore.clear();
    throw makeError(body.error || "Refresh failed", res.status, body);
  }

  vpsTokenStore.set({
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    user: body.user,
  });
}

function refreshOnce(): Promise<void> {
  if (!refreshInFlight) {
    refreshInFlight = performRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

// ── Authed fetch with auto-refresh ────────────────────────────────────────

async function rawFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  const access = vpsTokenStore.access;
  if (access) headers.set("Authorization", `Bearer ${access}`);

  return fetch(`${env.VPS_API_BASE}${path}`, { ...init, headers });
}

async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  let res = await rawFetch(path, init);
  if (res.status !== 401) return res;

  // Try refresh once, then retry original request once.
  try {
    await refreshOnce();
  } catch {
    return res; // refresh failed → return original 401
  }
  res = await rawFetch(path, init);
  return res;
}

// ── Public API ────────────────────────────────────────────────────────────

export const vpsAuthApi = {
  async getLockStatus(email: string): Promise<LockStatus> {
    const res = await fetch(
      `${env.VPS_API_BASE}/api/auth/lock-status?email=${encodeURIComponent(email)}`,
    );
    if (!res.ok) return { locked: false };
    return (await res.json()) as LockStatus;
  },

  async login(email: string, password: string) {
    const res = await fetch(`${env.VPS_API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw makeError(body.error || "Login failed", res.status, body);

    vpsTokenStore.set({
      accessToken: body.accessToken,
      refreshToken: body.refreshToken,
      user: body.user,
    });
    return body.user as VpsUser;
  },

  /**
   * Self-signup. Returns the new dealer/user IDs but does NOT store any
   * tokens — the backend creates the account in 'pending' state and the
   * user must wait for Super Admin approval before they can log in.
   * The success screen surfaces the awaiting-approval message.
   */
  async register(input: {
    name: string;
    business_name: string;
    phone: string;
    email: string;
    password: string;
  }): Promise<{ pending: true; userId: string; dealerId: string; message?: string }> {
    const res = await fetch(`${env.VPS_API_BASE}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw makeError(body.error || "Signup failed", res.status, body);

    return {
      pending: true,
      userId: body.user_id,
      dealerId: body.dealer_id,
      message: body.message,
    };
  },

  async logout(): Promise<void> {
    const refreshToken = vpsTokenStore.refresh;
    try {
      if (refreshToken) {
        await fetch(`${env.VPS_API_BASE}/api/auth/logout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        });
      }
    } catch {
      /* network errors during logout are non-fatal */
    } finally {
      vpsTokenStore.clear();
    }
  },

  async me(): Promise<VpsUser | null> {
    const res = await authedFetch("/api/auth/me");
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    const user = (body?.user as VpsUser) ?? null;
    // Keep localStorage user in sync — services read vpsTokenStore.user
    // via getAuthenticatedDealerId() outside React context.
    if (user) {
      vpsTokenStore.setUser(user);
    }
    return user;
  },

  async requestPasswordReset(email: string): Promise<void> {
    await fetch(`${env.VPS_API_BASE}/api/auth/password-reset/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
  },

  async confirmPasswordReset(token: string, password: string): Promise<void> {
    const res = await fetch(`${env.VPS_API_BASE}/api/auth/password-reset/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw makeError(body.error || "Reset failed", res.status, body);
    }
  },
};

export { authedFetch as vpsAuthedFetch };
