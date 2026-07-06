/**
 * Phase 5 (P5-06) — payment channel options (mirrors backend/src/lib/paymentModes.ts).
 */
export const PAYMENT_MODES = [
  { id: "cash", label: "Cash", labelBn: "নগদ" },
  { id: "bank", label: "Bank Transfer", labelBn: "ব্যাংক" },
  { id: "bkash", label: "bKash", labelBn: "বিকাশ" },
  { id: "nagad", label: "Nagad", labelBn: "নগদ (MFS)" },
  { id: "rocket", label: "Rocket", labelBn: "রকেট" },
  { id: "sslcommerz", label: "SSLCommerz", labelBn: "SSLCommerz" },
  { id: "cheque", label: "Cheque", labelBn: "চেক" },
  { id: "card", label: "Card", labelBn: "কার্ড" },
] as const;

export type PaymentModeId = (typeof PAYMENT_MODES)[number]["id"];

export function paymentModeLabel(id: string | null | undefined): string {
  if (!id) return "Cash";
  return PAYMENT_MODES.find((m) => m.id === id)?.label ?? id;
}

export function paymentModeRequiresBankAccount(id: string | null | undefined): boolean {
  return id === "bank" || id === "cheque" || id === "card";
}

export function isMobileOrGatewayMode(id: string | null | undefined): boolean {
  return id === "bkash" || id === "nagad" || id === "rocket" || id === "sslcommerz";
}
