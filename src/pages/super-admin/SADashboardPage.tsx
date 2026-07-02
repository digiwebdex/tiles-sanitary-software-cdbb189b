import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Store, CalendarPlus, AlertTriangle, TrendingUp, Clock, Ban,
  Wallet, Banknote, Users, ArrowRight, CheckCircle2, RefreshCw,
  UserPlus, CreditCard, BellRing, Activity,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
  BarChart, Bar,
} from "recharts";
import { formatDistanceToNow, parseISO } from "date-fns";

const PALETTE = {
  primary: "hsl(222.2, 47.4%, 11.2%)",
  muted: "hsl(215.4, 16.3%, 76.9%)",
  success: "hsl(142, 71%, 45%)",
  warning: "hsl(38, 92%, 50%)",
  danger: "hsl(0, 84%, 60%)",
};
const PIE_COLORS = [PALETTE.success, PALETTE.warning, PALETTE.danger, PALETTE.primary, "#a78bfa"];

async function vpsJson<T>(path: string): Promise<T> {
  const res = await vpsAuthedFetch(path);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as any)?.error || `Request failed (${res.status})`);
  return body as T;
}

interface DashV2 {
  kpi: {
    total_dealers: string; new_dealers_30d: string;
    active_subs: string; expiring_soon: string; grace_period: string;
    truly_expired: string; suspended: string;
    mrr: string; collected_this_month: string; outstanding: string;
  };
  alertDealers: {
    dealer_id: string; dealer_name: string; sub_status: string;
    end_date: string | null; plan_name: string | null;
    days_left: number | null; phone: string | null;
  }[];
  recentActivity: { type: string; label: string; ts: string }[];
  monthlyRevenue: { month: string; collected: string; expected: string }[];
  planDistribution: { name: string; count: string }[];
  paymentTotals: { payment_method: string; total: string }[];
}

