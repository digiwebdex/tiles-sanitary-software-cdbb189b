import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { salesService } from "@/services/salesService";
import { projectService } from "@/services/projectService";
import { challanService } from "@/services/challanService";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Printer, Download, Pencil, Truck, Mail, CreditCard, Trash2, X, FileText, Wallet } from "lucide-react";
import { bankAccountService } from "@/services/bankAccountService";
import { collectionsService } from "@/services/collectionsService";
import { salesReturnService } from "@/services/salesReturnService";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { useDealerInfo } from "@/hooks/useDealerInfo";
import { useDealerId } from "@/hooks/useDealerId";
import SaleInvoiceDocument from "@/components/sale/SaleInvoiceDocument";
import InvoiceTimeline from "@/components/sale/InvoiceTimeline";
import { PaymentModeSelect } from "@/components/PaymentModeSelect";
import { paymentModeRequiresBankAccount } from "@/lib/paymentModes";
import SaleCommissionPanel from "@/components/sale/SaleCommissionPanel";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";

const InvoicePage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isDealerAdmin } = useAuth();
  const { data: dealerInfo } = useDealerInfo();
  const dealerId = useDealerId();

  const [payOpen, setPayOpen] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payNote, setPayNote] = useState("");
  const [paidAccountId, setPaidAccountId] = useState<string | null>(null);
  const [payPaymentMode, setPayPaymentMode] = useState("cash");

  const { data: sale, isLoading } = useQuery({
    queryKey: ["sale", id],
    queryFn: () => salesService.getById(id!),
    enabled: !!id,
  });

  const { data: salesReturns = [] } = useQuery({
    queryKey: ["sale-returns-for-invoice", id],
    queryFn: () => salesService.getReturns(id!),
    enabled: !!id,
  });

  const { data: linkedChallans = [] } = useQuery({
    queryKey: ["sale-challan-link", id],
    queryFn: () => challanService.getBySaleId(id!),
    enabled: !!id,
  });
  const linkedChallan = linkedChallans[0] ?? null;

  // Fetch optional project / site for header display
  const projectId = (sale as { project_id?: string | null } | undefined)?.project_id ?? null;
  const siteId = (sale as { site_id?: string | null } | undefined)?.site_id ?? null;
  const { data: projectSite } = useQuery({
    queryKey: ["sale-project-site", id, projectId, siteId],
    queryFn: () => projectService.getProjectAndSite(dealerId, projectId, siteId),
    enabled: !!sale && (!!projectId || !!siteId),
  });

  const { data: bankAccounts = [] } = useQuery({
    queryKey: ["bank-accounts", dealerId],
    queryFn: () => bankAccountService.list(dealerId),
    enabled: !!dealerId,
  });

  // V2 Sprint 4C — Advance Payment: apply previously-received, unapplied
  // advance credit to this invoice.
  const customerId = (sale as any)?.customer_id ?? null;
  const { data: advanceBalance = 0 } = useQuery({
    queryKey: ["advance-balance", customerId],
    queryFn: () => collectionsService.getAdvanceBalance(dealerId, customerId!),
    enabled: !!dealerId && !!customerId,
  });

  const applyAdvanceMutation = useMutation({
    mutationFn: (amount: number) =>
      collectionsService.applyAdvance(dealerId, { customer_id: customerId!, sale_id: id!, amount }),
    onSuccess: () => {
      toast.success("Advance applied to this invoice");
      queryClient.invalidateQueries({ queryKey: ["sale", id] });
      queryClient.invalidateQueries({ queryKey: ["advance-balance", customerId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // V2 Sprint 4D — Credit Note: apply a customer's unapplied return-credit
  // balance to this invoice (same math/table as Sprint 4C's Advance, but a
  // separate pool sourced from credit-mode sales_returns).
  const { data: creditNoteBalance = 0 } = useQuery({
    queryKey: ["credit-note-balance", customerId],
    queryFn: () => salesReturnService.getCreditNoteBalance(dealerId, customerId!),
    enabled: !!dealerId && !!customerId,
  });

  const applyCreditNoteMutation = useMutation({
    mutationFn: (amount: number) =>
      salesReturnService.applyCreditNote(dealerId, { customer_id: customerId!, sale_id: id!, amount }),
    onSuccess: () => {
      toast.success("Credit note applied to this invoice");
      queryClient.invalidateQueries({ queryKey: ["sale", id] });
      queryClient.invalidateQueries({ queryKey: ["credit-note-balance", customerId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const paymentMutation = useMutation({
    mutationFn: async ({
      amount,
      note,
      paid_account_id,
      payment_mode,
    }: {
      amount: number;
      note: string;
      paid_account_id?: string | null;
      payment_mode: string;
    }) => {
      return salesService.recordPayment(id!, {
        amount,
        note: note || undefined,
        paid_account_id: paid_account_id ?? null,
        payment_mode: payment_mode || undefined,
      });
    },
    onSuccess: () => {
      toast.success("Payment recorded successfully");
      queryClient.invalidateQueries({ queryKey: ["sale", id] });
      queryClient.invalidateQueries({ queryKey: ["collection-tracker"] });
      queryClient.invalidateQueries({ queryKey: ["recent-collections"] });
      setPayOpen(false);
      setPayAmount("");
      setPayNote("");
      setPaidAccountId(null);
      setPayPaymentMode("cash");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handlePrint = () => window.print();
  const handleClose = () => navigate("/sales");

  if (isLoading) return <p className="p-6 text-muted-foreground">Loading…</p>;
  if (!sale) return <p className="p-6 text-destructive">Sale not found</p>;

  const items = (sale as any).sale_items ?? [];
  const customer = (sale as any).customers;
  const subtotal = items.reduce((s: number, i: any) => s + Number(i.total), 0);
  const dueAmount = Number(sale.due_amount);
  const paidAmount = Number(sale.paid_amount);
  const totalAmount = Number(sale.total_amount);
  const discountAmount = Number(sale.discount);

  const handlePaySubmit = () => {
    const amt = parseFloat(payAmount);
    if (!amt || amt <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }
    if (amt > dueAmount) {
      toast.error(`Amount cannot exceed due balance of ৳${dueAmount.toLocaleString()}`);
      return;
    }
    if (paymentModeRequiresBankAccount(payPaymentMode) && !paidAccountId) {
      toast.error("Select a bank account for this payment mode");
      return;
    }
    paymentMutation.mutate({
      amount: amt,
      note: payNote,
      paid_account_id: paidAccountId,
      payment_mode: payPaymentMode,
    });
  };

  return (
    <>
      {/* Print-specific styles */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #invoice-print-area, #invoice-print-area * { visibility: visible !important; }
          #invoice-print-area {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            width: 100% !important;
            padding: 0 !important;
            margin: 0 !important;
          }
          .no-print { display: none !important; }
          @page { size: A4; margin: 10mm; }
          .vat-tax-invoice { box-shadow: none !important; border: none !important; }
          .vat-tax-invoice table { page-break-inside: auto; }
          .vat-tax-invoice tr { page-break-inside: avoid; }
        }
      `}</style>

      {/* Top bar */}
      <div className="no-print flex items-center justify-between gap-2 border-b bg-background px-6 py-2 sticky top-0 z-10">
        <div className="flex items-center gap-2">
          {linkedChallan && (
            <Link to={`/challans/${linkedChallan.id}`}>
              <Badge variant="outline" className="cursor-pointer bg-blue-50 text-blue-700 border-blue-300 hover:bg-blue-100 gap-1">
                <FileText className="h-3 w-3" />
                Challan Created ({linkedChallan.challan_no})
              </Badge>
            </Link>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={handlePrint}>
            <Printer className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={handleClose} className="h-8 w-8">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Invoice paper */}
      <div className="no-print min-h-screen bg-muted/40 py-6 px-4">
        <div className="mx-auto max-w-3xl space-y-3">
          <div id="invoice-print-area" className="bg-background shadow-lg rounded-lg overflow-hidden border">
            <SaleInvoiceDocument
              sale={sale}
              items={items}
              customer={customer}
              subtotal={subtotal}
              totalAmount={totalAmount}
              discountAmount={discountAmount}
              paidAmount={paidAmount}
              dueAmount={dueAmount}
              isDealerAdmin={isDealerAdmin}
              dealerInfo={dealerInfo}
              salesReturns={salesReturns}
              project={projectSite?.project ?? null}
              site={projectSite?.site ?? null}
            />
          </div>
          {id && <SaleCommissionPanel saleId={id} />}
          {id && <InvoiceTimeline saleId={id} dealerId={dealerId} />}
        </div>
      </div>

      {/* Print area */}
      <div id="invoice-print-area" className="hidden print:block">
        <SaleInvoiceDocument
          sale={sale}
          items={items}
          customer={customer}
          subtotal={subtotal}
          totalAmount={totalAmount}
          discountAmount={discountAmount}
          paidAmount={paidAmount}
          dueAmount={dueAmount}
          isDealerAdmin={isDealerAdmin}
          dealerInfo={dealerInfo}
          salesReturns={salesReturns}
          project={projectSite?.project ?? null}
          site={projectSite?.site ?? null}
        />
      </div>

      {/* Bottom action bar */}
      <div className="no-print sticky bottom-0 z-10 flex items-center justify-center gap-2 border-t bg-background px-4 py-3 flex-wrap">
        <Button
          size="sm"
          className="bg-emerald-600 hover:bg-emerald-700 text-white"
          onClick={() => setPayOpen(true)}
          disabled={dueAmount <= 0}
        >
          <CreditCard className="mr-1.5 h-3.5 w-3.5" /> Payment
        </Button>
        {dueAmount > 0 && advanceBalance > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => applyAdvanceMutation.mutate(Math.min(dueAmount, advanceBalance))}
            disabled={applyAdvanceMutation.isPending}
            title={`Unapplied advance balance: ৳${advanceBalance.toLocaleString()}`}
          >
            <Wallet className="mr-1.5 h-3.5 w-3.5" /> Apply Advance (৳{Math.min(dueAmount, advanceBalance).toLocaleString()})
          </Button>
        )}
        {dueAmount > 0 && creditNoteBalance > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => applyCreditNoteMutation.mutate(Math.min(dueAmount, creditNoteBalance))}
            disabled={applyCreditNoteMutation.isPending}
            title={`Unapplied credit note balance: ৳${creditNoteBalance.toLocaleString()}`}
          >
            <Wallet className="mr-1.5 h-3.5 w-3.5" /> Apply Credit Note (৳{Math.min(dueAmount, creditNoteBalance).toLocaleString()})
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => navigate("/deliveries")}>
          <Truck className="mr-1.5 h-3.5 w-3.5" /> Delivery
        </Button>
        <Button size="sm" variant="outline">
          <Mail className="mr-1.5 h-3.5 w-3.5" /> Email
        </Button>
        <Button size="sm" variant="outline" onClick={handlePrint}>
          <Download className="mr-1.5 h-3.5 w-3.5" /> PDF
        </Button>
        <Button size="sm" variant="outline" onClick={() => navigate(`/sales/${id}/edit`)}>
          <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
        </Button>
        <Button size="sm" variant="destructive">
          <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete
        </Button>
      </div>

      {/* Payment Dialog */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-emerald-600" />
              Record Payment
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Customer & Due info */}
            <div className="rounded-lg border bg-muted/50 p-3 space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Customer</span>
                <span className="font-medium text-foreground">{customer?.name ?? "—"}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Invoice</span>
                <span className="font-medium text-foreground">#{sale.invoice_number ?? "—"}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total Bill</span>
                <span className="font-medium text-foreground">৳{totalAmount.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Paid</span>
                <span className="font-medium text-foreground">৳{paidAmount.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm font-semibold">
                <span className="text-destructive">Due</span>
                <span className="text-destructive">৳{dueAmount.toLocaleString()}</span>
              </div>
            </div>

            {/* Amount */}
            <div className="space-y-2">
              <Label htmlFor="pay-amount">Amount (৳)</Label>
              <Input
                id="pay-amount"
                type="number"
                placeholder={`Max ৳${dueAmount.toLocaleString()}`}
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                min={1}
                max={dueAmount}
              />
              {/* Quick amount buttons */}
              <div className="flex gap-2 flex-wrap">
                {[dueAmount, Math.round(dueAmount / 2), 1000, 5000].filter((v, i, a) => v > 0 && v <= dueAmount && a.indexOf(v) === i).slice(0, 4).map((amt) => (
                  <Button
                    key={amt}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={() => setPayAmount(String(amt))}
                  >
                    ৳{amt.toLocaleString()}
                  </Button>
                ))}
              </div>
            </div>

            <PaymentModeSelect
              value={payPaymentMode}
              onChange={(v) => {
                setPayPaymentMode(v);
                if (v === "cash") setPaidAccountId(null);
              }}
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

            {/* Note */}
            <div className="space-y-2">
              <Label htmlFor="pay-note">Note (Optional)</Label>
              <Textarea
                id="pay-note"
                placeholder="Add a note about this payment..."
                value={payNote}
                onChange={(e) => setPayNote(e.target.value)}
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>Cancel</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={handlePaySubmit}
              disabled={paymentMutation.isPending}
            >
              {paymentMutation.isPending ? "Processing..." : "Confirm Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default InvoicePage;
