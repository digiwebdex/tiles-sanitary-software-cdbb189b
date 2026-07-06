import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  MessageCircle,
  Search,
  ExternalLink,
  CheckCircle2,
  XCircle,
  MoreHorizontal,
  RotateCw,
} from "lucide-react";
import { toast } from "sonner";

import { useDealerId } from "@/hooks/useDealerId";
import {
  whatsappService,
  PAGE_SIZE_WA,
  buildWaLink,
  type WhatsAppMessageStatus,
  type WhatsAppMessageType,
} from "@/services/whatsappService";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Pagination from "@/components/Pagination";

const TYPE_LABELS: Record<WhatsAppMessageType, string> = {
  quotation_share: "Quotation Share",
  invoice_share: "Invoice Share",
  payment_receipt: "Payment Receipt",
  overdue_reminder: "Overdue Reminder",
  delivery_update: "Delivery Update",
  purchase_order_share: "Purchase Order Share",
};

const statusVariant = (
  s: WhatsAppMessageStatus
): "default" | "secondary" | "destructive" | "outline" => {
  switch (s) {
    case "sent":
      return "default";
    case "manual_handoff":
      return "outline";
    case "pending":
      return "secondary";
    case "failed":
      return "destructive";
    default:
      return "secondary";
  }
};

const statusLabel = (s: WhatsAppMessageStatus): string => {
  switch (s) {
    case "manual_handoff":
      return "Opened";
    case "sent":
      return "Sent";
    case "pending":
      return "Pending";
    case "failed":
      return "Failed";
    default:
      return s;
  }
};

