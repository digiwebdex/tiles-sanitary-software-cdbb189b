/**
 * whatsappService — V2 Sprint 5B addition (buildPurchaseOrderMessage).
 * This service previously had no test coverage; this file covers the new
 * template builder only.
 */
import { describe, expect, it } from "vitest";
import { buildPurchaseOrderMessage } from "@/services/whatsappService";

describe("buildPurchaseOrderMessage (V2 Sprint 5B)", () => {
  it("addresses the supplier by name and includes PO number/items/total", () => {
    const msg = buildPurchaseOrderMessage({
      dealerName: "Acme Dealer",
      supplierName: "ABC Tiles Ltd.",
      poNumber: "PO-00045",
      totalAmount: 85000,
      itemCount: 6,
    });
    expect(msg).toContain("Dear ABC Tiles Ltd.,");
    expect(msg).toContain("PO Number: PO-00045");
    expect(msg).toContain("Items: 6");
    expect(msg).toContain("Acme Dealer");
  });

  it("falls back to a generic supplier greeting when no name is given", () => {
    const msg = buildPurchaseOrderMessage({
      dealerName: "Acme Dealer", poNumber: "PO-00046", totalAmount: 100, itemCount: 1,
    });
    expect(msg).toContain("Dear Supplier,");
  });

  it("includes the expected delivery date only when provided", () => {
    const withDate = buildPurchaseOrderMessage({
      dealerName: "D", poNumber: "PO-1", totalAmount: 1, itemCount: 1, expectedDeliveryDate: "20 Apr 2026",
    });
    expect(withDate).toContain("Expected Delivery: 20 Apr 2026");

    const withoutDate = buildPurchaseOrderMessage({
      dealerName: "D", poNumber: "PO-1", totalAmount: 1, itemCount: 1,
    });
    expect(withoutDate).not.toContain("Expected Delivery");
  });
});
