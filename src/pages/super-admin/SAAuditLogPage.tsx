import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ShieldCheck, RefreshCw, Search, Globe } from "lucide-react";
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";
import { formatDistanceToNow, parseISO, format } from "date-fns";

interface AuditEntry {
  id: string;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_label: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

interface AuditResponse {
  entries: AuditEntry[];
  actions: string[];
}

const ACTION_COLORS: Record<string, string> = {
  delete: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  suspend: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  reactivate: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  payment: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  create: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
};

function actionTone(action: string): string {
  for (const key of Object.keys(ACTION_COLORS)) {
    if (action.includes(key)) return ACTION_COLORS[key];
  }
  return "bg-muted text-muted-foreground";
}

export default function SAAuditLogPage() {
  const [action, setAction] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["sa-audit", action, search],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "200" });
      if (action !== "all") params.set("action", action);
      if (search) params.set("q", search);
      const res = await vpsAuthedFetch(`/api/admin/audit?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load audit log");
      return (await res.json()) as AuditResponse;
    },
  });

  const entries = data?.entries ?? [];
  const actions = data?.actions ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" /> Audit Trail
          </h1>
          <p className="text-sm text-muted-foreground">
            Every super-admin action across the platform — who, what, when, and from where.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`mr-2 h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="flex flex-col sm:flex-row gap-3 p-4">
          <div className="flex-1 flex gap-2">
            <Input
              placeholder="Search by actor, target, or action…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && setSearch(searchInput)}
            />
            <Button variant="secondary" onClick={() => setSearch(searchInput)}>
              <Search className="h-4 w-4" />
            </Button>
          </div>
          <Select value={action} onValueChange={setAction}>
            <SelectTrigger className="w-full sm:w-[220px]">
              <SelectValue placeholder="All actions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All actions</SelectItem>
              {actions.map((a) => (
                <SelectItem key={a} value={a}>{a}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Entries */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Activity ({entries.length})</CardTitle>
          <CardDescription>Most recent first · up to 200 entries</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="text-sm text-center text-muted-foreground py-10">Loading…</p>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center py-12 gap-2">
              <ShieldCheck className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium">No audit entries yet</p>
              <p className="text-xs text-muted-foreground">
                Actions like suspending a dealer or recording a payment will appear here.
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {entries.map((e) => (
                <div key={e.id} className="flex items-start gap-3 px-4 py-3">
                  <Badge className={`${actionTone(e.action)} text-[10px] font-mono shrink-0 mt-0.5`}>
                    {e.action}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground">
                      {e.target_label ? (
                        <span className="font-medium">{e.target_label}</span>
                      ) : (
                        <span className="text-muted-foreground italic">{e.target_type ?? "—"}</span>
                      )}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground mt-0.5">
                      <span>{e.actor_email ?? "system"}</span>
                      {e.ip_address && (
                        <span className="flex items-center gap-0.5">
                          <Globe className="h-2.5 w-2.5" /> {e.ip_address}
                        </span>
                      )}
                      <span title={format(parseISO(e.created_at), "PPpp")}>
                        {formatDistanceToNow(parseISO(e.created_at), { addSuffix: true })}
                      </span>
                    </div>
                    {e.details && Object.keys(e.details).length > 0 && (
                      <pre className="mt-1.5 text-[10px] bg-muted/50 rounded p-2 overflow-x-auto text-muted-foreground">
                        {JSON.stringify(e.details, null, 2)}
                      </pre>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
