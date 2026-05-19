import { z } from "zod";

export const purchaseItemSchema = z.object({
  product_id: z.string().min(1, "Product is required"),
  quantity: z.coerce.number().min(0.01, "Quantity must be > 0"),
  /** Phase T4a — tile SQFT mode. When the product has stock_base_unit='sqft' (T5),
   *  this carries the canonical SQFT quantity; `quantity` is still populated (in pieces)
   *  for legacy compatibility. NULL = piece-mode item (sanitary / non-tile). */
  qty_sqft: z.coerce.number().min(0).optional(),
  purchase_rate: z.coerce.number().min(0, "Rate must be ≥ 0"),
  /** 'per_piece' | 'per_box' | 'per_sqft'. NULL → legacy per_piece. */
  rate_unit: z.enum(["per_piece", "per_box", "per_sqft"]).optional(),
  offer_price: z.coerce.number().min(0).default(0),
  transport_cost: z.coerce.number().min(0).default(0),
  labor_cost: z.coerce.number().min(0).default(0),
  other_cost: z.coerce.number().min(0).default(0),
  batch_no: z.string().trim().max(50).optional().or(z.literal("")),
  lot_no: z.string().trim().max(50).optional().or(z.literal("")),
  shade_code: z.string().trim().max(30).optional().or(z.literal("")),
  caliber: z.string().trim().max(30).optional().or(z.literal("")),
});

export const purchaseSchema = z.object({
  supplier_id: z.string().min(1, "Supplier is required"),
  invoice_number: z.string().trim().max(50).optional().or(z.literal("")),
  purchase_date: z.string().min(1, "Date is required"),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
  /** Phase 3U-31: voucher-level discount (BDT, absolute). */
  voucher_discount: z.coerce.number().min(0).default(0),
  /** Phase 3U-31: amount paid at time of saving the purchase. */
  paid_on_create: z.coerce.number().min(0).default(0),
  /** Phase 3U-31: bank_accounts.id paying account, or null = cash. */
  paid_account_id: z.string().uuid().optional().nullable(),
  items: z.array(purchaseItemSchema).min(1, "At least one item is required"),
});

export type PurchaseFormValues = z.infer<typeof purchaseSchema>;
export type PurchaseItemFormValues = z.infer<typeof purchaseItemSchema>;
