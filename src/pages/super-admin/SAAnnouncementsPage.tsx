import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Megaphone, Plus, Trash2, Info, AlertTriangle, AlertOctagon, CheckCircle2, Pencil,
} from "lucide-react";
import { toast } from "sonner";
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";
import { format, parseISO } from "date-fns";

type Severity = "info" | "warning" | "critical" | "success";
type Audience = "all" | "active" | "expiring" | "trial" | "suspended";

interface Announcement {
  id: string;
  title: string;
  body: string;
  severity: Severity;
  audience: Audience;
  is_active: boolean;
  dismissible: boolean;
  created_by_email: string | null;
  created_at: string;
}

const SEVERITY_META: Record<Severity, { icon: any; cls: string; label: string }> = {
  info: { icon: Info, cls: "text-blue-600 bg-blue-100 dark:bg-blue-950", label: "Info" },
  success: { icon: CheckCircle2, cls: "text-emerald-600 bg-emerald-100 dark:bg-emerald-950", label: "Success" },
  warning: { icon: AlertTriangle, cls: "text-amber-600 bg-amber-100 dark:bg-amber-950", label: "Warning" },
  critical: { icon: AlertOctagon, cls: "text-red-600 bg-red-100 dark:bg-red-950", label: "Critical" },
};

const AUDIENCE_LABELS: Record<Audience, string> = {
  all: "All dealers",
  active: "Active subscribers",
  expiring: "Expiring soon (≤7d)",
  trial: "Trial accounts",
  suspended: "Suspended",
};

const EMPTY_FORM = {
  title: "",
  body: "",
  severity: "info" as Severity,
  audience: "all" as Audience,
  is_active: true,
  dismissible: true,
};

export default function SAAnnouncementsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const { data, isLoading } = useQuery({
    queryKey: ["sa-announcements"],
    queryFn: async () => {
      const res = await vpsAuthedFetch("/api/admin/announcements");
      if (!res.ok) throw new Error("Failed to load announcements");
      return (await res.json()).announcements as Announcement[];
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["sa-announcements"] });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!form.title.trim() || !form.body.trim()) {
        throw new Error("Title and message are required");
      }
      const path = editId
        ? `/api/admin/announcements/${editId}`
        : "/api/admin/announcements";
      const res = await vpsAuthedFetch(path, {
        method: editId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "Save failed");
      return body;
    },
    onSuccess: () => {
      invalidate();
      setOpen(false);
      setForm({ ...EMPTY_FORM });
      setEditId(null);
      toast.success(editId ? "Announcement updated" : "Announcement published");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const toggleMutation = useMutation({
    mutationFn: async (a: Announcement) => {
      const res = await vpsAuthedFetch(`/api/admin/announcements/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !a.is_active }),
      });
      if (!res.ok) throw new Error("Toggle failed");
    },
    onSuccess: invalidate,
    onError: (e) => toast.error((e as Error).message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await vpsAuthedFetch(`/api/admin/announcements/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      invalidate();
      toast.success("Announcement deleted");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const openCreate = () => {
    setEditId(null);
    setForm({ ...EMPTY_FORM });
    setOpen(true);
  };

  const openEdit = (a: Announcement) => {
    setEditId(a.id);
    setForm({
      title: a.title,
      body: a.body,
      severity: a.severity,
      audience: a.audience,
      is_active: a.is_active,
      dismissible: a.dismissible,
    });
    setOpen(true);
  };

  const announcements = data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Megaphone className="h-6 w-6 text-primary" /> Announcements
          </h1>
          <p className="text-sm text-muted-foreground">
            Broadcast banners to dealers — maintenance notices, new features, payment nudges.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" /> New Announcement
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editId ? "Edit Announcement" : "New Announcement"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div>
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="Scheduled maintenance on Friday"
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="body">Message</Label>
                <Textarea
                  id="body"
                  value={form.body}
                  onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                  placeholder="The system will be briefly unavailable from 2–3 AM…"
                  rows={4}
                  className="mt-1"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Severity</Label>
                  <Select
                    value={form.severity}
                    onValueChange={(v) => setForm((f) => ({ ...f, severity: v as Severity }))}
                  >
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(SEVERITY_META) as Severity[]).map((s) => (
                        <SelectItem key={s} value={s}>{SEVERITY_META[s].label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Audience</Label>
                  <Select
                    value={form.audience}
                    onValueChange={(v) => setForm((f) => ({ ...f, audience: v as Audience }))}
                  >
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(AUDIENCE_LABELS) as Audience[]).map((a) => (
                        <SelectItem key={a} value={a}>{AUDIENCE_LABELS[a]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={form.is_active}
                    onCheckedChange={(c) => setForm((f) => ({ ...f, is_active: c }))}
                  />
                  <Label className="text-sm font-normal">Active</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={form.dismissible}
                    onCheckedChange={(c) => setForm((f) => ({ ...f, dismissible: c }))}
                  />
                  <Label className="text-sm font-normal">Dealers can dismiss</Label>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "Saving…" : editId ? "Update" : "Publish"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* List */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : announcements.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12 gap-2">
            <Megaphone className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">No announcements yet</p>
            <p className="text-xs text-muted-foreground">
              Create one to broadcast a banner to your dealers.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {announcements.map((a) => {
            const meta = SEVERITY_META[a.severity];
            const Icon = meta.icon;
            return (
              <Card key={a.id} className={a.is_active ? "" : "opacity-60"}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className={`rounded-md p-2 ${meta.cls}`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <CardTitle className="text-base">{a.title}</CardTitle>
                        <CardDescription className="mt-0.5">
                          {AUDIENCE_LABELS[a.audience]} ·{" "}
                          {format(parseISO(a.created_at), "PP")}
                          {a.created_by_email ? ` · ${a.created_by_email}` : ""}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant={a.is_active ? "default" : "outline"} className="text-[10px]">
                        {a.is_active ? "Active" : "Off"}
                      </Badge>
                      <Switch
                        checked={a.is_active}
                        onCheckedChange={() => toggleMutation.mutate(a)}
                      />
                      <Button variant="ghost" size="icon" onClick={() => openEdit(a)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive"
                        onClick={() => {
                          if (confirm(`Delete "${a.title}"?`)) deleteMutation.mutate(a.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{a.body}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
