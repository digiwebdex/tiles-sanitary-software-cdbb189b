import { z } from "zod";

/** Shared service-level validation schemas (server-side guard before DB writes) */

export const dealerIdSchema = z.string().uuid("Invalid dealer ID");
export const uuidSchema = z.string().uuid("Invalid ID");

/** Strip dangerous characters from text fields to prevent XSS/injection */
const safeText = (maxLen: number) =>
  z.string().trim().max(maxLen).transform((v) =>
    v.replace(/[<>'"`;\\]/g, "")
  );

const optionalSafeText = (maxLen: number) =>
  safeText(maxLen).optional().or(z.literal("")).or(z.literal(null as any).transform(() => undefined));

/**
 * Optional positive number that tolerates "", null, undefined as "not set".
 * Plain z.coerce.number() would coerce "" to 0 (Number("") === 0 in JS), which
 * then fails a .positive() check even though the user just left it blank.
 */
const optionalPositiveNumber = () =>
  z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : v),
    z.coerce.number().positive().optional(),
  );

// ── Product ──
export const createProductServiceSchema = z.object({
  dealer_id: dealerIdSchema,
  name: safeText(200).pipe(z.string().min(1, "Name is required")),
  sku: safeText(50).pipe(z.string().min(1, "SKU is required")),
  category: z.enum(["tiles", "sanitary"]),
  unit_type: z.enum(["box_sft", "piece"]).default("box_sft"),
  per_box_sft: z.coerce.number().min(0).nullable().optional(),
  pieces_per_box: z.coerce.number().int().positive().optional(),
  default_sale_rate: z.coerce.number().positive("Sale rate must be greater than 0"),
  cost_price: z.coerce.number().min(0, "Cost price cannot be negative").default(0),
  reorder_level: z.coerce.number().int().min(0, "Reorder level cannot be negative").default(0),
  brand: safeText(100).pipe(z.string().min(1, "Brand is required")),
  color: optionalSafeText(50),
  size: optionalSafeText(50),
  material: optionalSafeText(100),
  weight: optionalSafeText(50),
  warranty: optionalSafeText(100),
  active: z.boolean().default(true),
  image_url: z.string().trim().max(500).nullable().optional(),

  // V2 Sprint 2 — Product Master taxonomy (additive; must be listed here or
  // Zod's default "strip unknown keys" behavior silently drops them).
  series: optionalSafeText(100),
  collection_name: optionalSafeText(100),
  tile_type: optionalSafeText(100),
  finish: optionalSafeText(50),
  surface: optionalSafeText(50),
  shade_family: optionalSafeText(50),
  caliber_spec: optionalSafeText(30),
  thickness_mm: optionalPositiveNumber(),
  country_of_origin: optionalSafeText(100),
  default_rack: optionalSafeText(50),
});

export const updateProductServiceSchema = createProductServiceSchema.partial().omit({ dealer_id: true });

// ── Purchase ──
export const createPurchaseServiceSchema = z.object({
  dealer_id: dealerIdSchema,
  supplier_id: uuidSchema,
  invoice_number: optionalSafeText(50),
  purchase_date: z.string().min(1, "Date is required"),
  notes: optionalSafeText(500),
  created_by: z.string().uuid().optional(),
  voucher_discount: z.number().min(0).optional(),
  paid_on_create: z.number().min(0).optional(),
  paid_account_id: z.string().uuid().nullable().optional(),
  items: z.array(z.object({
    product_id: uuidSchema,
    quantity: z.number().positive("Quantity must be > 0"),
    qty_sqft: z.number().min(0).optional(),
    rate_unit: z.enum(["per_piece", "per_box", "per_sqft"]).optional(),
    purchase_rate: z.number().min(0, "Purchase rate cannot be negative"),
    offer_price: z.number().min(0, "Offer price cannot be negative"),
    transport_cost: z.number().min(0, "Transport cost cannot be negative"),
    labor_cost: z.number().min(0, "Labor cost cannot be negative"),
    other_cost: z.number().min(0, "Other cost cannot be negative"),
    batch_no: z.string().max(50).optional().or(z.literal("")),
    lot_no: z.string().max(50).optional().or(z.literal("")),
    shade_code: z.string().max(30).optional().or(z.literal("")),
    caliber: z.string().max(30).optional().or(z.literal("")),
  })).min(1, "At least one item required"),
});

// ── Sale ──
export const createSaleServiceSchema = z.object({
  dealer_id: dealerIdSchema,
  customer_id: uuidSchema,
  sale_date: z.string().min(1, "Date is required"),
  discount: z.number().min(0, "Discount cannot be negative").default(0),
  discount_reference: optionalSafeText(100),
  client_reference: optionalSafeText(100),
  fitter_reference: optionalSafeText(100),
  paid_amount: z.number().min(0, "Paid amount cannot be negative").default(0),
  notes: optionalSafeText(500),
  created_by: z.string().uuid().optional(),
  items: z.array(z.object({
    product_id: uuidSchema,
    quantity: z.number().positive("Quantity must be > 0"),
    qty_sqft: z.number().min(0).optional(),
    rate_unit: z.enum(["per_piece", "per_box", "per_sqft"]).optional(),
    sale_rate: z.number().min(0, "Sale rate cannot be negative"),
  })).min(1, "At least one item required"),
});

// ── Sales Return / Refund ──
export const createSalesReturnServiceSchema = z.object({
  dealer_id: dealerIdSchema,
  sale_id: uuidSchema,
  product_id: uuidSchema,
  qty: z.number().positive("Quantity must be > 0"),
  qty_sqft: z.number().min(0).optional(),
  rate_unit: z.enum(["per_piece", "per_box", "per_sqft"]).optional(),
  reason: optionalSafeText(300),
  is_broken: z.boolean(),
  refund_amount: z.number().min(0, "Refund amount cannot be negative"),
  /** V2 Sprint 4D — refund settlement channel; 'credit' = Credit Note (no cash/bank movement). */
  refund_mode: z.string().nullable().optional(),
  refund_paid_account_id: z.string().uuid().nullable().optional(),
  return_date: z.string().min(1),
  created_by: z.string().uuid().optional(),
});

// ── Expense ──
export const createExpenseServiceSchema = z.object({
  dealer_id: dealerIdSchema,
  description: safeText(500).pipe(z.string().min(1, "Description required")),
  amount: z.number().positive("Amount must be > 0"),
  expense_date: z.string().min(1),
  category: optionalSafeText(50),
  created_by: z.string().uuid().optional(),
});

// ── Stock Adjustment ──
export const stockAdjustmentServiceSchema = z.object({
  product_id: uuidSchema,
  dealer_id: dealerIdSchema,
  quantity: z.number().positive("Quantity must be > 0"),
  type: z.enum(["add", "deduct"], { required_error: "Type must be 'add' or 'deduct'" }),
});

export function validateInput<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const msg = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Validation failed: ${msg}`);
  }
  return result.data;
}
