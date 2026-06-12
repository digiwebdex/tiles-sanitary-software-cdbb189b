import { useState } from "react";
import { Navigate, Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { authBridge } from "@/lib/authBridge";
import { resolveDealerPostLoginPath } from "@/lib/subscriptionAccess";
import type { VpsUser } from "@/lib/vpsAuthClient";

function loginTargetForVpsUser(vpsUser: VpsUser | null): string {
  if (!vpsUser) return "/dashboard";
  const isSuperAdmin = vpsUser.roles.includes("super_admin");
  const isDealerRole = vpsUser.roles.some((r) => r === "dealer_admin" || r === "salesman");
  const sub = vpsUser.subscription
    ? {
        status: vpsUser.subscription.status,
        end_date: vpsUser.subscription.endDate,
      }
    : null;
  return resolveDealerPostLoginPath({ isSuperAdmin, isDealerRole, subscription: sub });
}
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { LogIn, ArrowLeft, ShieldAlert, Lock } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

const LoginPage = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [lockInfo, setLockInfo] = useState<{
    locked: boolean;
    remaining_attempts?: number;
    remaining_minutes?: number;
  } | null>(null);
  const { toast } = useToast();

  // Supabase path: AuthContext drives redirect when Supabase session arrives.
  // VPS path: AuthContext is also hydrated from the stored VPS user, so send
  // users to the correct area instead of leaving them on /login.
  if (!authLoading && user) {
    const vpsUser = authBridge.getCurrentVpsUser();
    return <Navigate to={loginTargetForVpsUser(vpsUser)} replace />;
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setLoading(true);

    try {
      // 1. Pre-login lock check (single source of truth — backend-aware via bridge)
      const lockCheck = await authBridge.getLockStatus(email.trim());
      if (lockCheck.locked) {
        const mins = Math.ceil(lockCheck.remaining_minutes ?? 30);
        setLockInfo({ locked: true, remaining_minutes: mins });
        toast({
          variant: "destructive",
          title: "অ্যাকাউন্ট লক করা হয়েছে",
          description: `অনেকবার ভুল পাসওয়ার্ড দেওয়ায় অ্যাকাউন্ট লক হয়েছে। ${mins} মিনিট পর চেষ্টা করুন।`,
        });
        setLoading(false);
        return;
      }

      // 2. Sign in via bridge (Supabase OR VPS depending on env flag)
      const result = await authBridge.signIn(email.trim(), password);

      if (!result.success) {
        const lock = result.lock ?? { locked: false };
        if (lock.locked) {
          setLockInfo({ locked: true, remaining_minutes: lock.remaining_minutes ?? 30 });
          toast({
            variant: "destructive",
            title: "অ্যাকাউন্ট লক!",
            description: "৩ বার ভুল পাসওয়ার্ড দেওয়ায় অ্যাকাউন্ট ৩০ মিনিটের জন্য লক হয়েছে।",
          });
        } else {
          const remaining = lock.remaining_attempts ?? 0;
          setLockInfo({ locked: false, remaining_attempts: remaining });
          toast({
            variant: "destructive",
            title: "লগইন ব্যর্থ",
            description:
              remaining > 0
                ? `ভুল পাসওয়ার্ড। আর ${remaining} বার চেষ্টা করতে পারবেন।`
                : result.message ?? "Login failed",
          });
        }
      } else {
        setLockInfo(null);

        // Legacy pending-check only applies to the old auth backend. VPS auth
        // already validates user/dealer status server-side during /api/auth/login.
        if (!authBridge.isVps) {
          try {
            const { data: profile } = await import("@/integrations/supabase/client").then(({ supabase }) =>
              supabase.from("profiles").select("dealer_id").eq("email", email.trim().toLowerCase()).maybeSingle()
            );
            if (profile?.dealer_id) {
              const { supabase } = await import("@/integrations/supabase/client");
              const { data: dealer } = await supabase.from("dealers").select("status").eq("id", profile.dealer_id).maybeSingle();
              if (dealer?.status === "pending") {
                await authBridge.signOut();
                toast({
                  variant: "destructive",
                  title: "Awaiting Approval",
                  description: "Your account is pending Super Admin approval. You'll be notified by email once activated.",
                });
                setLoading(false);
                return;
              }
            }
          } catch (checkErr) {
            console.warn("[Login] pending-status check failed:", checkErr);
          }
        }

        // VPS path: route by role immediately after tokens are saved.
        if (authBridge.isVps) {
          const vpsUser = authBridge.getCurrentVpsUser();
          window.setTimeout(() => navigate(loginTargetForVpsUser(vpsUser), { replace: true }), 0);
        }
        // Supabase path: onAuthStateChange will trigger AuthContext + redirect.
      }
    } catch (err) {
      console.error("Login error:", err);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Something went wrong. Please try again.",
      });
    }

    setLoading(false);
  };

  const isLocked = lockInfo?.locked === true;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-4">
        <Link
          to="/"
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to website
        </Link>
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Sign In</CardTitle>
            <CardDescription>Enter your credentials to access the ERP</CardDescription>
          </CardHeader>
          <CardContent>
            {isLocked && (
              <Alert variant="destructive" className="mb-4">
                <Lock className="h-4 w-4" />
                <AlertDescription>
                  অ্যাকাউন্ট লক করা হয়েছে। {Math.ceil(lockInfo?.remaining_minutes ?? 30)} মিনিট পর আবার চেষ্টা করুন।
                </AlertDescription>
              </Alert>
            )}

            {!isLocked && lockInfo && !lockInfo.locked && lockInfo.remaining_attempts !== undefined && lockInfo.remaining_attempts <= 2 && (
              <Alert className="mb-4 border-orange-500/50 bg-orange-500/10">
                <ShieldAlert className="h-4 w-4 text-orange-500" />
                <AlertDescription className="text-orange-600 dark:text-orange-400">
                  সতর্কতা: আর মাত্র {lockInfo.remaining_attempts} বার চেষ্টা বাকি আছে। এরপর অ্যাকাউন্ট লক হয়ে যাবে।
                </AlertDescription>
              </Alert>
            )}

            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  disabled={isLocked}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  disabled={isLocked}
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading || isLocked}>
                <LogIn className="mr-2 h-4 w-4" />
                {loading ? "Signing in…" : isLocked ? "Account Locked" : "Sign In"}
              </Button>
            </form>

            <div className="mt-4 flex items-center justify-center gap-1 text-xs text-muted-foreground">
              <ShieldAlert className="h-3 w-3" />
              <span>৩ বার ভুল পাসওয়ার্ড দিলে অ্যাকাউন্ট ৩০ মিনিটের জন্য লক হবে</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default LoginPage;
