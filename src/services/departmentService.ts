/**
 * departmentService — V2 Sprint 6D.
 * Wraps GET/POST/PUT/DELETE /api/departments.
 */
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

export interface Department {
  id: string;
  dealer_id: string;
  code: string;
  name: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface DepartmentInput {
  code: string;
  name: string;
}

async function parseError(r: Response, fallback: string): Promise<never> {
  const body = await r.json().catch(() => ({}));
  throw new Error(body.error || fallback);
}

export const departmentService = {
  async list(dealerId: string, activeOnly = true): Promise<{ rows: Department[] }> {
    const r = await vpsAuthedFetch(`/api/departments?dealerId=${dealerId}&activeOnly=${activeOnly}`);
    if (!r.ok) return parseError(r, "Failed to load departments");
    return r.json();
  },
  async create(dealerId: string, payload: DepartmentInput): Promise<{ row: Department }> {
    const r = await vpsAuthedFetch(`/api/departments?dealerId=${dealerId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dealerId, ...payload }),
    });
    if (!r.ok) return parseError(r, "Failed to create department");
    return r.json();
  },
  async update(dealerId: string, id: string, payload: Partial<DepartmentInput> & { is_active?: boolean }): Promise<{ row: Department }> {
    const r = await vpsAuthedFetch(`/api/departments/${id}?dealerId=${dealerId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dealerId, ...payload }),
    });
    if (!r.ok) return parseError(r, "Failed to update department");
    return r.json();
  },
  async remove(dealerId: string, id: string): Promise<{ ok: true }> {
    const r = await vpsAuthedFetch(`/api/departments/${id}?dealerId=${dealerId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dealerId }),
    });
    if (!r.ok) return parseError(r, "Failed to delete department");
    return r.json();
  },
};
