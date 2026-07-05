/**
 * V2 Sprint 2.1 — Product Master controlled vocabularies.
 *
 * These are SUGGESTED values, not enforced enums — the underlying DB columns
 * (products.tile_type/finish/surface/shade_family/caliber_spec/country_of_origin)
 * stay free-text varchar, so:
 *   - existing Sprint-2 data (any value already saved) keeps working exactly
 *     as-is, nothing is migrated or validated against this list;
 *   - a dealer whose brand uses a term not listed here can still type it in.
 * The UI (VocabularyInput) offers these as autocomplete suggestions on top of
 * a plain text field — full backward compatibility, no schema change.
 */

export const TILE_TYPE_OPTIONS = [
  "Ceramic",
  "Vitrified",
  "Porcelain",
  "Digital",
  "Full Body Vitrified",
  "Glazed Vitrified (GVT)",
  "Double Charge",
  "Rustic",
  "Terracotta",
  "Mosaic",
] as const;

export const FINISH_OPTIONS = [
  "Glossy",
  "Matt",
  "Satin",
  "Sugar",
  "Carving",
  "Semi-Polished",
  "Metallic",
] as const;

export const SURFACE_OPTIONS = [
  "Polished",
  "Glazed",
  "Rustic",
  "Wooden",
  "Marble",
  "Stone",
  "Textured",
  "Unglazed",
] as const;

export const COUNTRY_OF_ORIGIN_OPTIONS = [
  "Bangladesh",
  "China",
  "India",
  "Spain",
  "Italy",
  "Vietnam",
  "Indonesia",
  "Thailand",
  "Morbi (India)",
] as const;

export const SHADE_FAMILY_OPTIONS = [
  "White",
  "Ivory",
  "Beige",
  "Cream",
  "Grey",
  "Brown",
  "Black",
  "Multi-shade",
] as const;

export const CALIBER_SPEC_OPTIONS = [
  "C1",
  "C2",
  "C3",
  "C4",
  "Rectified",
] as const;
