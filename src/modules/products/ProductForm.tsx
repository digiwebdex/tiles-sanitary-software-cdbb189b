import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { productSchema, type ProductFormValues } from "@/modules/products/productSchema";
import { computeSqftPerPiece, computeSqftPerBox } from "@/lib/tileUnits";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Shuffle, Upload, X, ImagePlus } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { productService } from "@/services/productService";
import { uploadProductImage, resolveImageUrl } from "@/lib/uploads";
import { toast } from "sonner";
import MigrateToSqftButton from "@/modules/products/MigrateToSqftButton";
import PriceLevelsPanel from "@/modules/products/PriceLevelsPanel";
import VocabularyInput from "@/modules/products/VocabularyInput";
import {
  TILE_TYPE_OPTIONS,
  FINISH_OPTIONS,
  SURFACE_OPTIONS,
  COUNTRY_OF_ORIGIN_OPTIONS,
  SHADE_FAMILY_OPTIONS,
  CALIBER_SPEC_OPTIONS,
} from "@/lib/data/productVocabularies";

interface ProductFormProps {
  defaultValues?: Partial<ProductFormValues>;
  onSubmit: (values: ProductFormValues) => Promise<void>;
  isLoading?: boolean;
  productId?: string;
  dealerId?: string;
}

const generateSKU = () => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < 8; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
};

