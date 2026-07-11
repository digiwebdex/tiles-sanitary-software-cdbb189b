import { z } from "zod";

export const salesReturnSchema = z.object({
  sale_id: z.string().min(1, "Sale is required"),
  product_id: z.string().min(1, "Product is required"),
  qty: z.coerce.number().min(0.01, "Quantity must be > 0"),
  /** Phase T4a — canonical SQFT for tile (stock_base_unit='sqft') items. */
  qty_sqft: z.coerce.number().min(0).optional(),
  /** Phase T4b — pricing context for SQFT cutover. */
  rate_unit: z.enum(["per_piece", "per_box", "per_sqft"]).optional(),
  reason: z.string().trim().max(300).optional().or(z.literal("")),
  is_broken: z.boolean().default(false),
  refund_amount: z.coerce.number().min(0, "Refund must be ≥ 0"),
  /** V2 Sprint 4D — how the refund settles: cash/bank/mobile wallet, or 'credit' (Credit Note, no cash movement). */
  refund_mode: z.string().nullable().optional(),
  refund_paid_account_id: z.string().nullable().optional(),
  return_date: z.string().min(1, "Date is required"),
});

export type SalesReturnFormValues = z.infer<typeof salesReturnSchema>;
