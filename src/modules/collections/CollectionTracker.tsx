import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { collectionsService } from "@/services/collectionsService";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Search, Wallet, AlertTriangle, CheckCircle, DollarSign, TrendingDown, CalendarIcon, X, Download, Printer, MessageSquare, BookOpen, Clock, MessageSquareText, MessageCircle } from "lucide-react";
import { bankAccountService } from "@/services/bankAccountService";
import { PaymentModeSelect } from "@/components/PaymentModeSelect";
import { paymentModeLabel, paymentModeRequiresBankAccount } from "@/lib/paymentModes";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import PaymentReceipt from "./PaymentReceipt";
import FollowUpPanel from "./FollowUpPanel";
import AdjustmentDialog from "./AdjustmentDialog";
import AdvancePaymentDialog from "./AdvancePaymentDialog";
import { usePermissions } from "@/hooks/usePermissions";
import { notificationService } from "@/services/notificationService";
import { useDealerInfo } from "@/hooks/useDealerInfo";
import SendWhatsAppDialog from "@/components/whatsapp/SendWhatsAppDialog";
import { buildPaymentReceiptMessage, buildOverdueReminderMessage } from "@/services/whatsappService";

interface CustomerOutstanding {
  id: string;
  name: string;
  phone: string | null;
  type: string;
  outstanding: number;
  last_payment_date: string | null;
  total_sales: number;
  total_paid: number;
  invoices: { invoice_number: string; sale_id: string; sale_date: string }[];
  oldestSaleDate: string | null;
  daysOverdue: number;
  agingBucket: string;
  lastFollowupDate: string | null;
  lastFollowupStatus: string | null;
  maxOverdueDays: number;
}

interface CollectionEntry {
  id: string;
  customer_name: string;
  amount: number;
  description: string | null;
  entry_date: string;
  created_at: string;
}

type SortOption = "highest" | "oldest" | "followup_oldest";

function getAgingBucket(daysOverdue: number): string {
  if (daysOverdue <= 0) return "current";
  if (daysOverdue <= 30) return "current";
  if (daysOverdue <= 60) return "30+";
  if (daysOverdue <= 90) return "60+";
  return "90+";
}

const AGING_BADGE: Record<string, { label: string; variant: string }> = {
  current: { label: "Current", variant: "secondary" },
  "30+": { label: "30+", variant: "outline" },
  "60+": { label: "60+", variant: "default" },
  "90+": { label: "90+", variant: "destructive" },
};

