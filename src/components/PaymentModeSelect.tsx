import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { PAYMENT_MODES } from "@/lib/paymentModes";

interface PaymentModeSelectProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  triggerClassName?: string;
  disabled?: boolean;
}

export function PaymentModeSelect({
  value,
  onChange,
  label = "Payment Mode",
  triggerClassName,
  disabled,
}: PaymentModeSelectProps) {
  return (
    <div className="space-y-2">
      {label ? <Label>{label}</Label> : null}
      <Select value={value || "cash"} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className={triggerClassName}>
          <SelectValue placeholder="Select payment mode" />
        </SelectTrigger>
        <SelectContent>
          {PAYMENT_MODES.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.label}
              <span className="text-muted-foreground ml-1 text-xs bangla-text">({m.labelBn})</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
