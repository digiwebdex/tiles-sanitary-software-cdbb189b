import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency } from "@/lib/utils";
import { Receipt, Wallet } from "lucide-react";
import type { BankAccount } from "@/services/bankAccountService";

export interface PurchaseSummaryProps {
  itemCount: number;
  subtotal: number;
  transport: number;
  labor: number;
  other: number;
  voucherDiscount: number;
  paidOnCreate: number;
  paidAccountId: string | null | undefined;
  bankAccounts: BankAccount[];
  onVoucherDiscountChange: (v: number) => void;
  onPaidOnCreateChange: (v: number) => void;
  onPaidAccountChange: (v: string | null) => void;
  onSubmit: () => void;
  onSaveDraft?: () => void;
  isLoading?: boolean;
  canSubmit: boolean;
  canSaveDraft?: boolean;
}

const PurchaseSummaryPanel = ({
  itemCount,
  subtotal,
  transport,
  labor,
  other,
  voucherDiscount,
  paidOnCreate,
  paidAccountId,
  bankAccounts,
  onVoucherDiscountChange,
  onPaidOnCreateChange,
  onPaidAccountChange,
  onSubmit,
  onSaveDraft,
  isLoading,
  canSubmit,
  canSaveDraft,
}: PurchaseSummaryProps) => {
  const netPayable = Math.max(0, subtotal - voucherDiscount);
  const due = Math.max(0, netPayable - paidOnCreate);

  return (
    <Card className="lg:sticky lg:top-4">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Receipt className="h-4 w-4 text-primary" />
          Purchase Summary
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <Row label="Items" value={String(itemCount)} muted />
        <Row label="Subtotal" value={formatCurrency(subtotal)} muted />
        {transport > 0 && <Row label="Transport" value={formatCurrency(transport)} muted />}
        {labor > 0 && <Row label="Labor" value={formatCurrency(labor)} muted />}
        {other > 0 && <Row label="Other" value={formatCurrency(other)} muted />}

        <div className="space-y-1 border-t pt-3">
          <Label htmlFor="voucher_discount" className="text-xs">Voucher Discount</Label>
          <Input
            id="voucher_discount"
            type="number"
            step="0.01"
            min={0}
            value={voucherDiscount || ""}
            placeholder="0"
            onChange={(e) => onVoucherDiscountChange(Number(e.target.value) || 0)}
            className="h-9"
          />
        </div>

        <Row label="Net Payable" value={formatCurrency(netPayable)} strong />

        <div className="space-y-1 border-t pt-3">
          <Label htmlFor="paid_on_create" className="text-xs">Paid Now</Label>
          <div className="flex items-center gap-2">
            <Input
              id="paid_on_create"
              type="number"
              step="0.01"
              min={0}
              value={paidOnCreate || ""}
              placeholder="0"
              onChange={(e) => onPaidOnCreateChange(Number(e.target.value) || 0)}
              className="h-9"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 shrink-0 text-xs"
              onClick={() => onPaidOnCreateChange(netPayable)}
              title="Mark fully paid"
            >
              Full
            </Button>
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-xs flex items-center gap-1">
            <Wallet className="h-3 w-3" /> Payment From
          </Label>
          <Select
            value={paidAccountId ?? "__cash__"}
            onValueChange={(v) => onPaidAccountChange(v === "__cash__" ? null : v)}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__cash__">Cash in Hand</SelectItem>
              {bankAccounts.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.bank_name} — {b.account_number}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-md border bg-accent/30 p-3 mt-3 space-y-1">
          <Row label="Total Due" value={formatCurrency(due)} highlight />
        </div>

        <div className="flex flex-col gap-2 pt-2">
          <Button type="button" onClick={onSubmit} disabled={!canSubmit || isLoading} className="w-full">
            {isLoading ? "Saving…" : "Submit Purchase"}
          </Button>
          {onSaveDraft && (
            <Button
              type="button"
              variant="outline"
              onClick={onSaveDraft}
              disabled={!canSaveDraft || isLoading}
              className="w-full"
            >
              Save as Draft
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

function Row({
  label,
  value,
  muted,
  strong,
  highlight,
}: {
  label: string;
  value: string;
  muted?: boolean;
  strong?: boolean;
  highlight?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between ${
        highlight ? "text-destructive font-bold text-base" : ""
      }`}
    >
      <span className={muted ? "text-muted-foreground" : ""}>{label}</span>
      <span className={strong ? "font-semibold" : ""}>{value}</span>
    </div>
  );
}

export default PurchaseSummaryPanel;
