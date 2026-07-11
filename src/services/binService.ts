import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

export interface Bin {
  id: string;
  dealer_id: string;
  rack_id: string;
  rack_name?: string;
  godown_id?: string;
  bin_code: string;
  storage_location: string | null;
  rack_position: string | null;
  is_active: boolean;
}

const j = async (r: Response) => {
  if (!r.ok) {
    let msg = "Request failed";
    try { const e = await r.json(); msg = typeof e.error === "string" ? e.error : msg; } catch {}
    throw new Error(msg);
  }
  return r.json();
};

export const binService = {
  list: (dealerId: string, rackId?: string) => {
    const qs = new URLSearchParams({ dealerId });
    if (rackId) qs.set("rackId", rackId);
    return vpsAuthedFetch(`/api/bins?${qs}`).then(j) as Promise<Bin[]>;
  },
  create: (dealerId: string, data: Partial<Bin>) =>
    vpsAuthedFetch(`/api/bins?dealerId=${dealerId}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    }).then(j),
  update: (id: string, dealerId: string, data: Partial<Bin>) =>
    vpsAuthedFetch(`/api/bins/${id}?dealerId=${dealerId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    }).then(j),
  remove: (id: string, dealerId: string) =>
    vpsAuthedFetch(`/api/bins/${id}?dealerId=${dealerId}`, { method: "DELETE" }),
};
