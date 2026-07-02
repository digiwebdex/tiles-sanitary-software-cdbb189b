import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";
import {
  Bell, Shield, Mail, MessageSquare, Phone, Play, RefreshCw,
  ExternalLink, CheckCircle2, XCircle, Clock, Zap, Database,
  Globe, Key, ChevronRight, Eye, EyeOff, Lock,
} from "lucide-react";

async function vpsJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await vpsAuthedFetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as any)?.error || `Request failed (${res.status})`);
  return body as T;
}

// ── Channel status dot ─────────────────────────────────────────────────────────
function StatusDot({ ok }: { ok: boolean }) {
  return ok
    ? <CheckCircle2 className="h-4 w-4 text-green-500" />
    : <XCircle className="h-4 w-4 text-red-400" />;
}

// ── Section wrapper ────────────────────────────────────────────────────────────
function Section({ title, description, icon: Icon, children }: {
  title: string; description?: string; icon: React.ElementType; children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <Icon className="h-4 w-4 text-primary" />
          </div>
          <div>
            <CardTitle className="text-base">{title}</CardTitle>
            {description && <CardDescription className="text-xs mt-0.5">{description}</CardDescription>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
const SASettingsPage = () => {
  const { toast } = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { profile } = useAuth();

  // ── Password change ──────────────────────────────────────────────────────────
  const [pwForm, setPwForm] = useState({ current: "", next: "", confirm: "" });
  const [showPw, setShowPw] = useState({ current: false, next: false, confirm: false });

  const passwordMutation = useMutation({
    mutationFn: async () => {
      if (pwForm.next.length < 8) throw new Error("New password must be at least 8 characters");
      if (pwForm.next !== pwForm.confirm) throw new Error("New passwords do not match");
      await vpsJson("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ current_password: pwForm.current, new_password: pwForm.next }),
      });
    },
    onSuccess: () => {
      toast({ title: "Password changed successfully" });
      setPwForm({ current: "", next: "", confirm: "" });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Error", description: e.message }),
  });

  // ── Reminder settings ────────────────────────────────────────────────────────
  const { data: reminderData, isLoading: reminderLoading } = useQuery({
    queryKey: ["sa-reminder-settings"],
    queryFn: () => vpsJson<{
      settings: {
        enabled: boolean; days_before: number;
        sms_enabled: boolean; whatsapp_enabled: boolean; email_enabled: boolean;
      };
      channels: { sms: boolean; whatsapp: boolean; email: boolean };
    }>("/api/admin/reminders/settings"),
  });

  const reminderMutation = useMutation({
    mutationFn: (patch: Record<string, any>) =>
      vpsJson("/api/admin/reminders/settings", { method: "PUT", body: JSON.stringify(patch) }),
    onSuccess: () => {
      toast({ title: "Reminder settings saved" });
      qc.invalidateQueries({ queryKey: ["sa-reminder-settings"] });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Error", description: e.message }),
  });

  const s = reminderData?.settings;
  const ch = reminderData?.channels;

  // ── Run cron jobs manually ───────────────────────────────────────────────────
  const [cronRunning, setCronRunning] = useState<string | null>(null);

  const runCron = async (endpoint: string, label: string) => {
    setCronRunning(endpoint);
    try {
      const res = await vpsAuthedFetch(`/api/admin/cron/${endpoint}`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as any)?.error || "Failed");
      toast({ title: `${label} completed`, description: `Scanned: ${(body as any).scanned ?? "—"}, Processed: ${(body as any).sent ?? (body as any).expired ?? "—"}` });
    } catch (e: any) {
      toast({ variant: "destructive", title: `${label} failed`, description: e.message });
    } finally {
      setCronRunning(null);
    }
  };

  // ── Platform info ────────────────────────────────────────────────────────────
  const { data: systemStats } = useQuery({
    queryKey: ["sa-system-stats"],
    queryFn: () => vpsJson<{ totalDealers: number; activeSubs: number; totalUsers: number }>("/api/admin/system-stats"),
  });

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Platform-wide configuration and controls</p>
      </div>

      {/* ── Notification Channels ── */}
      <Section title="Notification Channels" description="Status of SMS, WhatsApp and Email integrations" icon={Bell}>
        {reminderLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              {[
                { key: "sms", label: "SMS (BulkSMSBD)", icon: Phone, ok: ch?.sms },
                { key: "whatsapp", label: "WhatsApp (Wasender)", icon: MessageSquare, ok: ch?.whatsapp },
                { key: "email", label: "Email (Gmail SMTP)", icon: Mail, ok: ch?.email },
              ].map(({ key, label, icon: Icon, ok }) => (
                <div key={key} className={`rounded-lg border p-3 flex flex-col gap-2 ${ok ? "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/20" : "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20"}`}>
                  <div className="flex items-center justify-between">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <StatusDot ok={!!ok} />
                  </div>
                  <p className="text-xs font-medium leading-tight">{label}</p>
                  <Badge variant={ok ? "default" : "destructive"} className={`text-[10px] w-fit ${ok ? "bg-green-600" : ""}`}>
                    {ok ? "Connected" : "Not configured"}
                  </Badge>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              API credentials are set in the server <code className="bg-muted px-1 rounded">.env</code> file.
            </p>
          </div>
        )}
      </Section>

      {/* ── Expiry Reminders ── */}
      <Section title="Expiry Reminder Settings" description="Auto-send reminders when subscriptions are about to expire" icon={Clock}>
        {reminderLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-4">
            {/* Master toggle */}
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Automatic Reminders</p>
                <p className="text-xs text-muted-foreground">Send reminders on the scheduled cron</p>
              </div>
              <Switch
                checked={s?.enabled ?? false}
                onCheckedChange={(v) => reminderMutation.mutate({ enabled: v })}
                disabled={reminderMutation.isPending}
              />
            </div>

            {/* Days before */}
            <div className="grid grid-cols-2 gap-4 items-end">
              <div className="space-y-1.5">
                <Label className="text-xs">Days before expiry to remind</Label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    min="1"
                    max="30"
                    defaultValue={s?.days_before ?? 3}
                    key={s?.days_before}
                    className="h-8 text-sm w-24"
                    onBlur={(e) => {
                      const v = parseInt(e.target.value);
                      if (v >= 1 && v <= 30) reminderMutation.mutate({ days_before: v });
                    }}
                  />
                  <span className="text-xs text-muted-foreground self-end pb-2">days</span>
                </div>
              </div>
            </div>

            {/* Channel toggles */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Active channels</p>
              {[
                { field: "sms_enabled", label: "SMS", icon: Phone, configured: ch?.sms },
                { field: "whatsapp_enabled", label: "WhatsApp", icon: MessageSquare, configured: ch?.whatsapp },
                { field: "email_enabled", label: "Email", icon: Mail, configured: ch?.email },
              ].map(({ field, label, icon: Icon, configured }) => (
                <div key={field} className="flex items-center justify-between py-1.5">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">{label}</span>
                    {!configured && <Badge variant="outline" className="text-[10px] text-yellow-600 border-yellow-400">Not configured</Badge>}
                  </div>
                  <Switch
                    checked={s?.[field as keyof typeof s] as boolean ?? false}
                    onCheckedChange={(v) => reminderMutation.mutate({ [field]: v })}
                    disabled={reminderMutation.isPending || !configured}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>

      {/* ── Cron Jobs ── */}
      <Section title="Cron Jobs" description="Manually trigger scheduled tasks" icon={Zap}>
        <div className="space-y-2">
          {[
            { endpoint: "expire-trials", label: "Expire Overdue Trials", desc: "Mark expired trials + send WhatsApp renewal notice" },
            { endpoint: "trial-reminders", label: "Trial Reminders (Day 5 + 7)", desc: "Send SMS/Email to trials expiring in 2 days or today" },
            { endpoint: "trial-day5-reminders", label: "Trial Day 5 Reminder", desc: "Send to trials expiring in exactly 2 days" },
            { endpoint: "trial-day7-reminders", label: "Trial Day 7 Reminder", desc: "Send to trials expiring today" },
          ].map(({ endpoint, label, desc }) => (
            <div key={endpoint} className="flex items-center justify-between rounded-lg border px-4 py-3">
              <div>
                <p className="text-sm font-medium">{label}</p>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs shrink-0 ml-4"
                disabled={cronRunning !== null}
                onClick={() => runCron(endpoint, label)}
              >
                {cronRunning === endpoint ? (
                  <RefreshCw className="mr-1.5 h-3 w-3 animate-spin" />
                ) : (
                  <Play className="mr-1.5 h-3 w-3" />
                )}
                Run Now
              </Button>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          These run automatically every night at midnight via system cron.
        </p>
      </Section>

      {/* ── Security ── */}
      <Section title="Security" description="Authentication and access control" icon={Shield}>
        <div className="space-y-2">
          <div
            className="flex items-center justify-between rounded-lg border px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
            onClick={() => navigate("/super-admin/totp-setup")}
          >
            <div className="flex items-center gap-3">
              <Key className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Two-Factor Authentication (2FA)</p>
                <p className="text-xs text-muted-foreground">Google Authenticator / TOTP for super admin login</p>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </div>
          <div
            className="flex items-center justify-between rounded-lg border px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
            onClick={() => navigate("/super-admin/audit")}
          >
            <div className="flex items-center gap-3">
              <Shield className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Audit Trail</p>
                <p className="text-xs text-muted-foreground">All admin actions logged with timestamps</p>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </div>
        </div>
      </Section>

      {/* ── Password Change ── */}
      <Section title="Change Password" description={`Account: ${profile?.email ?? "super admin"}`} icon={Lock}>
        <div className="space-y-3 max-w-sm">
          {(["current", "next", "confirm"] as const).map((field) => {
            const labels = { current: "Current Password", next: "New Password", confirm: "Confirm New Password" };
            const placeholders = { current: "Enter current password", next: "Min. 8 characters", confirm: "Re-enter new password" };
            return (
              <div key={field} className="space-y-1.5">
                <Label className="text-xs">{labels[field]}</Label>
                <div className="relative">
                  <Input
                    type={showPw[field] ? "text" : "password"}
                    placeholder={placeholders[field]}
                    value={pwForm[field]}
                    onChange={(e) => setPwForm((f) => ({ ...f, [field]: e.target.value }))}
                    className="pr-9 h-9 text-sm"
                    autoComplete={field === "current" ? "current-password" : "new-password"}
                  />
                  <button
                    type="button"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowPw((s) => ({ ...s, [field]: !s[field] }))}
                  >
                    {showPw[field] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            );
          })}

          {/* Strength indicator */}
          {pwForm.next.length > 0 && (
            <div className="space-y-1">
              <div className="flex gap-1">
                {[1, 2, 3, 4].map((i) => {
                  const strength = [
                    pwForm.next.length >= 8,
                    /[A-Z]/.test(pwForm.next),
                    /[0-9]/.test(pwForm.next),
                    /[^A-Za-z0-9]/.test(pwForm.next),
                  ].filter(Boolean).length;
                  return (
                    <div
                      key={i}
                      className={`h-1 flex-1 rounded-full transition-colors ${
                        i <= strength
                          ? strength <= 1 ? "bg-red-500" : strength <= 2 ? "bg-yellow-500" : strength <= 3 ? "bg-blue-500" : "bg-green-500"
                          : "bg-muted"
                      }`}
                    />
                  );
                })}
              </div>
              <p className="text-[10px] text-muted-foreground">
                Strong password: 8+ chars, uppercase, number, special character
              </p>
            </div>
          )}

          {pwForm.confirm.length > 0 && pwForm.next !== pwForm.confirm && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <XCircle className="h-3 w-3" /> Passwords do not match
            </p>
          )}

          <Button
            className="w-full h-9"
            onClick={() => passwordMutation.mutate()}
            disabled={
              passwordMutation.isPending ||
              !pwForm.current ||
              pwForm.next.length < 8 ||
              pwForm.next !== pwForm.confirm
            }
          >
            {passwordMutation.isPending ? (
              <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Key className="mr-2 h-3.5 w-3.5" />
            )}
            Update Password
          </Button>
        </div>
      </Section>

      {/* ── Platform ── */}
      <Section title="Platform" description="System-wide links and stats" icon={Globe}>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Total Dealers", value: systemStats?.totalDealers ?? "—" },
            { label: "Active Subscriptions", value: systemStats?.activeSubs ?? "—" },
            { label: "Total Users", value: systemStats?.totalUsers ?? "—" },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-lg border p-3 text-center">
              <p className="text-2xl font-bold text-primary">{value}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{label}</p>
            </div>
          ))}
        </div>

        <Separator />

        <div className="space-y-2">
          {[
            { label: "Manage Plans & Pricing", path: "/super-admin/plans", icon: Database },
            { label: "CMS / Landing Page", path: "/super-admin/cms", icon: Globe },
            { label: "Database Backups", path: "/super-admin/backups", icon: Database },
            { label: "Announcements", path: "/super-admin/announcements", icon: Bell },
          ].map(({ label, path, icon: Icon }) => (
            <button
              key={path}
              onClick={() => navigate(path)}
              className="w-full flex items-center justify-between rounded-lg border px-4 py-2.5 text-sm hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center gap-2 text-muted-foreground">
                <Icon className="h-4 w-4" />
                <span className="text-foreground">{label}</span>
              </div>
              <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          ))}
        </div>
      </Section>
    </div>
  );
};

export default SASettingsPage;
