import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

export interface Godown {
  id: string;
  dealer_id: string;
  warehouse_id: string;
  warehouse_name?: string;
  name: string;
  code: string | null;
  is_default: boolean;
  is_active: boolean;
  notes: string | null;
}

export interface LocationStockRow {
  product_id: string;
  product_name: string;
  product_sku: string;
  product_unit_type: "box_sft" | "piece";
  product_pieces_per_box: number | null;
  box_qty: number;
  piece_qty: number;
  sft_qty: number;
  total_pieces: number;
  updated_at: string;
}

const j = async (r: Response) => {
  if (!r.ok) {
    let msg = "Request failed";
    try { const e = await r.json(); msg = typeof e.error === "string" ? e.error : msg; } catch {}
    throw new Error(msg);
  }
  return r.json();
};

export const godownService = {
  list: (dealerId: string, warehouseId?: string) => {
    const qs = new URLSearchParams({ dealerId });
    if (warehouseId) qs.set("warehouseId", warehouseId);
    return vpsAuthedFetch(`/api/godowns?${qs}`).then(j) as Promise<Godown[]>;
  },
  create: (dealerId: string, data: Partial<Godown>) =>
    vpsAuthedFetch(`/api/godowns?dealerId=${dealerId}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    }).then(j),
  update: (id: string, dealerId: string, data: Partial<Godown>) =>
    vpsAuthedFetch(`/api/godowns/${id}?dealerId=${dealerId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    }).then(j),
  remove: (id: string, dealerId: string) =>
    vpsAuthedFetch(`/api/godowns/${id}?dealerId=${dealerId}`, { method: "DELETE" }),
  stock: (id: string, dealerId: string) =>
    vpsAuthedFetch(`/api/godowns/${id}/stock?dealerId=${dealerId}`).then(j) as Promise<{ rows: LocationStockRow[] }>,
};
