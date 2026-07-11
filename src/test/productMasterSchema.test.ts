/**
 * V2 Sprint 2 — Product Master schema tests.
 *
 * Verifies the new tile/sanitary taxonomy fields added to productSchema
 * (frontend form validation) and createProductServiceSchema (service-layer
 * guard) are (a) fully optional — existing products/forms with none of them
 * set remain valid — and (b) don't silently get stripped by Zod's default
 * "unknown keys are dropped" behavior, which would make the fields
 * unsaveable despite the UI showing them.
 */
import { describe, expect, it } from "vitest";
import { productSchema } from "@/modules/products/productSchema";
import { createProductServiceSchema, updateProductServiceSchema } from "@/lib/validators";

const BASE_PRODUCT = {
  sku: "TIL-001",
  name: "Floor Tile 12x12",
  brand: "DBL Ceramics",
  category: "tiles" as const,
  unit_type: "box_sft" as const,
  per_box_sft: 12.5,
  pieces_per_box: 4,
  cost_price: 100,
  default_sale_rate: 150,
  reorder_level: 5,
  active: true,
};

describe("productSchema (form) — V2 taxonomy fields", () => {
  it("validates with none of the new fields set (backward compatible)", () => {
    const result = productSchema.safeParse(BASE_PRODUCT);
    expect(result.success).toBe(true);
  });

  it("accepts all new taxonomy fields when provided", () => {
    const result = productSchema.safeParse({
      ...BASE_PRODUCT,
      series: "Milano Series",
      collection_name: "Marble Collection",
      tile_type: "Vitrified",
      finish: "Glossy",
      surface: "Polished",
      shade_family: "Beige tones",
      caliber_spec: "C1",
      thickness_mm: 8.5,
      country_of_origin: "Spain",
      default_rack: "Rack A-3",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.series).toBe("Milano Series");
      expect(result.data.thickness_mm).toBe(8.5);
    }
  });

  it("treats empty-string taxonomy fields the same as omitted", () => {
    const result = productSchema.safeParse({
      ...BASE_PRODUCT,
      series: "",
      finish: "",
      thickness_mm: "",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-positive thickness (blank is fine, zero/negative is not)", () => {
    const result = productSchema.safeParse({ ...BASE_PRODUCT, thickness_mm: 0 });
    expect(result.success).toBe(false);
  });
});

describe("createProductServiceSchema — V2 taxonomy fields survive validation", () => {
  const BASE_SERVICE_PRODUCT = {
    dealer_id: "11111111-1111-1111-1111-111111111111",
    name: "Floor Tile 12x12",
    sku: "TIL-001",
    category: "tiles" as const,
    brand: "DBL Ceramics",
    default_sale_rate: 150,
  };

  it("does NOT silently strip the new fields (the regression this guards against)", () => {
    const result = createProductServiceSchema.safeParse({
      ...BASE_SERVICE_PRODUCT,
      series: "Milano Series",
      collection_name: "Marble Collection",
      tile_type: "Vitrified",
      finish: "Glossy",
      surface: "Polished",
      shade_family: "Beige tones",
      caliber_spec: "C1",
      thickness_mm: 8.5,
      country_of_origin: "Spain",
      default_rack: "Rack A-3",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // If any of these were dropped, they'd be `undefined` here even though
      // they were supplied — that's exactly the silent-strip bug this test
      // exists to catch.
      expect(result.data.series).toBe("Milano Series");
      expect(result.data.collection_name).toBe("Marble Collection");
      expect(result.data.tile_type).toBe("Vitrified");
      expect(result.data.finish).toBe("Glossy");
      expect(result.data.surface).toBe("Polished");
      expect(result.data.shade_family).toBe("Beige tones");
      expect(result.data.caliber_spec).toBe("C1");
      expect(result.data.thickness_mm).toBe(8.5);
      expect(result.data.country_of_origin).toBe("Spain");
      expect(result.data.default_rack).toBe("Rack A-3");
    }
  });

  it("validates with none of the new fields set", () => {
    const result = createProductServiceSchema.safeParse(BASE_SERVICE_PRODUCT);
    expect(result.success).toBe(true);
  });

  it("treats a blank thickness_mm as not-set, not as an error", () => {
    const result = createProductServiceSchema.safeParse({
      ...BASE_SERVICE_PRODUCT,
      thickness_mm: "",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.thickness_mm).toBeUndefined();
  });

  it("updateProductServiceSchema (partial) also keeps the new fields", () => {
    const result = updateProductServiceSchema.safeParse({
      series: "Milano Series",
      thickness_mm: 10,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.series).toBe("Milano Series");
      expect(result.data.thickness_mm).toBe(10);
    }
  });
});
