import { useState } from "react";
import { Navigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Mail, KeyRound, Loader2 } from "lucide-react";
import { PortalAuthProvider, usePortalAuth } from "@/contexts/PortalAuthContext";
import { portalAuthBridge } from "@/lib/portalAuthBridge";
import { env } from "@/lib/env";

function LoginInner() {
  const { user, loading: authLoading } = usePortalAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const vpsPortal = env.PORTAL_BACKEND === "vps";

  if (!authLoading && user) return <Navigate to="/portal/dashboard" replace />;

  const sendMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    try {
      await portalAuthBridge.signInWithOtp(
        email,
        `${window.location.origin}/portal/dashboard`,
      );
      toast({
        title: "Login link sent",
        description: "Check your email for the magic link to sign in.",
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not send link",
        description: (err as Error).message,
      });
    } finally {
      setBusy(false);
    }
  };

  const passwordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await portalAuthBridge.signInWithPassword(email, password);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Login failed",
        description: (err as Error).message,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Customer Portal Login</CardTitle>
          <CardDescription>
            {vpsPortal
              ? "Sign in with the email and password provided by your dealer."
              : "Use the magic-link option for the smoothest sign-in."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {vpsPortal ? (
            <form onSubmit={passwordLogin} className="space-y-3">
              <div>
                <Label htmlFor="pw-email">Email</Label>
                <Input
                  id="pw-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label htmlFor="pw">Password</Label>
                <Input
                  id="pw"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
                Sign in
              </Button>
            </form>
          ) : (
            <Tabs defaultValue="magic" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="magic">
                  <Mail className="h-4 w-4 mr-1.5" /> Magic link
                </TabsTrigger>
                <TabsTrigger value="password">
                  <KeyRound className="h-4 w-4 mr-1.5" /> Password
                </TabsTrigger>
              </TabsList>

              <TabsContent value="magic">
                <form onSubmit={sendMagicLink} className="space-y-3 mt-3">
                  <div>
                    <Label htmlFor="ml-email">Email</Label>
                    <Input
                      id="ml-email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={busy}>
                    {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Mail className="h-4 w-4 mr-1.5" />}
                    Send login link
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="password">
                <form onSubmit={passwordLogin} className="space-y-3 mt-3">
                  <div>
                    <Label htmlFor="pw-email">Email</Label>
                    <Input
                      id="pw-email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="pw">Password</Label>
                    <Input
                      id="pw"
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={busy}>
                    {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
                    Sign in
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function PortalLoginPage() {
  return (
    <PortalAuthProvider>
      <LoginInner />
    </PortalAuthProvider>
  );
}
