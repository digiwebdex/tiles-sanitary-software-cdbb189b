import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BellRing,
  MessageSquare,
  Mail,
  Phone,
  Send,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  fetchReminderSettings,
  updateReminderSettings,
  fetchUpcomingExpiries,
  runReminders,
  sendReminderToDealer,
  type ReminderSettings,
} from "@/services/reminderService";

function ChannelPill({
  label,
  icon: Icon,
  configured,
}: {
  label: string;
  icon: typeof Phone;
  configured: boolean;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <span className="font-medium">{label}</span>
      {configured ? (
        <Badge variant="default" className="gap-1">
          <CheckCircle2 className="h-3 w-3" /> Configured
        </Badge>
      ) : (
        <Badge variant="secondary" className="gap-1 text-amber-600">
          <AlertTriangle className="h-3 w-3" /> Not set up
        </Badge>
      )}
    </div>
  );
}

export default function SARemindersPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [days, setDays] = useState(7);

  const settingsQ = useQuery({
    queryKey: ["sa", "reminders", "settings"],
    queryFn: fetchReminderSettings,
  });
  const upcomingQ = useQuery({
    queryKey: ["sa", "reminders", "upcoming", days],
    queryFn: () => fetchUpcomingExpiries(days),
  });

  const settings = settingsQ.data?.settings;
  const channels = settingsQ.data?.channels;

  const saveM = useMutation({
    mutationFn: (patch: Partial<ReminderSettings>) => updateReminderSettings(patch),
    onSuccess: (data) => {
      qc.setQueryData(["sa", "reminders", "settings"], data);
      toast({ title: "Saved", description: "Reminder settings updated." });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const runM = useMutation({
    mutationFn: runReminders,
    onSuccess: (r) => {
      toast({
        title: "Reminder run complete",
        description: `Scanned ${r.scanned} · Sent ${r.sent} · Skipped ${r.skipped} · Failed ${r.failed}`,
      });
      qc.invalidateQueries({ queryKey: ["sa", "reminders", "upcoming"] });
    },
    onError: (e: Error) => toast({ title: "Run failed", description: e.message, variant: "destructive" }),
  });

  const sendOneM = useMutation({
    mutationFn: (dealerId: string) => sendReminderToDealer(dealerId),
    onSuccess: (r) => {
      if (r.ok) {
        const ch = [r.sms && "SMS", r.whatsapp && "WhatsApp", r.email && "Email"].filter(Boolean).join(", ");
        toast({ title: "Reminder sent", description: `Delivered via ${ch || "—"}.` });
      } else {
        toast({ title: "Not sent", description: r.message || "All channels failed.", variant: "destructive" });
      }
      qc.invalidateQueries({ queryKey: ["sa", "reminders", "upcoming"] });
    },
    onError: (e: Error) => toast({ title: "Send failed", description: e.message, variant: "destructive" }),
  });

  const toggle = (key: keyof ReminderSettings, value: boolean) =>
    saveM.mutate({ [key]: value } as Partial<ReminderSettings>);

  const rows = upcomingQ.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <BellRing className="h-6 w-6 text-primary" /> Expiry Reminders
          </h1>
          <p className="text-muted-foreground text-sm">
            Auto-notify dealers {settings?.days_before ?? 2} day
            {(settings?.days_before ?? 2) === 1 ? "" : "s"} before their subscription expires.
          </p>
        </div>
        <Button onClick={() => runM.mutate()} disabled={runM.isPending}>
          <Send className="mr-2 h-4 w-4" />
          {runM.isPending ? "Running…" : "Run reminders now"}
        </Button>
      </div>

      {/* Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reminder Settings</CardTitle>
          <CardDescription>
            Channels send only when both the toggle is on and credentials are configured on the server.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label className="text-sm font-medium">Auto reminders enabled</Label>
              <p className="text-xs text-muted-foreground">Master switch for the daily cron run.</p>
            </div>
            <Switch
              checked={!!settings?.enabled}
              onCheckedChange={(v) => toggle("enabled", v)}
              disabled={settingsQ.isLoading || saveM.isPending}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {/* SMS */}
            <div className="rounded-lg border p-3 space-y-3">
              <ChannelPill label="SMS" icon={Phone} configured={!!channels?.sms} />
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Send via SMS</span>
                <Switch
                  checked={!!settings?.sms_enabled}
                  onCheckedChange={(v) => toggle("sms_enabled", v)}
                  disabled={saveM.isPending}
                />
              </div>
            </div>
            {/* WhatsApp */}
            <div className="rounded-lg border p-3 space-y-3">
              <ChannelPill label="WhatsApp" icon={MessageSquare} configured={!!channels?.whatsapp} />
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Send via WhatsApp</span>
                <Switch
                  checked={!!settings?.whatsapp_enabled}
                  onCheckedChange={(v) => toggle("whatsapp_enabled", v)}
                  disabled={saveM.isPending}
                />
              </div>
            </div>
            {/* Email */}
            <div className="rounded-lg border p-3 space-y-3">
              <ChannelPill label="Email" icon={Mail} configured={!!channels?.email} />
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Send via Email</span>
                <Switch
                  checked={!!settings?.email_enabled}
                  onCheckedChange={(v) => toggle("email_enabled", v)}
                  disabled={saveM.isPending}
                />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Label htmlFor="days_before" className="text-sm">Days before expiry</Label>
            <Input
              id="days_before"
              type="number"
              min={0}
              max={30}
              className="w-24"
              defaultValue={settings?.days_before ?? 2}
              key={settings?.days_before}
              onBlur={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n !== settings?.days_before) saveM.mutate({ days_before: n });
              }}
              disabled={saveM.isPending}
            />
            <span className="text-xs text-muted-foreground">
              Reminder fires this many days before the subscription end date.
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Upcoming expiries */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Upcoming Expiries</CardTitle>
            <CardDescription>Active dealer subscriptions ending within the window.</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="window" className="text-xs">Next</Label>
            <Input
              id="window"
              type="number"
              min={1}
              max={60}
              className="w-20"
              value={days}
              onChange={(e) => setDays(Math.max(1, Math.min(60, Number(e.target.value) || 7)))}
            />
            <span className="text-xs text-muted-foreground">days</span>
            <Button
              variant="outline"
              size="icon"
              onClick={() => upcomingQ.refetch()}
              disabled={upcomingQ.isFetching}
            >
              <RefreshCw className={`h-4 w-4 ${upcomingQ.isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {upcomingQ.isLoading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No subscriptions expiring in the next {days} days.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dealer</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="text-center">Days left</TableHead>
                  <TableHead className="text-center">Reminded</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.subscription_id}>
                    <TableCell className="font-medium">
                      {r.business_name}
                      {r.owner_name && (
                        <div className="text-xs text-muted-foreground">{r.owner_name}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.plan_name ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <div>{r.owner_phone ?? "—"}</div>
                      <div>{r.owner_email ?? ""}</div>
                    </TableCell>
                    <TableCell>{r.end_date}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant={r.days_left <= 2 ? "destructive" : "secondary"}>
                        {r.days_left <= 0 ? "today" : `${r.days_left}d`}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      {r.reminder_sent ? (
                        <CheckCircle2 className="h-4 w-4 text-green-600 inline" />
                      ) : (
                        <XCircle className="h-4 w-4 text-muted-foreground inline" />
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => sendOneM.mutate(r.dealer_id)}
                        disabled={sendOneM.isPending}
                      >
                        <Send className="mr-1 h-3 w-3" /> Send now
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
