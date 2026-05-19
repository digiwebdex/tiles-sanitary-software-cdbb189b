import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

export type ExitStatus = "initiated" | "clearance" | "settled" | "cancelled";
export type ExitType = "resignation" | "termination" | "retirement" | "absconding" | "end_of_contract";
export type ClearanceStatus = "pending" | "done" | "na";

export interface EmployeeExit {
  id: string;
  dealer_id: string;
  employee_id: string;
  exit_code: string;
  exit_type: ExitType;
  resignation_date: string;
  last_working_date: string;
  notice_period_days: number;
  reason?: string | null;
  status: ExitStatus;
  unpaid_salary: number;
  leave_encashment: number;
  bonus: number;
  gratuity: number;
  other_additions: number;
  outstanding_loans: number;
  outstanding_advances: number;
  other_deductions: number;
  net_payable: number;
  payment_method?: "cash" | "bank" | null;
  bank_account_id?: string | null;
  settled_date?: string | null;
  exit_interview_notes?: string | null;
  rehire_eligible_notes?: string | null;
  rehire_eligible: boolean;
  created_at: string;
  updated_at: string;

  employee_name?: string | null;
  employee_code?: string | null;
  designation?: string | null;
  department?: string | null;
  joining_date?: string | null;
  bank_account_name?: string | null;
  clearances?: ExitClearance[];
}

export interface ExitClearance {
  id: string;
  exit_id: string;
  department: string;
  item: string;
  status: ClearanceStatus;
  remarks?: string | null;
  cleared_by?: string | null;
  cleared_at?: string | null;
  created_at: string;
}

export interface ExitSummary {
  initiated: { count: number; net: number };
  clearance: { count: number; net: number };
  settled: { count: number; net: number };
  cancelled: { count: number; net: number };
}

export interface SettlementPreview {
  outstanding_loans: number;
  outstanding_advances: number;
  suggested_net: number;
}

const BASE = "/api/employee-exits";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await vpsAuthedFetch(`${BASE}${path}`, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Request failed (${res.status})`);
  }
  return res.json();
}

export const employeeExitService = {
  list: (params: { status?: ExitStatus; employee_id?: string; q?: string } = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v != null && v !== "") as [string, string][],
    ).toString();
    return req<EmployeeExit[]>(qs ? `/?${qs}` : "/");
  },

  summary: () => req<ExitSummary>("/summary"),

  get: (id: string) => req<EmployeeExit>(`/${id}`),

  settlementPreview: (id: string) => req<SettlementPreview>(`/${id}/settlement-preview`),

  create: (data: Partial<EmployeeExit>) =>
    req<EmployeeExit>("/", { method: "POST", body: JSON.stringify(data) }),

  update: (id: string, data: Partial<EmployeeExit>) =>
    req<EmployeeExit>(`/${id}`, { method: "PUT", body: JSON.stringify(data) }),

  cancel: (id: string) => req<{ ok: boolean }>(`/${id}`, { method: "DELETE" }),

  settle: (id: string, data: { settled_date?: string; payment_method?: "cash" | "bank"; bank_account_id?: string | null } = {}) =>
    req<EmployeeExit>(`/${id}/settle`, { method: "POST", body: JSON.stringify(data) }),

  addClearance: (exitId: string, data: { department: string; item: string; status?: ClearanceStatus; remarks?: string | null }) =>
    req<ExitClearance>(`/${exitId}/clearance`, { method: "POST", body: JSON.stringify(data) }),

  updateClearance: (cid: string, data: Partial<ExitClearance>) =>
    req<ExitClearance>(`/clearances/${cid}`, { method: "PUT", body: JSON.stringify(data) }),

  removeClearance: (cid: string) =>
    req<{ ok: boolean }>(`/clearances/${cid}`, { method: "DELETE" }),
};