function StatCard({
  title, value, icon: Icon, sub, trend, onClick, urgent,
}: {
  title: string; value: string | number; icon: any;
  sub?: string; trend?: string; onClick?: () => void; urgent?: boolean;
}) {
  return (
    <Card
      className={cn(
        "transition-all duration-150",
        onClick ? "cursor-pointer hover:shadow-md hover:-translate-y-0.5" : "",
        urgent ? "border-destructive/40 bg-destructive/5" : ""
      )}
      onClick={onClick}
    >
      <CardHeader className="flex flex-row items-center justify-between pb-1 pt-4 px-4">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{title}</CardTitle>
        <Icon className={cn("h-4 w-4", urgent ? "text-destructive" : "text-muted-foreground")} />
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="text-2xl font-bold tracking-tight text-foreground">{value}</div>
        <div className="flex items-center gap-2 mt-1">
          {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
          {trend && (
            <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-emerald-500 text-emerald-600">
              {trend}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

const ACTIVITY_ICONS: Record<string, any> = {
  new_dealer: UserPlus,
  payment: CreditCard,
  renewal: CheckCircle2,
};
const ACTIVITY_COLORS: Record<string, string> = {
  new_dealer: "text-blue-500",
  payment: "text-emerald-500",
  renewal: "text-violet-500",
};

export default function SADashboardPage() {
  const navigate = useNavigate();

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["sa-dashboard-v2"],
    queryFn: () => vpsJson<DashV2>("/api/admin/dashboard-v2"),
    refetchInterval: 5 * 60 * 1000,
  });

  const kpi = data?.kpi;
  const mrr = Number(kpi?.mrr ?? 0);
  const collected = Number(kpi?.collected_this_month ?? 0);
  const outstanding = Number(kpi?.outstanding ?? 0);
  const expiringSoon = Number(kpi?.expiring_soon ?? 0);
  const grace = Number(kpi?.grace_period ?? 0);
  const expired = Number(kpi?.truly_expired ?? 0);
  const alertTotal = expiringSoon + grace;

  const pieData = [
    { name: "Active", value: Number(kpi?.active_subs ?? 0) - expiringSoon },
    { name: "Expiring", value: expiringSoon },
    { name: "Grace", value: grace },
    { name: "Expired", value: expired },
  ].filter((d) => d.value > 0);

  const revenueData = (data?.monthlyRevenue ?? []).map((r) => ({
    month: r.month,
    collected: Number(r.collected),
    expected: Number(r.expected),
  }));

  return (
    <div className="space-y-6">
      {/* Page title */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Platform-wide analytics and live status.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={cn("mr-2 h-3.5 w-3.5", isFetching && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* Alert rail */}
      {alertTotal > 0 && (
        <Card className="border-amber-400/40 bg-amber-50/50 dark:bg-amber-950/20">
          <CardContent className="flex items-center gap-3 p-3">
            <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">
                {alertTotal} dealer{alertTotal > 1 ? "s" : ""} need attention
              </p>
              <p className="text-xs text-muted-foreground">
                {expiringSoon > 0 && `${expiringSoon} expiring within 7 days`}
                {expiringSoon > 0 && grace > 0 && " · "}
                {grace > 0 && `${grace} in grace period`}
              </p>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <Button size="sm" variant="outline" className="h-7 text-xs border-amber-400"
                onClick={() => navigate("/super-admin/reminders")}>
                <BellRing className="mr-1.5 h-3 w-3" /> Send Reminders
              </Button>
              <Button size="sm" className="h-7 text-xs"
                onClick={() => navigate("/super-admin/subscription-status")}>
                View All <ArrowRight className="ml-1.5 h-3 w-3" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* KPI Row 1 */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Dealers"
          value={isLoading ? "…" : Number(kpi?.total_dealers ?? 0).toLocaleString()}
          icon={Store}
          sub={`+${kpi?.new_dealers_30d ?? 0} this month`}
          trend={Number(kpi?.new_dealers_30d ?? 0) > 0 ? `+${kpi?.new_dealers_30d} new` : undefined}
          onClick={() => navigate("/super-admin/dealers")}
        />
        <StatCard
          title="Active Subscriptions"
          value={isLoading ? "…" : Number(kpi?.active_subs ?? 0).toLocaleString()}
          icon={CalendarPlus}
          sub="currently active"
          onClick={() => navigate("/super-admin/subscription-status")}
        />
        <StatCard
          title="MRR"
          value={isLoading ? "…" : formatCurrency(mrr)}
          icon={Banknote}
          sub="monthly recurring revenue"
          onClick={() => navigate("/super-admin/revenue")}
        />
        <StatCard
          title="Collected This Month"
          value={isLoading ? "…" : formatCurrency(collected)}
          icon={Wallet}
          sub="payments received"
          onClick={() => navigate("/super-admin/payments")}
        />
      </div>

      {/* KPI Row 2 */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Outstanding"
          value={isLoading ? "…" : formatCurrency(outstanding)}
          icon={TrendingUp}
          sub="pending + partial"
          urgent={outstanding > 0}
          onClick={() => navigate("/super-admin/payments")}
        />
        <StatCard
          title="Expiring Soon"
          value={isLoading ? "…" : expiringSoon}
          icon={Clock}
          sub="within 7 days"
          urgent={expiringSoon > 0}
          onClick={() => navigate("/super-admin/subscription-status")}
        />
        <StatCard
          title="Grace Period"
          value={isLoading ? "…" : grace}
          icon={AlertTriangle}
          sub="expired within 3 days"
          urgent={grace > 0}
          onClick={() => navigate("/super-admin/subscription-status")}
        />
        <StatCard
          title="Expired"
          value={isLoading ? "…" : expired}
          icon={Ban}
          sub="read-only mode"
          urgent={expired > 0}
          onClick={() => navigate("/super-admin/subscription-status")}
        />
      </div>

      {/* Charts + Activity */}
      <div className="grid gap-6 lg:grid-cols-3">

        {/* Revenue Area Chart */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Revenue Trend — Last 6 Months</CardTitle>
            <CardDescription>Expected vs. collected per month</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={revenueData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <defs>
                    <linearGradient id="gradExpected" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={PALETTE.muted} stopOpacity={0.4} />
                      <stop offset="95%" stopColor={PALETTE.muted} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gradCollected" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={PALETTE.primary} stopOpacity={0.5} />
                      <stop offset="95%" stopColor={PALETTE.primary} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: "hsl(215.4,16.3%,46.9%)" }} />
                  <YAxis tick={{ fontSize: 11, fill: "hsl(215.4,16.3%,46.9%)" }} tickFormatter={(v) => formatCurrency(v)} width={70} />
                  <Tooltip
                    formatter={(value: number, name: string) => [formatCurrency(value), name === "expected" ? "Expected" : "Collected"]}
                    contentStyle={{ borderRadius: 8, fontSize: 12 }}
                  />
                  <Legend formatter={(v) => v === "expected" ? "Expected" : "Collected"} wrapperStyle={{ fontSize: 12 }} />
                  <Area type="monotone" dataKey="expected" stroke={PALETTE.muted} fill="url(#gradExpected)" strokeWidth={1.5} />
                  <Area type="monotone" dataKey="collected" stroke={PALETTE.primary} fill="url(#gradCollected)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Activity Feed */}
        <Card className="flex flex-col">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground" /> Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-auto">
            {isLoading ? (
              <p className="text-xs text-muted-foreground text-center py-8">Loading…</p>
            ) : (data?.recentActivity?.length ?? 0) === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">No recent activity</p>
            ) : (
              <div className="space-y-3">
                {(data?.recentActivity ?? []).map((a, i) => {
                  const Icon = ACTIVITY_ICONS[a.type] ?? CheckCircle2;
                  const color = ACTIVITY_COLORS[a.type] ?? "text-muted-foreground";
                  return (
                    <div key={i} className="flex items-start gap-2.5">
                      <Icon className={cn("h-3.5 w-3.5 mt-0.5 flex-shrink-0", color)} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-foreground truncate">{a.label}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {formatDistanceToNow(parseISO(a.ts), { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Bottom row: Subscription Pie + Alert Dealers + Plan Distribution */}
      <div className="grid gap-6 lg:grid-cols-3">

        {/* Pie */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Subscription Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-56">
              {pieData.length === 0 ? (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">No data</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="45%" innerRadius={45} outerRadius={75}
                      paddingAngle={3} dataKey="value">
                      {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: number, n: string) => [v, n]} contentStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Alert Dealers table */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Dealers Needing Attention</CardTitle>
              <CardDescription>Expiring soon or in grace period</CardDescription>
            </div>
            <Button size="sm" variant="outline" className="h-7 text-xs"
              onClick={() => navigate("/super-admin/reminders")}>
              <BellRing className="mr-1 h-3 w-3" /> Remind All
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <p className="text-xs text-center text-muted-foreground py-8">Loading…</p>
            ) : (data?.alertDealers?.length ?? 0) === 0 ? (
              <div className="flex flex-col items-center py-8 gap-2">
                <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                <p className="text-sm font-medium text-foreground">All dealers are on track</p>
                <p className="text-xs text-muted-foreground">No expiring subscriptions in the next 7 days</p>
              </div>
            ) : (
              <div className="divide-y">
                {(data?.alertDealers ?? []).slice(0, 8).map((d) => {
                  const daysLeft = d.days_left;
                  const isGrace = d.sub_status === "expired";
                  return (
                    <div key={d.dealer_id} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{d.dealer_name}</p>
                        <p className="text-xs text-muted-foreground">{d.plan_name ?? "No plan"} · {d.phone ?? "—"}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {d.end_date && (
                          <p className="text-xs text-muted-foreground hidden sm:block">{d.end_date}</p>
                        )}
                        <Badge
                          variant={isGrace ? "destructive" : daysLeft !== null && daysLeft <= 2 ? "destructive" : "outline"}
                          className="text-[10px] h-5"
                        >
                          {isGrace ? "Grace" : daysLeft === 0 ? "Today" : `${daysLeft}d`}
                        </Badge>
                      </div>
                    </div>
                  );
                })}
                {(data?.alertDealers?.length ?? 0) > 8 && (
                  <div className="px-4 py-2">
                    <Button variant="ghost" size="sm" className="w-full text-xs h-7"
                      onClick={() => navigate("/super-admin/subscription-status")}>
                      View all {data?.alertDealers?.length} dealers <ArrowRight className="ml-1 h-3 w-3" />
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Plan distribution bar */}
      {(data?.planDistribution?.length ?? 0) > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Plan Distribution</CardTitle>
            <CardDescription>Active subscriptions by plan</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={(data?.planDistribution ?? []).map((p) => ({ name: p.name, count: Number(p.count) }))}
                  margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(215.4,16.3%,46.9%)" }} />
                  <YAxis tick={{ fontSize: 11, fill: "hsl(215.4,16.3%,46.9%)" }} allowDecimals={false} />
                  <Tooltip contentStyle={{ fontSize: 12 }} />
                  <Bar dataKey="count" fill={PALETTE.primary} radius={[4, 4, 0, 0]} name="Dealers" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
