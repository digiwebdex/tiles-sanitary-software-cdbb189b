import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

async function vpsJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await vpsAuthedFetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string })?.error || `Request failed (${res.status})`);
  return body as T;
}

export interface ReminderSettings {
  enabled: boolean;
  days_before: number;
  sms_enabled: boolean;
  whatsapp_enabled: boolean;
  email_enabled: boolean;
  updated_at?: string;
}

export interface ChannelConfigStatus {
  sms: boolean;
  whatsapp: boolean;
  email: boolean;
}

export interface UpcomingExpiry {
  subscription_id: string;
  dealer_id: string;
  end_date: string;
  status: string;
  days_left: number;
  reminder_sent: boolean;
  business_name: string;
  plan_name: string | null;
  owner_name: string | null;
  owner_email: string | null;
  owner_phone: string | null;
}

export interface ReminderSendResult {
  scanned: number;
  sent: number;
  skipped: number;
  failed: number;
  details: {
    dealer_id: string;
    business_name: string;
    sms: boolean;
    whatsapp: boolean;
    email: boolean;
  }[];
}

export interface SendOneResult {
  ok: boolean;
  sms: boolean;
  whatsapp: boolean;
  email: boolean;
  message?: string;
}

export async function fetchReminderSettings() {
  return vpsJson<{ settings: ReminderSettings; channels: ChannelConfigStatus }>(
    "/api/admin/reminders/settings",
  );
}

export async function updateReminderSettings(patch: Partial<ReminderSettings>) {
  return vpsJson<{ settings: ReminderSettings; channels: ChannelConfigStatus }>(
    "/api/admin/reminders/settings",
    { method: "PUT", body: JSON.stringify(patch) },
  );
}

export async function fetchUpcomingExpiries(days = 7) {
  const r = await vpsJson<{ rows: UpcomingExpiry[] }>(
    `/api/admin/reminders/upcoming?days=${days}`,
  );
  return r.rows;
}

export async function runReminders() {
  return vpsJson<ReminderSendResult>("/api/admin/reminders/run", { method: "POST" });
}

export async function sendReminderToDealer(
  dealerId: string,
  channel: "sms" | "whatsapp" | "email" | "all" = "all",
) {
  return vpsJson<SendOneResult>(
    `/api/admin/reminders/send/${encodeURIComponent(dealerId)}?channel=${channel}`,
    { method: "POST" },
  );
}
