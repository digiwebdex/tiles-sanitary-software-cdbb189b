import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { MessageCircle, CheckCircle2, AlertTriangle, TrendingUp } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { whatsappService, type WhatsAppMessageType } from "@/services/whatsappService";

interface Props {
  dealerId: string;
}

const TYPE_LABELS: Record<WhatsAppMessageType, string> = {
  quotation_share: "Quotations",
  invoice_share: "Invoices",
  payment_receipt: "Receipts",
  overdue_reminder: "Reminders",
  delivery_update: "Deliveries",
  purchase_order_share: "Purchase Orders",
};

/**
 * Compact dashboard widgets for WhatsApp Automation analytics (last 7 days).
 * Hidden if no WhatsApp activity in the period.
 */
export function WhatsAppDashboardWidgets({ dealerId }: Props) {
  const navigate = useNavigate();

  const { data } = useQuery({
    queryKey: ["whatsapp-analytics", dealerId, 7],
    queryFn: () => whatsappService.getAnalytics(dealerId, 7),
    enabled: !!dealerId,
    refetchInterval: 120_000,
  });

  if (!data || data.totals.total === 0) return null;

  const goLogs = () => navigate("/whatsapp-logs");
  const maxDaily = Math.max(
    1,
    ...data.daily.map((d) => d.sent + d.handoff + d.failed),
  );

  const successRateRounded = Math.round(data.successRate);
  const failureRate =
    data.totals.total > 0
      ? Math.round((data.totals.failed / data.totals.total) * 100)
      : 0;

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider px-0.5">
        WhatsApp Automation (Last 7 Days)
      </h2>
      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <Card
          className="cursor-pointer hover:border-primary/50 transition-colors"
          onClick={goLogs}
        >
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Total Messages
            </CardTitle>
            <MessageCircle className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <p className="text-lg font-bold">{data.totals.total}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {data.totals.sent} sent · {data.totals.handoff} opened
            </p>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer hover:border-primary/50 transition-colors border-emerald-300/50"
          onClick={goLogs}
        >
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Success Rate
            </CardTitle>
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <p className="text-lg font-bold text-emerald-700">
              {successRateRounded}%
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Sent + opened / total
            </p>
          </CardContent>
        </Card>

        <Card
          className={
            "cursor-pointer hover:border-primary/50 transition-colors " +
            (data.totals.failed > 0 ? "border-destructive/40" : "")
          }
          onClick={goLogs}
        >
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Failed
            </CardTitle>
            <AlertTriangle
              className={
                "h-4 w-4 " +
                (data.totals.failed > 0 ? "text-destructive" : "text-muted-foreground")
              }
            />
          </CardHeader>
          <CardContent>
            <p
              className={
                "text-lg font-bold " +
                (data.totals.failed > 0 ? "text-destructive" : "")
              }
            >
              {data.totals.failed}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {failureRate}% of total
            </p>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer hover:border-primary/50 transition-colors"
          onClick={goLogs}
        >
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Top Type
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            {(() => {
              const entries = Object.entries(data.byType) as [
                WhatsAppMessageType,
                number,
              ][];
              const top = entries.sort((a, b) => b[1] - a[1])[0];
              if (!top || top[1] === 0) {
                return <p className="text-lg font-bold">—</p>;
              }
              return (
                <>
                  <p className="text-lg font-bold">{TYPE_LABELS[top[0]]}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {top[1]} message{top[1] === 1 ? "" : "s"}
                  </p>
                </>
              );
            })()}
          </CardContent>
        </Card>
      </div>

      {/* Mini 7-day trend bars */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs uppercase text-muted-foreground tracking-wider">
            7-Day Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end justify-between gap-2 h-20">
            {data.daily.map((d) => {
              const total = d.sent + d.handoff + d.failed;
              const heightPct = (total / maxDaily) * 100;
              const day = new Date(d.date).toLocaleDateString("en", {
                weekday: "short",
              });
              return (
                <div
                  key={d.date}
                  className="flex flex-col items-center gap-1 flex-1"
                >
                  <div
                    className="w-full bg-muted rounded-sm relative overflow-hidden"
                    style={{ height: "60px" }}
                    title={`${day}: ${total} message${total === 1 ? "" : "s"}`}
                  >
                    <div
                      className="absolute bottom-0 left-0 right-0 bg-primary/70"
                      style={{ height: `${heightPct}%` }}
                    />
                    {d.failed > 0 && (
                      <div
                        className="absolute bottom-0 left-0 right-0 bg-destructive"
                        style={{
                          height: `${(d.failed / maxDaily) * 100}%`,
                        }}
                      />
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    {day}
                  </span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default WhatsAppDashboardWidgets;