const WhatsAppLogsPage = () => {
  const dealerId = useDealerId();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<WhatsAppMessageType | "all">("all");
  const [statusFilter, setStatusFilter] = useState<WhatsAppMessageStatus | "all">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ["whatsapp-logs", dealerId, page, search, typeFilter, statusFilter],
    queryFn: () =>
      whatsappService.list({
        dealerId,
        page,
        messageType: typeFilter,
        status: statusFilter,
        search,
      }),
    enabled: !!dealerId,
  });

  const { data: analytics } = useQuery({
    queryKey: ["whatsapp-analytics", dealerId, 7],
    queryFn: () => whatsappService.getAnalytics(dealerId, 7),
    enabled: !!dealerId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["whatsapp-logs"] });
    queryClient.invalidateQueries({ queryKey: ["whatsapp-analytics"] });
  };

  const markSent = useMutation({
    mutationFn: (id: string) => whatsappService.markSent(id),
    onSuccess: () => {
      toast.success("Marked as sent");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const markFailed = useMutation({
    mutationFn: (id: string) =>
      whatsappService.markFailed(id, "Marked failed by user"),
    onSuccess: () => {
      toast.success("Marked as failed");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const retry = useMutation({
    mutationFn: (id: string) => whatsappService.retryLog(id),
    onSuccess: ({ waLink }) => {
      window.open(waLink, "_blank", "noopener,noreferrer");
      toast.success("Retry attempt logged. WhatsApp opened.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bulkUpdate = useMutation({
    mutationFn: ({
      ids,
      status,
    }: {
      ids: string[];
      status: WhatsAppMessageStatus;
    }) => whatsappService.bulkUpdateStatus(ids, status),
    onSuccess: (_d, vars) => {
      toast.success(
        `Updated ${vars.ids.length} message${vars.ids.length === 1 ? "" : "s"}.`,
      );
      setSelected(new Set());
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE_WA));

  const allSelected = useMemo(
    () => rows.length > 0 && rows.every((r) => selected.has(r.id)),
    [rows, selected],
  );
  const someSelected = useMemo(
    () => rows.some((r) => selected.has(r.id)),
    [rows, selected],
  );

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(rows.map((r) => r.id)));
    }
  };
  const toggleOne = (id: string) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="container mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <MessageCircle className="h-6 w-6 text-primary" />
            WhatsApp Log
          </h1>
          <p className="text-sm text-muted-foreground">
            Every WhatsApp send attempt initiated from the ERP.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase text-muted-foreground">
              Last 7 days
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{analytics?.totals.total ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase text-muted-foreground">
              Sent
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{analytics?.totals.sent ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase text-muted-foreground">
              Opened
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{analytics?.totals.handoff ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase text-muted-foreground">
              Failed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-destructive">
              {analytics?.totals.failed ?? 0}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by phone or name…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="pl-8"
              />
            </div>
            <Select
              value={typeFilter}
              onValueChange={(v) => {
                setTypeFilter(v as WhatsAppMessageType | "all");
                setPage(1);
              }}
            >
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {(Object.keys(TYPE_LABELS) as WhatsAppMessageType[]).map((t) => (
                  <SelectItem key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(v as WhatsAppMessageStatus | "all");
                setPage(1);
              }}
            >
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="manual_handoff">Opened</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {someSelected && (
            <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2 text-xs">
              <span className="font-medium">{selected.size} selected</span>
              <Button
                size="sm"
                variant="outline"
                disabled={bulkUpdate.isPending}
                onClick={() =>
                  bulkUpdate.mutate({
                    ids: Array.from(selected),
                    status: "sent",
                  })
                }
              >
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Mark Sent
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={bulkUpdate.isPending}
                onClick={() =>
                  bulkUpdate.mutate({
                    ids: Array.from(selected),
                    status: "failed",
                  })
                }
              >
                <XCircle className="h-3.5 w-3.5 mr-1" /> Mark Failed
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelected(new Set())}
              >
                Clear
              </Button>
            </div>
          )}

          {isLoading ? (
            <p className="text-center py-8 text-muted-foreground text-sm">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground text-sm">
              No WhatsApp messages logged yet.
            </p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allSelected}
                        onCheckedChange={toggleAll}
                        aria-label="Select all"
                      />
                    </TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Recipient</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Error</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id} data-state={selected.has(r.id) ? "selected" : undefined}>
                      <TableCell>
                        <Checkbox
                          checked={selected.has(r.id)}
                          onCheckedChange={() => toggleOne(r.id)}
                          aria-label={`Select ${r.id}`}
                        />
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {format(new Date(r.created_at), "dd MMM, HH:mm")}
                      </TableCell>
                      <TableCell className="text-xs">
                        {TYPE_LABELS[r.message_type]}
                      </TableCell>
                      <TableCell className="text-sm">
                        {r.recipient_name ?? (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        +{r.recipient_phone}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(r.status)} className="text-xs">
                          {statusLabel(r.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-destructive max-w-[200px] truncate">
                        {r.error_message ?? ""}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="icon" variant="ghost" className="h-7 w-7">
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            <DropdownMenuItem
                              onClick={() =>
                                window.open(
                                  buildWaLink(r.recipient_phone, r.message_text),
                                  "_blank",
                                  "noopener,noreferrer"
                                )
                              }
                            >
                              <ExternalLink className="mr-2 h-4 w-4" /> Re-open in WhatsApp
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={retry.isPending}
                              onClick={() => retry.mutate(r.id)}
                            >
                              <RotateCw className="mr-2 h-4 w-4" /> Retry (new attempt)
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              disabled={r.status === "sent" || markSent.isPending}
                              onClick={() => markSent.mutate(r.id)}
                            >
                              <CheckCircle2 className="mr-2 h-4 w-4 text-primary" /> Mark Sent
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={r.status === "failed" || markFailed.isPending}
                              onClick={() => markFailed.mutate(r.id)}
                              className="text-destructive focus:text-destructive"
                            >
                              <XCircle className="mr-2 h-4 w-4" /> Mark Failed
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {totalPages > 1 && (
            <Pagination
              page={page}
              totalItems={total}
              pageSize={PAGE_SIZE_WA}
              onPageChange={setPage}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default WhatsAppLogsPage;
