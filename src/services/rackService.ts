import { vpsAuthedFetch } from "@/lib/vpsAuthClient";
import type { LocationStockRow } from "@/services/godownService";

export interface Rack {
  id: string;
  dealer_id: string;
  godown_id: string;
  godown_name?: string;
  warehouse_id?: string;
  name: string;
  code: string | null;
  is_active: boolean;
  notes: string | null;
}

const j = async (r: Response) => {
  if (!r.ok) {
    let msg = "Request failed";
    try { const e = await r.json(); msg = typeof e.error === "string" ? e.error : msg; } catch {}
    throw new Error(msg);
  }
  return r.json();
};

export const rackService = {
  list: (dealerId: string, godownId?: string) => {
    const qs = new URLSearchParams({ dealerId });
    if (godownId) qs.set("godownId", godownId);
    return vpsAuthedFetch(`/api/racks?${qs}`).then(j) as Promise<Rack[]>;
  },
  create: (dealerId: string, data: Partial<Rack>) =>
    vpsAuthedFetch(`/api/racks?dealerId=${dealerId}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    }).then(j),
  update: (id: string, dealerId: string, data: Partial<Rack>) =>
    vpsAuthedFetch(`/api/racks/${id}?dealerId=${dealerId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    }).then(j),
  remove: (id: string, dealerId: string) =>
    vpsAuthedFetch(`/api/racks/${id}?dealerId=${dealerId}`, { method: "DELETE" }),
  stock: (id: string, dealerId: string) =>
    vpsAuthedFetch(`/api/racks/${id}/stock?dealerId=${dealerId}`).then(j) as Promise<{ rows: LocationStockRow[] }>,
};
