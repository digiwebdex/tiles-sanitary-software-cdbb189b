import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Wallet } from "lucide-react";
import type { BankAccount } from "@/services/bankAccountService";

interface Props {
  value: string | null;
  onChange: (bankAccountId: string | null) => void;
  bankAccounts: BankAccount[];
  label?: string;
  className?: string;
  triggerClassName?: string;
  disabled?: boolean;
}

/** Cash vs bank account picker shared across payment flows (P1-04). */
export function PayFromAccountSelect({
  value,
  onChange,
  bankAccounts,
  label = "Received Into",
  className,
  triggerClassName,
  disabled,
}: Props) {
  return (
    <div className={className}>
      <Label className="flex items-center gap-1 mb-2">
        <Wallet className="h-3 w-3" /> {label}
      </Label>
      <Select
        value={value ?? "__cash__"}
        onValueChange={(v) => onChange(v === "__cash__" ? null : v)}
        disabled={disabled}
      >
        <SelectTrigger className={triggerClassName}>
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
  );
}
