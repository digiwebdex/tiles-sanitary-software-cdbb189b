import { vpsAuthApi, userFromAccessToken, vpsTokenStore, type VpsUser } from "@/lib/vpsAuthClient";

export interface PortalSessionUser {
  id: string;
  email: string;
}

export const portalAuthBridge = {
  isVps: true,

  getSessionUser(): PortalSessionUser | null {
    const u: VpsUser | null = vpsTokenStore.user ?? userFromAccessToken();
    if (!u?.userId) return null;
    return { id: u.userId, email: u.email };
  },

  async signInWithPassword(email: string, password: string) {
    await vpsAuthApi.login(email.trim(), password);
  },

  async signInWithOtp(_email: string, _redirectTo: string) {
    throw new Error("Magic link login is not supported. Please use email and password.");
  },

  async signOut() {
    await vpsAuthApi.logout();
  },

  onAuthStateChange(callback: (session: { user: { id: string; email: string } } | null) => void) {
    const handler = () => {
      const u = portalAuthBridge.getSessionUser();
      callback(u ? { user: { id: u.id, email: u.email } } : null);
    };
    window.addEventListener("vps-auth-change", handler);
    handler();
    return () => window.removeEventListener("vps-auth-change", handler);
  },
};
