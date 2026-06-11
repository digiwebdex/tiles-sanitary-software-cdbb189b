import { describe, expect, it } from "vitest";
import { amountInWordsBdt } from "@/lib/amountInWords";

describe("amountInWordsBdt", () => {
  it("converts whole taka", () => {
    expect(amountInWordsBdt(1150)).toBe("One Thousand One Hundred Fifty Taka Only");
  });

  it("includes paisa when present", () => {
    expect(amountInWordsBdt(100.25)).toBe("One Hundred Taka and Twenty Five Paisa Only");
  });

  it("handles zero", () => {
    expect(amountInWordsBdt(0)).toBe("Zero Taka Only");
  });
});
