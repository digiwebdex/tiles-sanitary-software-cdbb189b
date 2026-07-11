/**
 * SMS template catalog + rendering, shared by the template manager and the
 * bulk sender. Placeholders use {name} syntax; unknown placeholders are left
 * intact so a typo is visible in the preview instead of silently vanishing.
 */

export type SmsTemplateDef = {
  key: string;
  label: string;
  labelBn: string;
  defaultBody: string;
  placeholders: string[];
};

export type SmsTemplateOverride = {
  template_key: string;
  label: string | null;
  body: string;
  is_enabled: boolean;
};

export type ResolvedSmsTemplate = SmsTemplateDef & {
  body: string;
  isEnabled: boolean;
  isCustomised: boolean;
};

export const SMS_PLACEHOLDER_HINTS: Record<string, string> = {
  shop: "দোকানের নাম / Shop name",
  name: "কাস্টমারের নাম / Customer name",
  phone: "কাস্টমারের ফোন / Customer phone",
  invoice: "ইনভয়েস নম্বর / Invoice number",
  total: "মোট টাকা / Total amount",
  paid: "পরিশোধিত / Paid amount",
  due: "বকেয়া / Due amount",
  amount: "টাকার পরিমাণ / Amount",
  date: "তারিখ / Date",
};

export const SMS_TEMPLATE_CATALOG: SmsTemplateDef[] = [
  {
    key: "sale_invoice",
    label: "Sales Invoice",
    labelBn: "বিক্রয় ইনভয়েস",
    defaultBody:
      "প্রিয় {name}, {shop} থেকে কেনাকাটার জন্য ধন্যবাদ। ইনভয়েস {invoice}: মোট {total} টাকা, পরিশোধ {paid} টাকা, বকেয়া {due} টাকা।",
    placeholders: ["name", "shop", "invoice", "total", "paid", "due"],
  },
  {
    key: "payment_receive",
    label: "Payment Received",
    labelBn: "পেমেন্ট গ্রহণ",
    defaultBody:
      "প্রিয় {name}, {shop} আপনার {amount} টাকা পেমেন্ট পেয়েছে ({date})। বর্তমান বকেয়া {due} টাকা। ধন্যবাদ।",
    placeholders: ["name", "shop", "amount", "date", "due"],
  },
  {
    key: "due_reminder",
    label: "Due / Balance Reminder",
    labelBn: "বকেয়া রিমাইন্ডার",
    defaultBody:
      "প্রিয় {name}, {shop}-এ আপনার বকেয়া {due} টাকা। অনুগ্রহ করে দ্রুত পরিশোধ করুন। প্রয়োজনে যোগাযোগ করুন।",
    placeholders: ["name", "shop", "due"],
  },
  {
    key: "emi_due",
    label: "EMI Installment Alert",
    labelBn: "ইএমআই কিস্তি অ্যালার্ট",
    defaultBody:
      "প্রিয় {name}, আপনার {shop}-এর কিস্তি {amount} টাকা {date} তারিখে প্রদেয়। সময়মতো পরিশোধের অনুরোধ রইলো।",
    placeholders: ["name", "shop", "amount", "date"],
  },
  {
    key: "order_ready",
    label: "Order Ready",
    labelBn: "অর্ডার প্রস্তুত",
    defaultBody: "প্রিয় {name}, {shop}-এ আপনার অর্ডার প্রস্তুত। দয়া করে ডেলিভারি নিন।",
    placeholders: ["name", "shop"],
  },
  {
    key: "greeting",
    label: "Greeting / Thanks",
    labelBn: "শুভেচ্ছা বার্তা",
    defaultBody: "প্রিয় {name}, {shop}-এর সাথে থাকার জন্য আপনাকে আন্তরিক ধন্যবাদ।",
    placeholders: ["name", "shop"],
  },
  {
    key: "custom_1",
    label: "Custom Template 1",
    labelBn: "কাস্টম টেমপ্লেট ১",
    defaultBody: "",
    placeholders: ["name", "shop", "due", "amount", "date"],
  },
  {
    key: "custom_2",
    label: "Custom Template 2",
    labelBn: "কাস্টম টেমপ্লেট ২",
    defaultBody: "",
    placeholders: ["name", "shop", "due", "amount", "date"],
  },
];

/** Replace {placeholder} tokens; unknown/missing vars stay as-is. */
export function renderSmsTemplate(
  body: string,
  vars: Record<string, string | number | null | undefined>,
): string {
  return body.replace(/\{(\w+)\}/g, (token, key: string) => {
    const value = vars[key];
    return value === null || value === undefined ? token : String(value);
  });
}

/** Merge dealer overrides onto the built-in catalog. */
export function mergeTemplatesWithOverrides(
  overrides: SmsTemplateOverride[],
): ResolvedSmsTemplate[] {
  const byKey = new Map(overrides.map((o) => [o.template_key, o]));
  return SMS_TEMPLATE_CATALOG.map((def) => {
    const o = byKey.get(def.key);
    return {
      ...def,
      label: o?.label || def.label,
      body: o ? o.body : def.defaultBody,
      isEnabled: o ? o.is_enabled : def.defaultBody !== "",
      isCustomised: !!o,
    };
  });
}

/** Rough GSM/Unicode segment estimate: Bengali text uses 70-char segments. */
export function estimateSmsSegments(message: string): number {
  if (!message) return 0;
  const hasUnicode = /[^\u0020-\u007e]/.test(message);
  const perSegment = hasUnicode ? 70 : 160;
  return Math.ceil(message.length / perSegment);
}
