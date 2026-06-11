import { z } from "zod";

export const saleItemSchema = z.object({
  product_id: z.string().min(1, "Product is required"),
  quantity: z.coerce.number().min(0.01, "Quantity must be > 0"),
  /** Optional dual-unit fields. When omitted, backend derives from `quantity`. */
  box_qty: z.coerce.number().min(0).optional(),
  piece_qty: z.coerce.number().min(0).optional(),
  /** Phase T4a — tile SQFT mode. Canonical SQFT qty for products with
   *  stock_base_unit='sqft' (T5). NULL = piece-mode item. */
  qty_sqft: z.coerce.number().min(0).optional(),
  sale_rate: z.coerce.number().min(0, "Rate must be ≥ 0"),
  /** 'per_piece' | 'per_box' | 'per_sqft'. NULL → legacy per_piece. */
  rate_unit: z.enum(["per_piece", "per_box", "per_sqft"]).optional(),
  rate_source: z.enum(["default", "tier", "manual"]).optional().default("default"),
  tier_id: z.string().nullable().optional(),
  /** Resolved rate (default or tier) before any manual override; null when no override. */
  original_resolved_rate: z.coerce.number().nullable().optional(),
});

export const saleSchema = z.object({
  customer_name: z.string().trim().min(1, "Customer name is required").max(200),
  customer_type: z.enum(["retailer", "customer", "project"]).optional().default("customer"),
  sale_date: z.string().min(1, "Date is required"),
  sale_type: z.enum(["direct_invoice", "challan_mode"]).default("direct_invoice"),
  discount: z.coerce.number().min(0).default(0),
  discount_reference: z.string().trim().max(100).optional().or(z.literal("")),
  client_reference: z.string().trim().max(100).optional().or(z.literal("")),
  fitter_reference: z.string().trim().max(100).optional().or(z.literal("")),
  paid_amount: z.coerce.number().min(0).default(0),
  payment_mode: z
    .enum(["cash", "bank", "bkash", "nagad", "sslcommerz", "cheque", "card", ""])
    .optional()
    .or(z.literal("")),
  paid_account_id: z.string().uuid().nullable().optional(),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
  /** Optional project link (Project / Site-wise Sales). */
  project_id: z.string().nullable().optional(),
  /** Optional site link under the chosen project. */
  site_id: z.string().nullable().optional(),
  items: z.array(saleItemSchema).min(1, "At least one item is required"),
});

export type SaleFormValues = z.infer<typeof saleSchema>;
