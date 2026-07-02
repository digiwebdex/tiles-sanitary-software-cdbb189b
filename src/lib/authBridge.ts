import { vpsAuthApi, vpsTokenStore, type LockStatus, type VpsUser } from "./vpsAuthClient";

export type { LockStatus, VpsUser };

export interface SignInResult {
  success: boolean;
  totpRequired?: boolean;
  lock?: LockStatus;
  message?: string;
  code?: string;
}

export interface SignUpInput {
  name: string;
  business_name: string;
  phone: string;
  email: string;
  password: string;
  whatsapp_verify_token?: string;
}

export interface SignUpResult {
  success: boolean;
  message?: string;
  code?: string;
}

export const authBridge = {
  backend: "vps" as const,
  isVps: true,

  async getLockStatus(email: string): Promise<LockStatus> {
    return vpsAuthApi.getLockStatus(email);
  },

  async signIn(email: string, password: string, totpCode?: string): Promise<SignInResult> {
    try {
      const result = await vpsAuthApi.login(email.trim(), password, totpCode);
      if ("totpRequired" in result && result.totpRequired) {
        return { success: false, totpRequired: true, lock: { locked: false } };
      }
      return { success: true, lock: { locked: false } };
    } catch (err: any) {
      return {
        success: false,
        code: err.code,
        message: err.message,
        lock: err.lock ?? { locked: false },
      };
    }
  },

  async signOut(): Promise<void> {
    await vpsAuthApi.logout();
  },

  async signUp(input: SignUpInput): Promise<SignUpResult> {
    try {
      await vpsAuthApi.register(input);
      return { success: true };
    } catch (err: any) {
      return { success: false, code: err.code, message: err.message ?? "Signup failed" };
    }
  },

  async requestPasswordReset(email: string): Promise<void> {
    await vpsAuthApi.requestPasswordReset(email.trim());
  },

  async confirmPasswordReset(token: string, password: string): Promise<void> {
    await vpsAuthApi.confirmPasswordReset(token, password);
  },

  getCurrentVpsUser(): VpsUser | null {
    return vpsTokenStore.user;
  },
};
