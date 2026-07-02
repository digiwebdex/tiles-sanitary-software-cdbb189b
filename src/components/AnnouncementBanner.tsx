import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info, AlertTriangle, AlertOctagon, CheckCircle2, X } from "lucide-react";
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";
import { cn } from "@/lib/utils";

type Severity = "info" | "warning" | "critical" | "success";

interface Announcement {
  id: string;
  title: string;
  body: string;
  severity: Severity;
  dismissible: boolean;
  created_at: string;
}

const STYLES: Record<Severity, { icon: any; wrap: string; iconCls: string }> = {
  info: {
    icon: Info,
    wrap: "bg-blue-50 border-blue-200 text-blue-900 dark:bg-blue-950/40 dark:border-blue-900 dark:text-blue-100",
    iconCls: "text-blue-500",
  },
  success: {
    icon: CheckCircle2,
    wrap: "bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950/40 dark:border-emerald-900 dark:text-emerald-100",
    iconCls: "text-emerald-500",
  },
  warning: {
    icon: AlertTriangle,
    wrap: "bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950/40 dark:border-amber-900 dark:text-amber-100",
    iconCls: "text-amber-500",
  },
  critical: {
    icon: AlertOctagon,
    wrap: "bg-red-50 border-red-200 text-red-900 dark:bg-red-950/40 dark:border-red-900 dark:text-red-100",
    iconCls: "text-red-500",
  },
};

const DISMISS_KEY = "dismissedAnnouncements";

function getDismissed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(DISMISS_KEY) || "[]");
  } catch {
    return [];
  }
}

export function AnnouncementBanner() {
  const [dismissed, setDismissed] = useState<string[]>(getDismissed);

  const { data } = useQuery({
    queryKey: ["dealer-announcements"],
    queryFn: async () => {
      const res = await vpsAuthedFetch("/api/announcements/active");
      if (!res.ok) return [] as Announcement[];
      return (await res.json()).announcements as Announcement[];
    },
    refetchInterval: 10 * 60 * 1000,
    staleTime: 5 * 60 * 1000,
  });

  const dismiss = (id: string) => {
    const next = [...dismissed, id];
    setDismissed(next);
    try {
      localStorage.setItem(DISMISS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const visible = (data ?? []).filter((a) => !dismissed.includes(a.id));
  if (visible.length === 0) return null;

  return (
    <div className="space-y-px">
      {visible.map((a) => {
        const s = STYLES[a.severity] ?? STYLES.info;
        const Icon = s.icon;
        return (
          <div
            key={a.id}
            className={cn("flex items-start gap-3 border-b px-4 py-2.5", s.wrap)}
          >
            <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", s.iconCls)} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-tight">{a.title}</p>
              <p className="text-xs opacity-90 whitespace-pre-wrap mt-0.5">{a.body}</p>
            </div>
            {a.dismissible && (
              <button
                onClick={() => dismiss(a.id)}
                className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
                aria-label="Dismiss"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
