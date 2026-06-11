import { describe, expect, it } from "vitest";
import {
  normalizePaymentMode,
  paymentModeLabel,
  receiptPostingLineType,
} from "../../backend/src/lib/paymentModes";

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
