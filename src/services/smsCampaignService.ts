/**
 * smsCampaignService — SMS template overrides + bulk campaign sending.
 * Backed by /api/sms-templates and /api/notifications/sms/bulk.
 */
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";
import type { SmsTemplateOverride } from "@/lib/smsTemplates";

export interface BulkSmsRecipient {
  phone: string;
  vars: Record<string, string | number>;
}

export interface BulkSmsResult {
  total: number;
  sent: number;
  failed: number;
  deduped: number;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await vpsAuthedFetch(path, init);
  const body = await res.json().catch(() => ({} as unknown));
  if (!res.ok) {
    const msg = (body as { error?: string })?.error || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return body as T;
}

export const smsCampaignService = {
  async listTemplates(): Promise<SmsTemplateOverride[]> {
    const body = await request<{ rows: SmsTemplateOverride[] }>("/api/sms-templates");
    return body.rows ?? [];
  },

  async saveTemplate(
    key: string,
    data: { label?: string; body: string; is_enabled?: boolean },
  ): Promise<void> {
    await request(`/api/sms-templates/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },

  async resetTemplate(key: string): Promise<void> {
    await request(`/api/sms-templates/${encodeURIComponent(key)}`, { method: "DELETE" });
  },

  /**
   * Send a bulk campaign in chunks of 100. `idempotencyPrefix` makes retries
   * safe: the same prefix + phone never sends twice.
   */
  async sendBulk(
    idempotencyPrefix: string,
    messageTemplate: string,
    recipients: BulkSmsRecipient[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<BulkSmsResult> {
    const totals: BulkSmsResult = { total: 0, sent: 0, failed: 0, deduped: 0 };
    const CHUNK = 100;
    for (let i = 0; i < recipients.length; i += CHUNK) {
      const chunk = recipients.slice(i, i + CHUNK);
      const body = await request<BulkSmsResult>("/api/notifications/sms/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotency_prefix: idempotencyPrefix,
          message_template: messageTemplate,
          recipients: chunk,
        }),
      });
      totals.total += body.total;
      totals.sent += body.sent;
      totals.failed += body.failed;
      totals.deduped += body.deduped;
      onProgress?.(Math.min(i + CHUNK, recipients.length), recipients.length);
    }
    return totals;
  },
};
