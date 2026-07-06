import { describe, expect, it } from "vitest";
import {
  normalizePaymentMode,
  paymentModeLabel,
  receiptPostingLineType,
} from "../../backend/src/lib/paymentModes";
import {
  PAYMENT_MODES,
  paymentModeLabel as feLabel,
  paymentModeRequiresBankAccount,
  isMobileOrGatewayMode,
} from "@/lib/paymentModes";

describe("paymentModes", () => {
  it("normalizes aliases including sslcommerz and ssmcommerz", () => {
    expect(normalizePaymentMode("bKash")).toBe("bkash");
    expect(normalizePaymentMode("Nagad")).toBe("nagad");
    expect(normalizePaymentMode("SSLCommerz")).toBe("sslcommerz");
    expect(normalizePaymentMode("ssmcommerz")).toBe("sslcommerz");
    expect(normalizePaymentMode("mobile_banking")).toBe("bkash");
  });

  it("labels channels for reports", () => {
    expect(paymentModeLabel("sslcommerz")).toBe("SSLCommerz");
    expect(paymentModeLabel("bkash")).toBe("bKash");
  });

  it("uses dedicated posting line types for mobile/gateway receipts", () => {
    expect(receiptPostingLineType("receipt", "bkash")).toBe("receipt_bkash");
    expect(receiptPostingLineType("receipt", "nagad")).toBe("receipt_nagad");
    expect(receiptPostingLineType("receipt", "sslcommerz")).toBe("receipt_sslcommerz");
    expect(receiptPostingLineType("receipt", "cash")).toBe("receipt");
  });
});

describe("frontend paymentModes — Rocket (V2 Sprint 4C)", () => {
  it("lists rocket as a supported mode", () => {
    expect(PAYMENT_MODES.some((m) => m.id === "rocket")).toBe(true);
  });

  it("does not require a bank account for rocket", () => {
    expect(paymentModeRequiresBankAccount("rocket")).toBe(false);
  });

  it("treats rocket as a mobile/gateway mode (shows the settlement-account picker)", () => {
    expect(isMobileOrGatewayMode("rocket")).toBe(true);
  });

  it("has a human-readable label", () => {
    expect(feLabel("rocket")).toBe("Rocket");
  });
});
