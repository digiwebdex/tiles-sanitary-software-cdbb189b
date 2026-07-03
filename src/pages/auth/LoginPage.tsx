import { useState, useRef } from "react";
import { Navigate, Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { authBridge } from "@/lib/authBridge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { LogIn, ArrowLeft, ShieldAlert, Lock, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

const LoginPage = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [step, setStep] = useState<"credentials" | "totp">("credentials");
  const [loading, setLoading] = useState(false);
  const [lockInfo, setLockInfo] = useState<{
    locked: boolean;
    remaining_attempts?: number;
    remaining_minutes?: number;
  } | null>(null);
  const { toast } = useToast();
  const totpRef = useRef<HTMLInputElement>(null);

  if (!authLoading && user) {
    const vpsUser = authBridge.getCurrentVpsUser();
    return <Navigate to={vpsUser?.roles.includes("super_admin") ? "/super-admin" : "/dashboard"} replace />;
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (step === "credentials") {
        // Pre-login lock check (only for non-SA, but we don't know role yet)
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
      }

      const result = await authBridge.signIn(
        email.trim(),
        password,
        step === "totp" ? totpCode.trim() : undefined,
      );

      if (result.totpRequired) {
        // Password OK — need TOTP
        setStep("totp");
        setLoading(false);
        setTimeout(() => totpRef.current?.focus(), 100);
        return;
      }

      if (!result.success) {
        const lock = result.lock ?? { locked: false };
        if (lock.locked) {
          setLockInfo({ locked: true, remaining_minutes: lock.remaining_minutes ?? 30 });
          toast({
            variant: "destructive",
            title: "অ্যাকাউন্ট লক!",
            description: "৩ বার ভুল পাসওয়ার্ড দেওয়ায় অ্যাকাউন্ট ৩০ মিনিটের জন্য লক হয়েছে।",
          });
        } else if (result.code === "TOTP_INVALID") {
          toast({
            variant: "destructive",
            title: "ভুল কোড",
            description: "Authenticator app-এর কোড ভুল হয়েছে। আবার চেষ্টা করুন।",
          });
          setTotpCode("");
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
        const vpsUser = authBridge.getCurrentVpsUser();
        const target = vpsUser?.roles.includes("super_admin") ? "/super-admin" : "/dashboard";
        window.setTimeout(() => navigate(target, { replace: true }), 0);
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
            <CardTitle className="text-2xl">
              {step === "totp" ? "Two-Factor Authentication" : "Sign In"}
            </CardTitle>
            <CardDescription>
              {step === "totp"
                ? "Google Authenticator অ্যাপ থেকে ৬-সংখ্যার কোড দিন"
                : "Enter your credentials to access the ERP"}
            </CardDescription>
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

            {!isLocked && lockInfo && !lockInfo.locked && (lockInfo.remaining_attempts ?? 3) <= 2 && step === "credentials" && (
              <Alert className="mb-4 border-orange-500/50 bg-orange-500/10">
                <ShieldAlert className="h-4 w-4 text-orange-500" />
                <AlertDescription className="text-orange-600 dark:text-orange-400">
                  সতর্কতা: আর মাত্র {lockInfo.remaining_attempts} বার চেষ্টা বাকি আছে।
                </AlertDescription>
              </Alert>
            )}

            {step === "totp" && (
              <Alert className="mb-4 border-blue-500/50 bg-blue-500/10">
                <ShieldCheck className="h-4 w-4 text-blue-500" />
                <AlertDescription className="text-blue-700 dark:text-blue-300">
                  পাসওয়ার্ড সঠিক। এখন Google Authenticator কোড দিন।
                </AlertDescription>
              </Alert>
            )}

            <form onSubmit={handleLogin} className="space-y-4">
              {step === "credentials" ? (
                <>
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
                </>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="totp">Authenticator Code</Label>
                  <Input
                    id="totp"
                    ref={totpRef}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    placeholder="000000"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                    required
                    autoComplete="one-time-code"
                    className="text-center text-xl tracking-widest font-mono"
                  />
                  <p className="text-xs text-muted-foreground text-center">
                    Google Authenticator → TilesERP Super Admin
                  </p>
                </div>
              )}

              <Button type="submit" className="w-full" disabled={loading || isLocked}>
                <LogIn className="mr-2 h-4 w-4" />
                {loading
                  ? step === "totp" ? "Verifying…" : "Signing in…"
                  : isLocked
                  ? "Account Locked"
                  : step === "totp"
                  ? "Verify Code"
                  : "Sign In"}
              </Button>

              {step === "totp" && (
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full text-sm"
                  onClick={() => { setStep("credentials"); setTotpCode(""); }}
                >
                  ← পাসওয়ার্ড পরিবর্তন করুন
                </Button>
              )}
            </form>

            {step === "credentials" && (
              <div className="mt-4 flex items-center justify-center gap-1 text-xs text-muted-foreground">
                <ShieldAlert className="h-3 w-3" />
                <span>৩ বার ভুল পাসওয়ার্ড দিলে অ্যাকাউন্ট ৩০ মিনিটের জন্য লক হবে</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default LoginPage;
