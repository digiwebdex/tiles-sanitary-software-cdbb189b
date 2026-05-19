import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScanLine } from "lucide-react";

export interface BarcodeScanInputProps {
  /** Called with a trimmed barcode/SKU string when user presses Enter. */
  onScan: (code: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

/**
 * Lightweight barcode input. Treats the field as a buffer: a USB barcode
 * scanner will type the code and emit Enter, which triggers onScan and
 * clears the field for the next scan.
 */
const BarcodeScanInput = ({
  onScan,
  disabled,
  placeholder = "Scan barcode or type SKU + Enter",
}: BarcodeScanInputProps) => {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  const fire = () => {
    const code = value.trim();
    if (!code) return;
    onScan(code);
    setValue("");
    ref.current?.focus();
  };

  return (
    <div className="flex items-center gap-2 rounded-md border bg-background">
      <ScanLine className="ml-3 h-5 w-5 text-muted-foreground" />
      <Input
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            fire();
          }
        }}
        disabled={disabled}
        placeholder={placeholder}
        className="border-0 shadow-none focus-visible:ring-0"
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={fire}
        disabled={disabled || !value.trim()}
        className="mr-1 h-8"
      >
        Add
      </Button>
    </div>
  );
};

export default BarcodeScanInput;
