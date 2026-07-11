import { z } from "zod";

export const salesOrderItemSchema = z.object({
  id: z.string().optional(),
  product_id: z.string().nullable().optional(),
  product_name_snapshot: z.string().min(1, "Product name required"),
  product_sku_snapshot: z.string().nullable().optional(),
  unit_type: z.enum(["box_sft", "piece"]).default("piece"),
  per_box_sft: z.coerce.number().nullable().optional(),
  quantity: z.coerce.number().min(0.01, "Qty > 0 required"),
  rate: z.coerce.number().min(0),
  discount_value: z.coerce.number().min(0).default(0),
  line_total: z.coerce.number().min(0).default(0),
  rate_source: z.enum(["default", "tier", "manual"]).default("default"),
  tier_id: z.string().nullable().optional(),
  preferred_shade_code: z.string().nullable().optional(),
  preferred_caliber: z.string().nullable().optional(),
  preferred_batch_no: z.string().nullable().optional(),
});

export const salesOrderFormSchema = z
  .object({
    customer_id: z.string().nullable().optional(),
    customer_name_text: z.string().optional().default(""),
    customer_phone_text: z.string().optional().default(""),
    customer_address_text: z.string().optional().default(""),
    quotation_id: z.string().nullable().optional(),
    project_id: z.string().nullable().optional(),
    site_id: z.string().nullable().optional(),
    salesperson_id: z.string().nullable().optional(),
    order_date: z.string().min(1),
    discount_type: z.enum(["flat", "percent"]).default("flat"),
    discount_value: z.coerce.number().min(0).default(0),
    planned_delivery_date: z.string().nullable().optional(),
    notes: z.string().optional().default(""),
    terms_text: z.string().optional().default(""),
    items: z.array(salesOrderItemSchema).min(1, "Add at least one item"),
  })
  .refine(
    (v) => !!v.customer_id || (v.customer_name_text?.trim().length ?? 0) > 0,
    { message: "Pick a customer or enter a walk-in name", path: ["customer_id"] },
  );

export type SalesOrderItemInput = z.infer<typeof salesOrderItemSchema>;
export type SalesOrderFormInput = z.infer<typeof salesOrderFormSchema>;
