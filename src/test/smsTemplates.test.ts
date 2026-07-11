import { describe, expect, it } from "vitest";
import {
  SMS_TEMPLATE_CATALOG,
  renderSmsTemplate,
  mergeTemplatesWithOverrides,
  estimateSmsSegments,
} from "@/lib/smsTemplates";

describe("smsTemplates", () => {
  it("catalog keys are unique", () => {
    const keys = SMS_TEMPLATE_CATALOG.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("renders placeholders and leaves unknown tokens intact", () => {
    const out = renderSmsTemplate("প্রিয় {name}, বকেয়া {due} টাকা। {unknown}", {
      name: "রহিম",
      due: 2500,
    });
    expect(out).toBe("প্রিয় রহিম, বকেয়া 2500 টাকা। {unknown}");
  });

  it("treats null/undefined vars as missing", () => {
    const out = renderSmsTemplate("{name} {due}", { name: null, due: undefined });
    expect(out).toBe("{name} {due}");
  });

  it("merges overrides onto the catalog", () => {
    const merged = mergeTemplatesWithOverrides([
      { template_key: "due_reminder", label: "My Reminder", body: "custom {due}", is_enabled: false },
    ]);
    const due = merged.find((t) => t.key === "due_reminder")!;
    expect(due.body).toBe("custom {due}");
    expect(due.label).toBe("My Reminder");
    expect(due.isEnabled).toBe(false);
    expect(due.isCustomised).toBe(true);

    const sale = merged.find((t) => t.key === "sale_invoice")!;
    expect(sale.isCustomised).toBe(false);
    expect(sale.body).toBe(sale.defaultBody);
    expect(sale.isEnabled).toBe(true);

    // Empty custom templates stay disabled until the dealer writes one
    const custom = merged.find((t) => t.key === "custom_1")!;
    expect(custom.isEnabled).toBe(false);
  });

  it("estimates unicode segments at 70 chars", () => {
    expect(estimateSmsSegments("")).toBe(0);
    expect(estimateSmsSegments("hello")).toBe(1);
    expect(estimateSmsSegments("ক".repeat(71))).toBe(2);
  });
});
