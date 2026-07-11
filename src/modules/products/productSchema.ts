import { z } from "zod";

const optNum = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : v),
  z.coerce.number().min(0).nullable().optional(),
);

// V2 Sprint 2 — like optNum, but requires > 0 when set (matches the service-
// layer optionalPositiveNumber() in src/lib/validators.ts). Used for fields
// where 0 isn't a physically meaningful value (e.g. tile thickness).
const optPositiveNum = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : v),
  z.coerce.number().positive().nullable().optional(),
);

export const productSchema = z
  .object({
    sku: z.string().trim().min(1, "Product code is required").max(50, "Product code too long"),
    name: z.string().trim().min(1, "Product name is required").max(100, "Product name too long"),
    brand: z.string().trim().min(1, "Brand is required").max(50, "Brand too long"),
    product_group: z.string().trim().max(100).optional().or(z.literal("")),
    grade: z.string().trim().max(50).optional().or(z.literal("")),
    description: z.string().trim().max(2000).optional().or(z.literal("")),
    category: z.enum(["tiles", "sanitary"], { required_error: "Category is required" }),
    size: z.string().trim().max(30).optional().or(z.literal("")),
    color: z.string().trim().max(30).optional().or(z.literal("")),
    unit_type: z.enum(["box_sft", "piece"], { required_error: "Unit type is required" }),
    per_box_sft: z.coerce.number().min(0).optional().nullable(),
    pieces_per_box: z.coerce.number().int().positive("Pieces per box must be at least 1").default(1),

    // Phase T1 — tile dimensions + opt-in SQFT base unit (all optional)
    tile_width: optNum,
    tile_height: optNum,
    size_unit: z.enum(["inch", "cm", "feet"]).default("inch").optional(),
    sqft_per_piece: optNum,
    sqft_per_box: optNum,
    stock_base_unit: z.enum(["piece", "sqft"]).default("piece").optional(),

    cost_price: z.coerce.number().min(0, "Cost price must be ≥ 0"),
    default_sale_rate: z.coerce.number().positive("Product price must be greater than 0"),
    reorder_level: z.coerce.number().int().min(0, "Reorder level must be ≥ 0"),
    active: z.boolean().default(true),
    material: z.string().trim().max(50).optional().or(z.literal("")),
    weight: z.string().trim().max(30).optional().or(z.literal("")),
    warranty: z.string().trim().max(50).optional().or(z.literal("")),
    image_url: z.string().trim().max(500).optional().nullable().or(z.literal("")),

    // V2 Sprint 2 — Product Master taxonomy. All optional/nullable: existing
    // products with none of these set remain perfectly valid.
    series: z.string().trim().max(100).optional().or(z.literal("")),
    collection_name: z.string().trim().max(100).optional().or(z.literal("")),
    tile_type: z.string().trim().max(100).optional().or(z.literal("")),
    finish: z.string().trim().max(50).optional().or(z.literal("")),
    surface: z.string().trim().max(50).optional().or(z.literal("")),
    shade_family: z.string().trim().max(50).optional().or(z.literal("")),
    caliber_spec: z.string().trim().max(30).optional().or(z.literal("")),
    thickness_mm: optPositiveNum,
    country_of_origin: z.string().trim().max(100).optional().or(z.literal("")),
    default_rack: z.string().trim().max(50).optional().or(z.literal("")),
  })
  .superRefine((data, ctx) => {
    if (data.unit_type === "box_sft" && (!data.per_box_sft || data.per_box_sft <= 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Per box SFT is required when unit type is Box/SFT",
        path: ["per_box_sft"],
      });
    }
    if (data.stock_base_unit === "sqft") {
      if (!data.tile_width || data.tile_width <= 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Tile width is required for SQFT base", path: ["tile_width"] });
      }
      if (!data.tile_height || data.tile_height <= 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Tile height is required for SQFT base", path: ["tile_height"] });
      }
    }
  })
  .transform((data) => ({
    ...data,
    per_box_sft: data.unit_type === "piece" ? null : data.per_box_sft,
    material: data.category === "sanitary" ? data.material : undefined,
    weight: data.category === "sanitary" ? data.weight : undefined,
    warranty: data.category === "sanitary" ? data.warranty : undefined,
  }));

export type ProductFormValues = z.infer<typeof productSchema>;