const ProductForm = ({ defaultValues, onSubmit, isLoading, productId, dealerId }: ProductFormProps) => {
  const [skuError, setSkuError] = useState<string | null>(null);

  // Fetch last purchase cost for this product (only in edit mode)
  // Phase 3U-30b: VPS GET /api/products/:id/last-purchase
  const { data: lastPurchaseCost } = useQuery({
    queryKey: ["product-last-cost", productId, dealerId],
    queryFn: async () => {
      const res = await vpsAuthedFetch(
        `/api/products/${productId}/last-purchase?dealerId=${dealerId}`,
      );
      if (!res.ok) return null;
      const body = await res.json().catch(() => null as any);
      const row = body?.row;
      if (!row) return null;
      return {
        landed_cost: Number(row.landed_cost) || 0,
        purchase_rate: Number(row.purchase_rate) || 0,
      };
    },
    enabled: !!productId && !!dealerId,
  });

  /** Check SKU uniqueness per dealer */
  const checkSkuUnique = async (sku: string): Promise<boolean> => {
    if (!dealerId || !sku.trim()) return true;
    return productService.isSkuUnique(sku, dealerId, productId);
  };

  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      sku: "",
      name: "",
      brand: "",
      product_group: "",
      grade: "",
      description: "",
      category: "tiles",
      size: "",
      color: "",
      unit_type: "box_sft",
      per_box_sft: null,
      pieces_per_box: 1,
      tile_width: null,
      tile_height: null,
      size_unit: "inch",
      sqft_per_piece: null,
      sqft_per_box: null,
      stock_base_unit: "piece",
      cost_price: 0,
      default_sale_rate: 0,
      reorder_level: 0,
      active: true,
      material: "",
      weight: "",
      warranty: "",
      image_url: "",
      // V2 Sprint 2 — Product Master taxonomy
      series: "",
      collection_name: "",
      tile_type: "",
      finish: "",
      surface: "",
      shade_family: "",
      caliber_spec: "",
      thickness_mm: null,
      country_of_origin: "",
      default_rack: "",
      ...defaultValues,
    },
  });

  const imageUrl = form.watch("image_url");
  const [uploadingImage, setUploadingImage] = useState(false);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    setUploadingImage(true);
    try {
      const result = await uploadProductImage(file);
      form.setValue("image_url", result.url, { shouldDirty: true });
      toast.success("Image uploaded");
    } catch (err: any) {
      toast.error(err?.message || "Image upload failed");
    } finally {
      setUploadingImage(false);
    }
  };

  const category = form.watch("category");
  const unitType = form.watch("unit_type");
  const tileWidth = form.watch("tile_width");
  const tileHeight = form.watch("tile_height");
  const sizeUnit = form.watch("size_unit");
  const piecesPerBox = form.watch("pieces_per_box");
  const stockBaseUnit = form.watch("stock_base_unit");

  // Live recompute sqft_per_piece + sqft_per_box from tile dimensions.
  useEffect(() => {
    if (category !== "tiles") return;
    const spp = computeSqftPerPiece(tileWidth ?? 0, tileHeight ?? 0, sizeUnit ?? "inch");
    const spb = computeSqftPerBox(spp, piecesPerBox);
    form.setValue("sqft_per_piece", spp > 0 ? spp : null, { shouldDirty: false });
    form.setValue("sqft_per_box", spb > 0 ? spb : null, { shouldDirty: false });
  }, [category, tileWidth, tileHeight, sizeUnit, piecesPerBox, form]);


  const handleSubmitWithValidation = async (values: ProductFormValues) => {
    setSkuError(null);
    const isUnique = await checkSkuUnique(values.sku);
    if (!isUnique) {
      setSkuError("This product code already exists. Please use a unique code.");
      form.setError("sku", { message: "This product code already exists" });
      return;
    }
    await onSubmit(values);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmitWithValidation)} className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Please fill in the information below. Fields marked with <span className="text-destructive">*</span> are required.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column — Product Info */}
          <div className="space-y-6">
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-sm font-semibold uppercase text-muted-foreground">
                  Basic Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Product Name <span className="text-destructive">*</span></FormLabel>
                      <FormControl><Input placeholder="e.g. Floor Tiles 12x12" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="sku"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Product Code (SKU) <span className="text-destructive">*</span></FormLabel>
                      <div className="flex gap-2">
                        <FormControl>
                          <Input
                            placeholder="e.g. TIL-001"
                            {...field}
                            onBlur={async (e) => {
                              field.onBlur();
                              setSkuError(null);
                              const val = e.target.value.trim();
                              if (val && dealerId) {
                                const isUnique = await checkSkuUnique(val);
                                if (!isUnique) {
                                  const msg = "This product code already exists";
                                  setSkuError(msg);
                                  form.setError("sku", { message: msg });
                                }
                              }
                            }}
                          />
                        </FormControl>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          title="Generate random code"
                          onClick={() => form.setValue("sku", generateSKU())}
                        >
                          <Shuffle className="h-4 w-4" />
                        </Button>
                      </div>
                      <FormDescription>
                        Enter a unique product code (e.g. brand-size-grade)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="brand"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Brand <span className="text-destructive">*</span></FormLabel>
                      <FormControl><Input placeholder="e.g. DBL Ceramics" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Category <span className="text-destructive">*</span></FormLabel>
                      <Select onValueChange={(val) => {
                        field.onChange(val);
                        if (val === "sanitary") {
                          form.setValue("unit_type", "piece");
                          form.setValue("per_box_sft", null);
                        } else {
                          form.setValue("unit_type", "box_sft");
                        }
                      }} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Select Category" /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="tiles">Tiles</SelectItem>
                          <SelectItem value="sanitary">Sanitary</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="product_group"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Sub Category</FormLabel>
                        <FormControl><Input placeholder="e.g. Floor, Wall, Outdoor" {...field} value={field.value ?? ""} /></FormControl>
                        <FormDescription>Where it's used — Floor / Wall / Bathroom / Outdoor</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="grade"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Grade</FormLabel>
                        <FormControl><Input placeholder="e.g. A, AA, Premium" {...field} value={field.value ?? ""} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="series"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Series</FormLabel>
                        <FormControl><Input placeholder="e.g. Milano Series" {...field} value={field.value ?? ""} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="collection_name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Collection</FormLabel>
                        <FormControl><Input placeholder="e.g. Marble Collection" {...field} value={field.value ?? ""} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Product Description</FormLabel>
                      <FormControl>
                        <textarea
                          className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          placeholder="Optional notes shown on product detail / invoice"
                          maxLength={2000}
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-sm font-semibold uppercase text-muted-foreground">
                  Unit & Dimensions
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
              {category === "tiles" && (
                <>
                  <FormField
                    control={form.control}
                    name="unit_type"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Product Unit <span className="text-destructive">*</span></FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Select Unit" /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="box_sft">Box / SFT</SelectItem>
                            <SelectItem value="piece">Piece</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {unitType === "box_sft" && (
                    <FormField
                      control={form.control}
                      name="per_box_sft"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Per Box SFT <span className="text-destructive">*</span></FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              step="0.01"
                              placeholder="e.g. 12.5"
                              {...field}
                              value={field.value ?? ""}
                            />
                          </FormControl>
                          <FormDescription>Square feet per box for SFT calculation</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}

                  <FormField
                    control={form.control}
                    name="pieces_per_box"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Pieces per Box <span className="text-destructive">*</span></FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min={1}
                            step={1}
                            placeholder="e.g. 4"
                            {...field}
                            value={field.value ?? 1}
                            onChange={(e) => field.onChange(e.target.value === "" ? "" : Number(e.target.value))}
                          />
                        </FormControl>
                        <FormDescription>
                          How many individual pieces are inside one box. Used for Box + Pc dual-unit stock tracking. Default 1 if items are sold loose.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Separator />

                  {/* Tile dimensions for SQFT calculation */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">Tile Size (for SQFT calculation)</p>
                        <p className="text-xs text-muted-foreground">
                          Enter physical tile dimensions. SQFT per piece and per box are auto-calculated.
                        </p>
                      </div>
                      {stockBaseUnit === "sqft" && (
                        <span className="text-xs font-semibold uppercase tracking-wide rounded bg-primary/15 text-primary px-2 py-1">
                          Base Unit = SQFT
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <FormField
                        control={form.control}
                        name="tile_width"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Width</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                step="0.001"
                                placeholder="8"
                                {...field}
                                value={field.value ?? ""}
                                onChange={(e) => field.onChange(e.target.value === "" ? null : Number(e.target.value))}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="tile_height"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Height</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                step="0.001"
                                placeholder="12"
                                {...field}
                                value={field.value ?? ""}
                                onChange={(e) => field.onChange(e.target.value === "" ? null : Number(e.target.value))}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="size_unit"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Unit</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value ?? "inch"}>
                              <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                              <SelectContent>
                                <SelectItem value="inch">Inch</SelectItem>
                                <SelectItem value="cm">CM</SelectItem>
                                <SelectItem value="feet">Feet</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-md border bg-muted/30 px-3 py-2">
                        <p className="text-[11px] uppercase text-muted-foreground">SQFT per Piece</p>
                        <p className="text-sm font-semibold">
                          {form.watch("sqft_per_piece")?.toString() || "—"}
                        </p>
                      </div>
                      <div className="rounded-md border bg-muted/30 px-3 py-2">
                        <p className="text-[11px] uppercase text-muted-foreground">SQFT per Box</p>
                        <p className="text-sm font-semibold">
                          {form.watch("sqft_per_box")?.toString() || "—"}
                        </p>
                      </div>
                    </div>

                    <FormField
                      control={form.control}
                      name="stock_base_unit"
                      render={({ field }) => (
                        <FormItem className="flex items-center justify-between rounded-md border p-3">
                          <div className="space-y-0.5">
                            <FormLabel className="text-sm">Track stock in SQFT</FormLabel>
                            <FormDescription className="text-xs">
                              When enabled, stock is stored as total SQFT and all entry forms ask for SQFT. Box + Pcs are shown as auto-conversion. Requires width &amp; height.
                            </FormDescription>
                          </div>
                          <FormControl>
                            <Switch
                              checked={field.value === "sqft"}
                              onCheckedChange={(checked) => field.onChange(checked ? "sqft" : "piece")}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    {/* Phase T5 — per-product cutover for existing tile products still on piece base. */}
                    {productId && dealerId && stockBaseUnit !== "sqft" && (
                      <div className="rounded-md border border-dashed p-3">
                        <div className="mb-2 text-xs text-muted-foreground">
                          One-time backfill: convert existing piece-based stock for this product
                          to SQFT canonical. Requires width, height, and pieces/box saved first.
                        </div>
                        <MigrateToSqftButton
                          productId={productId}
                          dealerId={dealerId}
                          productName={form.watch("name") as string | undefined}
                          onMigrated={() => form.setValue("stock_base_unit", "sqft", { shouldDirty: true })}
                        />
                      </div>
                    )}
                  </div>
                </>
              )}

              {category === "sanitary" && (
                <>
                  <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                    Unit: <span className="font-medium text-foreground">Piece</span> (auto-set for sanitary items)
                  </div>

                  <FormField
                    control={form.control}
                    name="pieces_per_box"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Pieces per Box <span className="text-destructive">*</span></FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min={1}
                            step={1}
                            placeholder="e.g. 1"
                            {...field}
                            value={field.value ?? 1}
                            onChange={(e) => field.onChange(e.target.value === "" ? "" : Number(e.target.value))}
                          />
                        </FormControl>
                        <FormDescription>
                          Set to 1 for single-piece sanitary items, or higher if sold as carton packs.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Separator />

                  <FormField
                    control={form.control}
                    name="material"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Material</FormLabel>
                        <FormControl><Input placeholder="e.g. Ceramic, Porcelain, Stainless Steel" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="weight"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Weight</FormLabel>
                          <FormControl><Input placeholder="e.g. 5 kg" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="warranty"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Warranty</FormLabel>
                          <FormControl><Input placeholder="e.g. 1 Year, 5 Years" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </>
              )}

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="size"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Size</FormLabel>
                        <FormControl><Input placeholder={category === "sanitary" ? 'e.g. 20 inch' : 'e.g. 12x12'} {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="color"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Color</FormLabel>
                        <FormControl><Input placeholder="e.g. White" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </CardContent>
            </Card>

            {/* V2 Sprint 2 — Product Master: tile/sanitary specification fields.
                Shown for both categories; all optional, so a sanitary item can
                simply leave the tile-only ones (finish/surface/caliber) blank. */}
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-sm font-semibold uppercase text-muted-foreground">
                  Specification
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="tile_type"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{category === "sanitary" ? "Type" : "Tile Type"}</FormLabel>
                        <FormControl>
                          <VocabularyInput
                            listId="product-tile-type-options"
                            suggestions={TILE_TYPE_OPTIONS}
                            placeholder={category === "sanitary" ? "e.g. One-piece, Wall-hung" : "e.g. Ceramic, Vitrified, Porcelain"}
                            {...field}
                            value={field.value ?? ""}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="country_of_origin"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Country of Origin</FormLabel>
                        <FormControl>
                          <VocabularyInput
                            listId="product-country-of-origin-options"
                            suggestions={COUNTRY_OF_ORIGIN_OPTIONS}
                            placeholder="e.g. Bangladesh, China, Spain"
                            {...field}
                            value={field.value ?? ""}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {category === "tiles" && (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="finish"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Finish</FormLabel>
                            <FormControl>
                              <VocabularyInput
                                listId="product-finish-options"
                                suggestions={FINISH_OPTIONS}
                                placeholder="e.g. Glossy, Matt, Satin"
                                {...field}
                                value={field.value ?? ""}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="surface"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Surface</FormLabel>
                            <FormControl>
                              <VocabularyInput
                                listId="product-surface-options"
                                suggestions={SURFACE_OPTIONS}
                                placeholder="e.g. Polished, Rustic, Wooden"
                                {...field}
                                value={field.value ?? ""}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="shade_family"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Shade Family</FormLabel>
                            <FormControl>
                              <VocabularyInput
                                listId="product-shade-family-options"
                                suggestions={SHADE_FAMILY_OPTIONS}
                                placeholder="e.g. Beige tones"
                                {...field}
                                value={field.value ?? ""}
                              />
                            </FormControl>
                            <FormDescription>
                              General shade group. The exact shade code per delivery is tracked on the batch/lot when stock is received.
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="caliber_spec"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Caliber (spec)</FormLabel>
                            <FormControl>
                              <VocabularyInput
                                listId="product-caliber-spec-options"
                                suggestions={CALIBER_SPEC_OPTIONS}
                                placeholder="e.g. C1"
                                {...field}
                                value={field.value ?? ""}
                              />
                            </FormControl>
                            <FormDescription>Nominal spec — the exact caliber per delivery is tracked on the batch/lot.</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={form.control}
                      name="thickness_mm"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Thickness (mm)</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              step="0.1"
                              placeholder="e.g. 8.5"
                              {...field}
                              value={field.value ?? ""}
                              onChange={(e) => field.onChange(e.target.value === "" ? null : Number(e.target.value))}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </>
                )}

                <FormField
                  control={form.control}
                  name="default_rack"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Default Rack / Shelf</FormLabel>
                      <FormControl><Input placeholder="e.g. Rack A-3" {...field} value={field.value ?? ""} /></FormControl>
                      <FormDescription>
                        Informational suggested location. Actual stock is tracked per godown in Inventory.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>
          </div>

          {/* Right Column — Pricing & Settings */}
          <div className="space-y-6">
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-sm font-semibold uppercase text-muted-foreground">
                  Product Image
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-start gap-4">
                  <div className="h-24 w-24 shrink-0 rounded-md border border-dashed border-border bg-muted/30 flex items-center justify-center overflow-hidden">
                    {imageUrl ? (
                      <img
                        src={resolveImageUrl(imageUrl) ?? ""}
                        alt="Product"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <ImagePlus className="h-8 w-8 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 space-y-2">
                    <input
                      ref={imageInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      className="hidden"
                      onChange={handleImageChange}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={uploadingImage}
                      onClick={() => imageInputRef.current?.click()}
                    >
                      <Upload className="mr-2 h-4 w-4" />
                      {uploadingImage ? "Uploading…" : imageUrl ? "Replace Image" : "Upload Image"}
                    </Button>
                    {imageUrl && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => form.setValue("image_url", "", { shouldDirty: true })}
                      >
                        <X className="mr-2 h-4 w-4" />
                        Remove
                      </Button>
                    )}
                    <p className="text-xs text-muted-foreground">
                      JPG, PNG, WEBP or GIF. Max 5 MB.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-sm font-semibold uppercase text-muted-foreground">
                  Pricing
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="cost_price"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Product Cost Price</FormLabel>
                      <FormControl><Input type="number" step="0.01" placeholder="0.00" {...field} /></FormControl>
                      <FormDescription>Purchase/cost price per unit</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="default_sale_rate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Product Price (Sale Rate) <span className="text-destructive">*</span></FormLabel>
                      <FormControl><Input type="number" step="0.01" placeholder="0.00" {...field} /></FormControl>
                      <FormDescription>Default selling price per unit</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {lastPurchaseCost && (() => {
                  const isBoxSft = unitType === "box_sft";
                  const perBoxSft = Number(form.getValues("per_box_sft")) || 0;
                  const landedPerBox = isBoxSft && perBoxSft > 0 ? lastPurchaseCost.landed_cost * perBoxSft : 0;

                  return (
                    <div className="rounded-md border bg-muted/50 p-3 space-y-2">
                      <p className="text-xs font-medium text-muted-foreground uppercase">Last Purchase Cost</p>
                      <div className="flex items-center gap-4 flex-wrap">
                        <div>
                          <span className="text-xs text-muted-foreground">Rate: </span>
                          <span className="text-sm font-semibold text-foreground">{formatCurrency(Math.max(0, lastPurchaseCost.purchase_rate))}</span>
                        </div>
                        <div>
                          <span className="text-xs text-muted-foreground">Landed{isBoxSft ? "/Sft" : ""}: </span>
                          <span className="text-sm font-semibold text-primary">{formatCurrency(Math.max(0, lastPurchaseCost.landed_cost))}</span>
                        </div>
                        {isBoxSft && perBoxSft > 0 && (
                          <div>
                            <span className="text-xs text-muted-foreground">Landed/Box: </span>
                            <span className="text-sm font-semibold text-primary">{formatCurrency(Math.max(0, landedPerBox))}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-sm font-semibold uppercase text-muted-foreground">
                  Inventory Settings
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="reorder_level"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Alert Quantity (Reorder Level)</FormLabel>
                      <FormControl><Input type="number" placeholder="0" {...field} /></FormControl>
                      <FormDescription>You'll get a low-stock alert when quantity falls below this</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Separator />

                <FormField
                  control={form.control}
                  name="active"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-3">
                      <div>
                        <FormLabel className="!mt-0">Active</FormLabel>
                        <FormDescription>Inactive products won't appear in sales</FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* V2 Sprint 2 — Price Levels. Only meaningful once the product
                exists (edit mode), same gating as MigrateToSqftButton above. */}
            {productId && dealerId && (
              <PriceLevelsPanel productId={productId} dealerId={dealerId} />
            )}
          </div>
        </div>

        <Button type="submit" disabled={isLoading} className="w-full md:w-auto">
          {isLoading ? "Saving…" : defaultValues ? "Update Product" : "Add Product"}
        </Button>
      </form>
    </Form>
  );
};

export default ProductForm;