export default function CollectionTracker({ dealerId }: { dealerId: string }) {
  const { profile } = useAuth();
  const { isDealerAdmin } = usePermissions();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: dealerInfo } = useDealerInfo();
  const receiptRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const [payDialog, setPayDialog] = useState<{ open: boolean; customer?: CustomerOutstanding }>({ open: false });
  // V2 Sprint 4A — "Collection Adjustment" (dealer_admin only)
  const [adjustDialog, setAdjustDialog] = useState<{ open: boolean; customer: { id: string; name: string } | null }>({ open: false, customer: null });
  const [advanceDialog, setAdvanceDialog] = useState<{ open: boolean; customer: { id: string; name: string } | null }>({ open: false, customer: null });
  const [payAmount, setPayAmount] = useState("");
  const [payNote, setPayNote] = useState("");
  const [paidAccountId, setPaidAccountId] = useState<string | null>(null);
  const [payPaymentMode, setPayPaymentMode] = useState("cash");
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();
  const [sortBy, setSortBy] = useState<SortOption>("highest");
  const [activeTab, setActiveTab] = useState("all");
  const [followUpCustomer, setFollowUpCustomer] = useState<{ id: string; name: string } | null>(null);
  const [receiptData, setReceiptData] = useState<{
    customerName: string;
    customerPhone: string | null;
    amount: number;
    note: string;
    remainingDue: number;
    receiptNo: string;
    date: string;
    paymentMethod: string;
  } | null>(null);
  const [sendingReminder, setSendingReminder] = useState<string | null>(null);
  const [waDialog, setWaDialog] = useState<null | {
    type: "payment_receipt" | "overdue_reminder";
    phone: string;
    name: string;
    sourceId: string | null;
    message: string;
  }>(null);

  // Fetch all customers with outstanding balances + follow-up data
  const { data: customers = [], isLoading } = useQuery({
    queryKey: ["collection-tracker", dealerId],
    queryFn: () => collectionsService.listOutstanding(dealerId),
  });

  // Recent collections
  const { data: recentCollections = [] } = useQuery({
    queryKey: ["recent-collections", dealerId],
    queryFn: () => collectionsService.listRecent(dealerId, 20),
  });

  const { data: bankAccounts = [] } = useQuery({
    queryKey: ["bank-accounts", dealerId],
    queryFn: () => bankAccountService.list(dealerId),
    enabled: !!dealerId,
  });

  const recordPayment = useMutation({
    mutationFn: async ({
      customerId,
      amount,
      note,
      paid_account_id,
      payment_mode,
    }: {
      customerId: string;
      amount: number;
      note: string;
      paid_account_id?: string | null;
      payment_mode: string;
    }) => {
      return collectionsService.recordPayment(dealerId, {
        customer_id: customerId,
        amount,
        note: note || undefined,
        paid_account_id: paid_account_id ?? null,
        payment_mode: payment_mode || undefined,
      });
    },
    onSuccess: (result, variables) => {
      toast.success("Payment recorded successfully");
      const customer = payDialog.customer;
      if (customer) {
        setReceiptData({
          customerName: customer.name, customerPhone: customer.phone,
          amount: variables.amount, note: variables.note,
          remainingDue: Math.max(0, customer.outstanding - (result?.totalApplied ?? variables.amount)),
          receiptNo: `RCP-${Date.now().toString(36).toUpperCase()}`,
          date: new Date().toISOString(),
          paymentMethod: paymentModeLabel(variables.payment_mode),
        });
      }
      queryClient.invalidateQueries({ queryKey: ["collection-tracker"] });
      queryClient.invalidateQueries({ queryKey: ["recent-collections"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-top-overdue"] });
      queryClient.invalidateQueries({ queryKey: ["sale"] });
      setPayDialog({ open: false }); setPayAmount(""); setPayNote(""); setPaidAccountId(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Sorting
  const sortedCustomers = [...customers].sort((a, b) => {
    if (sortBy === "highest") return b.outstanding - a.outstanding;
    if (sortBy === "oldest") return b.daysOverdue - a.daysOverdue;
    if (sortBy === "followup_oldest") {
      const aDate = a.lastFollowupDate ?? "0000-01-01";
      const bDate = b.lastFollowupDate ?? "0000-01-01";
      return aDate.localeCompare(bDate);
    }
    return 0;
  });

  // Filtering
  const filtered = sortedCustomers.filter(
    (c) => c.name.toLowerCase().includes(search.toLowerCase()) || (c.phone && c.phone.includes(search))
  );

  const overdueOnly = filtered.filter((c) => {
    if (c.maxOverdueDays > 0 && c.daysOverdue > c.maxOverdueDays) return true;
    return c.daysOverdue > 30;
  });

  const dateFiltered = (tab: string) => {
    const list = tab === "overdue" ? overdueOnly : filtered;
    if (!dateFrom && !dateTo) return list;
    return list.filter((c) => c.invoices.some((inv) => {
      if (dateFrom && inv.sale_date < format(dateFrom, "yyyy-MM-dd")) return false;
      if (dateTo && inv.sale_date > format(dateTo, "yyyy-MM-dd")) return false;
      return true;
    }));
  };

  const displayList = dateFiltered(activeTab);
  const totalOutstanding = customers.reduce((s, c) => s + c.outstanding, 0);
  const totalCollectedToday = recentCollections
    .filter((c) => c.entry_date === new Date().toISOString().split("T")[0])
    .reduce((s, c) => s + c.amount, 0);

  const exportCSV = () => {
    const rows = [
      ["Customer", "Phone", "Type", "Outstanding", "Days Overdue", "Aging", "Last Payment", "Last Follow-up", "Follow-up Status"],
      ...displayList.map((c) => [
        c.name, c.phone || "", c.type, c.outstanding.toString(), c.daysOverdue.toString(),
        c.agingBucket, c.last_payment_date ? format(new Date(c.last_payment_date), "dd MMM yyyy") : "",
        c.lastFollowupDate ?? "No follow-up", c.lastFollowupStatus?.replace(/_/g, " ") ?? "",
      ]),
    ];
    const csv = rows.map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `collections-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click(); URL.revokeObjectURL(url);
    toast.success("CSV exported");
  };

  const handleSendReminder = async (customer: CustomerOutstanding) => {
    if (!customer.phone) { toast.error("No phone number"); return; }
    setSendingReminder(customer.id);
    try {
      const success = await notificationService.sendPaymentReminder(dealerId, {
        customer_name: customer.name, customer_phone: customer.phone,
        outstanding: customer.outstanding,
        last_payment_date: customer.last_payment_date ? format(new Date(customer.last_payment_date), "dd MMM yyyy") : undefined,
        dealer_name: dealerInfo?.name, dealer_phone: dealerInfo?.phone ?? undefined,
      });
      if (success) toast.success(`Reminder sent to ${customer.name}`);
      else toast.error("Failed to send reminder");
    } catch { toast.error("Failed to send reminder"); }
    finally { setSendingReminder(null); }
  };

  const renderTable = (list: CustomerOutstanding[]) => (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Customer</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Aging</TableHead>
            <TableHead className="text-right">Outstanding</TableHead>
            <TableHead>Days Overdue</TableHead>
            <TableHead>Last Payment</TableHead>
            <TableHead>Follow-up</TableHead>
            <TableHead className="text-center">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
          ) : list.length === 0 ? (
            <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No outstanding balances found</TableCell></TableRow>
          ) : list.map((c) => {
            const badge = AGING_BADGE[c.agingBucket] ?? AGING_BADGE.current;
            return (
              <TableRow key={c.id}>
                <TableCell>
                  <div>
                    <p className="font-medium text-foreground">{c.name}</p>
                    {c.phone && <p className="text-xs text-muted-foreground">{c.phone}</p>}
                  </div>
                </TableCell>
                <TableCell><Badge variant="outline" className="text-xs capitalize">{c.type}</Badge></TableCell>
                <TableCell>
                  <Badge variant={badge.variant as any} className="text-xs">{badge.label}</Badge>
                </TableCell>
                <TableCell className="text-right font-semibold text-destructive">৳{c.outstanding.toLocaleString()}</TableCell>
                <TableCell>
                  <span className={cn("text-sm", c.daysOverdue > 60 ? "text-destructive font-semibold" : c.daysOverdue > 30 ? "text-amber-600" : "text-muted-foreground")}>
                    {c.daysOverdue > 0 ? `${c.daysOverdue} days` : "—"}
                  </span>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {c.last_payment_date ? format(new Date(c.last_payment_date), "dd MMM yyyy") : "—"}
                </TableCell>
                <TableCell>
                  {c.lastFollowupDate ? (
                    <div className="text-xs">
                      <span className="text-muted-foreground">{format(new Date(c.lastFollowupDate), "dd MMM")}</span>
                      {c.lastFollowupStatus && (
                        <Badge variant="secondary" className="ml-1 text-[10px] capitalize">
                          {c.lastFollowupStatus.replace(/_/g, " ")}
                        </Badge>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground italic">No follow-up yet</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-center gap-1">
                    <Button size="sm" variant="default" onClick={() => { setPayDialog({ open: true, customer: c }); setPayAmount(""); setPayNote(""); }}>
                      <DollarSign className="h-3 w-3 mr-1" /> Collect
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setAdvanceDialog({ open: true, customer: { id: c.id, name: c.name } })} title="Record advance payment">
                      Advance
                    </Button>
                    {isDealerAdmin && (
                      <Button size="sm" variant="outline" onClick={() => setAdjustDialog({ open: true, customer: { id: c.id, name: c.name } })} title="Adjust balance">
                        Adjust
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => setFollowUpCustomer({ id: c.id, name: c.name })} title="Follow-up history">
                      <MessageSquareText className="h-3 w-3" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => navigate(`/ledger?customer=${c.id}`)} title="View ledger">
                      <BookOpen className="h-3 w-3" />
                    </Button>
                    {c.phone && (
                      <Button size="sm" variant="ghost" disabled={sendingReminder === c.id} onClick={() => handleSendReminder(c)} title="SMS reminder">
                        <MessageSquare className="h-3 w-3" />
                      </Button>
                    )}
                    {c.phone && (
                      <Button
                        size="sm"
                        variant="ghost"
                        title="WhatsApp overdue reminder"
                        onClick={() =>
                          setWaDialog({
                            type: "overdue_reminder",
                            phone: c.phone!,
                            name: c.name,
                            sourceId: c.id,
                            message: buildOverdueReminderMessage({
                              dealerName: dealerInfo?.name ?? "Your Business",
                              dealerPhone: dealerInfo?.phone ?? null,
                              customerName: c.name,
                              outstanding: c.outstanding,
                              daysOverdue: c.daysOverdue,
                              oldestInvoiceDate: c.oldestSaleDate
                                ? format(new Date(c.oldestSaleDate), "dd MMM yyyy")
                                : null,
                            }),
                          })
                        }
                      >
                        <MessageCircle className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Payment Collections</h1>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={exportCSV}>
          <Download className="h-4 w-4" /> Export CSV
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-destructive/10"><TrendingDown className="h-5 w-5 text-destructive" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Total Outstanding</p>
              <p className="text-xl font-bold text-foreground">৳{totalOutstanding.toLocaleString()}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10"><Wallet className="h-5 w-5 text-primary" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Today's Collection</p>
              <p className="text-xl font-bold text-foreground">৳{totalCollectedToday.toLocaleString()}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-accent"><AlertTriangle className="h-5 w-5 text-accent-foreground" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Customers with Due</p>
              <p className="text-xl font-bold text-foreground">{customers.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-destructive/10"><Clock className="h-5 w-5 text-destructive" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Overdue ({">"}30 days)</p>
              <p className="text-xl font-bold text-destructive">{customers.filter((c) => c.daysOverdue > 30).length}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search customer..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="highest">Highest Outstanding</SelectItem>
            <SelectItem value="oldest">Oldest Overdue</SelectItem>
            <SelectItem value="followup_oldest">Oldest Follow-up</SelectItem>
          </SelectContent>
        </Select>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className={cn("gap-1.5 text-xs", !dateFrom && "text-muted-foreground")}>
              <CalendarIcon className="h-3.5 w-3.5" /> {dateFrom ? format(dateFrom, "dd MMM yyyy") : "From"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar mode="single" selected={dateFrom} onSelect={setDateFrom} initialFocus className="p-3 pointer-events-auto" />
          </PopoverContent>
        </Popover>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className={cn("gap-1.5 text-xs", !dateTo && "text-muted-foreground")}>
              <CalendarIcon className="h-3.5 w-3.5" /> {dateTo ? format(dateTo, "dd MMM yyyy") : "To"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar mode="single" selected={dateTo} onSelect={setDateTo} initialFocus className="p-3 pointer-events-auto" />
          </PopoverContent>
        </Popover>
        {(dateFrom || dateTo) && (
          <Button variant="ghost" size="sm" className="text-xs gap-1" onClick={() => { setDateFrom(undefined); setDateTo(undefined); }}>
            <X className="h-3.5 w-3.5" /> Clear
          </Button>
        )}
      </div>

      {/* Tabs: All / Overdue */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="all">All ({filtered.length})</TabsTrigger>
          <TabsTrigger value="overdue" className="text-destructive">
            Overdue ({overdueOnly.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Outstanding Balances</CardTitle></CardHeader>
            <CardContent className="p-0">{renderTable(displayList)}</CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="overdue">
          <Card className="border-destructive/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive" /> Overdue Customers
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">{renderTable(dateFiltered("overdue"))}</CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Recent Collections */}
      {recentCollections.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-primary" /> Recent Collections
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {recentCollections.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.customer_name}</TableCell>
                      <TableCell className="text-right font-semibold text-primary">৳{c.amount.toLocaleString()}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{c.description || "—"}</TableCell>
                      <TableCell className="text-xs">{format(new Date(c.entry_date), "dd MMM yyyy")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Payment Dialog */}
      <Dialog open={payDialog.open} onOpenChange={(o) => setPayDialog({ open: o })}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Collect Payment — {payDialog.customer?.name}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Outstanding:</span>
              <span className="font-bold text-destructive">৳{payDialog.customer?.outstanding.toLocaleString()}</span>
            </div>
            <div className="space-y-2">
              <Label>Amount (৳)</Label>
              <Input type="number" min={1} max={payDialog.customer?.outstanding} placeholder="Enter amount" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {payDialog.customer && [
                Math.round(payDialog.customer.outstanding * 0.25),
                Math.round(payDialog.customer.outstanding * 0.5),
                payDialog.customer.outstanding,
              ].map((q) => (
                <Button key={q} type="button" variant="outline" size="sm" className="text-xs" onClick={() => setPayAmount(String(q))}>
                  ৳{q.toLocaleString()}
                </Button>
              ))}
            </div>
            <PaymentModeSelect
              value={payPaymentMode}
              onChange={(v) => {
                setPayPaymentMode(v);
                if (v === "cash") setPaidAccountId(null);
              }}
              label="Payment Mode"
            />
            {payPaymentMode !== "cash" && (
              <div className="space-y-2">
                <Label className="flex items-center gap-1">
                  <Wallet className="h-3 w-3" />{" "}
                  {paymentModeRequiresBankAccount(payPaymentMode) ? "Received Into (required)" : "Settlement Account (optional)"}
                </Label>
                <Select
                  value={paidAccountId ?? "__cash__"}
                  onValueChange={(v) => setPaidAccountId(v === "__cash__" ? null : v)}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {!paymentModeRequiresBankAccount(payPaymentMode) && (
                      <SelectItem value="__cash__">MFS / Cash Wallet</SelectItem>
                    )}
                    {bankAccounts.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.bank_name} — {b.account_number}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label>Note (optional)</Label>
              <Textarea placeholder="Collection note..." value={payNote} onChange={(e) => setPayNote(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayDialog({ open: false })}>Cancel</Button>
            <Button
              disabled={!payAmount || Number(payAmount) <= 0 || recordPayment.isPending}
              onClick={() => {
                if (!payDialog.customer) return;
                if (paymentModeRequiresBankAccount(payPaymentMode) && !paidAccountId) {
                  toast.error("Select a bank account for this payment mode");
                  return;
                }
                recordPayment.mutate({
                  customerId: payDialog.customer.id,
                  amount: Number(payAmount),
                  note: payNote,
                  paid_account_id: paidAccountId,
                  payment_mode: payPaymentMode,
                });
              }}
            >
              {recordPayment.isPending ? "Recording..." : "Record Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* V2 Sprint 4A — Collection Adjustment Dialog */}
      <AdjustmentDialog
        dealerId={dealerId}
        customer={adjustDialog.customer}
        open={adjustDialog.open}
        onOpenChange={(open) => setAdjustDialog({ open, customer: open ? adjustDialog.customer : null })}
      />

      {/* V2 Sprint 4C — Advance Payment Dialog */}
      <AdvancePaymentDialog
        dealerId={dealerId}
        customer={advanceDialog.customer}
        open={advanceDialog.open}
        onOpenChange={(open) => setAdvanceDialog({ open, customer: open ? advanceDialog.customer : null })}
      />

      {/* Receipt Dialog */}
      <Dialog open={!!receiptData} onOpenChange={(o) => !o && setReceiptData(null)}>
        <DialogContent className="sm:max-w-lg print:shadow-none print:border-none">
          <DialogHeader><DialogTitle>Payment Receipt</DialogTitle></DialogHeader>
          {receiptData && (
            <div className="overflow-auto max-h-[70vh]">
              <PaymentReceipt
                ref={receiptRef} dealerName={dealerInfo?.name ?? ""} dealerPhone={dealerInfo?.phone ?? null}
                dealerAddress={dealerInfo?.address ?? null} customerName={receiptData.customerName}
                customerPhone={receiptData.customerPhone} amount={receiptData.amount} note={receiptData.note}
                date={receiptData.date} receiptNo={receiptData.receiptNo} remainingDue={receiptData.remainingDue}
                paymentMethod={receiptData.paymentMethod}
              />
            </div>
          )}
          <DialogFooter className="gap-2 flex-wrap sm:flex-nowrap">
            <Button variant="outline" onClick={() => setReceiptData(null)}>Close</Button>
            {receiptData?.customerPhone && (
              <Button
                variant="secondary"
                onClick={() => {
                  if (!receiptData) return;
                  setWaDialog({
                    type: "payment_receipt",
                    phone: receiptData.customerPhone!,
                    name: receiptData.customerName,
                    sourceId: null,
                    message: buildPaymentReceiptMessage({
                      dealerName: dealerInfo?.name ?? "Your Business",
                      customerName: receiptData.customerName,
                      receiptNo: receiptData.receiptNo,
                      amount: receiptData.amount,
                      remainingDue: receiptData.remainingDue,
                      date: format(new Date(receiptData.date), "dd MMM yyyy"),
                    }),
                  });
                }}
              >
                <MessageCircle className="h-4 w-4 mr-1" /> Send via WhatsApp
              </Button>
            )}
            <Button onClick={() => {
              const content = receiptRef.current;
              if (!content) return;
              const w = window.open("", "_blank");
              if (!w) return;
              w.document.write(`<html><head><title>Receipt</title><style>body{margin:0;font-family:'Segoe UI',sans-serif}@media print{body{margin:0}}</style></head><body>${content.innerHTML}</body></html>`);
              w.document.close(); w.focus(); w.print();
            }}>
              <Printer className="h-4 w-4 mr-1" /> Print Receipt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Follow-up Panel */}
      <FollowUpPanel
        open={!!followUpCustomer}
        onClose={() => setFollowUpCustomer(null)}
        customerId={followUpCustomer?.id ?? ""}
        customerName={followUpCustomer?.name ?? ""}
        dealerId={dealerId}
      />

      {/* WhatsApp Send Dialog (overdue reminder + payment receipt share) */}
      {waDialog && (
        <SendWhatsAppDialog
          open={!!waDialog}
          onOpenChange={(o) => !o && setWaDialog(null)}
          dealerId={dealerId}
          messageType={waDialog.type}
          sourceType={waDialog.type === "payment_receipt" ? "payment" : "customer"}
          sourceId={waDialog.sourceId}
          templateKey={waDialog.type}
          defaultPhone={waDialog.phone}
          defaultName={waDialog.name}
          defaultMessage={waDialog.message}
          title={
            waDialog.type === "payment_receipt"
              ? "Send Receipt via WhatsApp"
              : "Send Overdue Reminder via WhatsApp"
          }
        />
      )}
    </div>
  );
}
