import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { usePortalAuth } from "@/contexts/PortalAuthContext";
import { Loader2 } from "lucide-react";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { vpsAuthApi } from "@/lib/vpsAuthClient";

export default function PortalAccountPage() {
  const { user, context } = usePortalAuth();
  const { toast } = useToast();
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);

  const portalUserData = {
    name: context?.name ?? null,
    phone: context?.phone ?? null,
    portal_role: context?.portal_role ?? null,
    status: context?.status ?? "active",
    last_login_at: context?.last_login_at ?? null,
  };

  const updatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) {
      toast({ variant: "destructive", title: "Password too short", description: "Use at least 8 characters." });
      return;
    }
    setBusy(true);
    try {
      await vpsAuthApi.changePassword(pw);
      toast({ title: "Password updated" });
      setPw("");
    } catch (err) {
      toast({ variant: "destructive", title: "Failed", description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle>My Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Row k="Name" v={portalUserData?.name ?? "—"} />
          <Row k="Email" v={user?.email ?? context?.email ?? "—"} />
          <Row k="Phone" v={portalUserData?.phone ?? "—"} />
          <Row k="Account type" v={portalUserData?.portal_role ?? "—"} />
          <Row k="Status" v={portalUserData?.status ?? "—"} />
          <Row k="Last login" v={portalUserData?.last_login_at ?? "—"} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={updatePassword} className="space-y-3">
            <div>
              <Label htmlFor="newpw">New password</Label>
              <Input
                id="newpw"
                type="password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                minLength={8}
                required
              />
            </div>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
              Update password
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right">{v}</span>
    </div>
  );
}
