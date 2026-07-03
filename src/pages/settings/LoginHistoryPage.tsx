import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

interface LoginRow { name: string; email: string; login_at: string; active: boolean; expires_at: string; revoked_at: string | null; }
interface FailedRow { email: string; ip_address: string | null; attempted_at: string; is_locked: boolean; }

const fmt = (d?: string) => (d ? new Date(d).toLocaleString() : "—");

const LoginHistoryPage = () => {
  const { data, isLoading } = useQuery({
    queryKey: ["login-history"],
    queryFn: async () => {
      const res = await vpsAuthedFetch("/api/team/login-history");
      if (!res.ok) throw new Error("Failed to load login history");
      return res.json() as Promise<{ logins: LoginRow[]; failed: FailedRow[] }>;
    },
  });

  return (
    <div className="container mx-auto max-w-4xl space-y-6 p-6">
      <Link to="/settings" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Settings
      </Link>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" /> Recent Logins</CardTitle>
          <CardDescription>The last 50 sign-ins to your account (all staff).</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? <p className="text-muted-foreground">Loading…</p> : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow><TableHead>User</TableHead><TableHead>Login time</TableHead><TableHead>Session</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.logins ?? []).length === 0 ? (
                    <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">No logins yet</TableCell></TableRow>
                  ) : data!.logins.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell><div className="font-medium">{r.name}</div><div className="text-xs text-muted-foreground">{r.email}</div></TableCell>
                      <TableCell>{fmt(r.login_at)}</TableCell>
                      <TableCell>
                        {r.active
                          ? <Badge variant="default" className="text-xs">Active</Badge>
                          : <Badge variant="secondary" className="text-xs">{r.revoked_at ? "Logged out" : "Expired"}</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Failed Attempts &amp; Lockouts</CardTitle>
          <CardDescription>Recent failed sign-in attempts — watch for unfamiliar activity.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Email</TableHead><TableHead>IP</TableHead><TableHead>Time</TableHead><TableHead>Status</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {(data?.failed ?? []).length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No failed attempts 🎉</TableCell></TableRow>
                ) : data!.failed.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell>{r.email}</TableCell>
                    <TableCell className="text-xs">{r.ip_address || "—"}</TableCell>
                    <TableCell>{fmt(r.attempted_at)}</TableCell>
                    <TableCell>{r.is_locked ? <Badge variant="destructive" className="text-xs">Locked</Badge> : <Badge variant="outline" className="text-xs">Failed</Badge>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default LoginHistoryPage;
